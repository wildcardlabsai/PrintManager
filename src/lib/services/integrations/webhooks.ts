import "server-only";
import { etsyConfig, ebayConfig } from "@/lib/integrations/config";
import { describeIntegrationError, IntegrationError } from "@/lib/integrations/errors";
import { etsyAdapter } from "@/lib/integrations/etsy/adapter";
import {
  normaliseEtsyEventType,
  receiptIdFromResourceUrl,
  verifyEtsyWebhook,
  type EtsyWebhookPayload,
} from "@/lib/integrations/etsy/webhook";
import { ebayApplicationToken } from "@/lib/integrations/ebay/oauth";
import { parseEbaySignatureHeader, verifyEbaySignature, type EbayDeletionPayload } from "@/lib/integrations/ebay/notifications";
import { requestJson } from "@/lib/integrations/http";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { marketplaceAuth } from "./credentials";
import { loadImportCatalog, processNormalizedOrder } from "./import";
import { emptyCounters, finishSyncLog, startSyncLog } from "./sync-log";
import { systemContext } from "./system";
import type { IntegrationConnection } from "./types";

export type WebhookResult = { status: number; body: Record<string, unknown> };

/** Etsy order events PrintFlow acts on. */
const ETSY_ORDER_EVENTS = new Set(["order.paid", "order.canceled", "order.cancelled", "order.shipped", "order.delivered"]);

/**
 * Records a webhook delivery once. Returns false when this delivery id was
 * already processed successfully (duplicate), so it is acknowledged without
 * doing the work again. Failed deliveries are reprocessed when retried.
 */
async function claimEvent(admin: AdminClient, provider: string, eventId: string, eventType: string | null, payload: unknown) {
  const { data: existing } = await admin.from("webhook_events").select("id, status, attempts").eq("provider", provider).eq("event_id", eventId).maybeSingle();
  if (existing) {
    if (existing.status === "processed" || existing.status === "ignored") return { id: existing.id as string, duplicate: true };
    await admin.from("webhook_events").update({ attempts: existing.attempts + 1, status: "received", error: null }).eq("id", existing.id);
    return { id: existing.id as string, duplicate: false };
  }
  const { data, error } = await admin
    .from("webhook_events")
    .insert({ provider, event_id: eventId, event_type: eventType, payload })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { id: "", duplicate: true };
    throw new Error(`Could not record webhook: ${error.message}`);
  }
  return { id: data.id as string, duplicate: false };
}

async function finishEvent(admin: AdminClient, id: string, status: "processed" | "failed" | "ignored", orgId: string | null, error?: string) {
  if (!id) return;
  await admin
    .from("webhook_events")
    .update({ status, organization_id: orgId, error: error ?? null, processed_at: new Date().toISOString() })
    .eq("id", id);
}

export async function handleEtsyWebhook(rawBody: string, headers: Headers): Promise<WebhookResult> {
  const verification = verifyEtsyWebhook(
    etsyConfig().webhookSecret,
    { id: headers.get("webhook-id"), timestamp: headers.get("webhook-timestamp"), signature: headers.get("webhook-signature") },
    rawBody,
  );
  if (!verification.ok) return { status: 401, body: { error: verification.reason } };

  let payload: EtsyWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  const eventType = normaliseEtsyEventType(payload.event_type);
  const eventId = headers.get("webhook-id")!;
  const admin = createAdminClient();
  const claim = await claimEvent(admin, "etsy", eventId, eventType, payload);
  if (claim.duplicate) return { status: 200, body: { ok: true, duplicate: true } };

  const shopId = payload.shop_id != null ? String(payload.shop_id) : "";
  if (!ETSY_ORDER_EVENTS.has(eventType) || !shopId) {
    await finishEvent(admin, claim.id, "ignored", null, `Unhandled event ${eventType || "(none)"}`);
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const { data: conns } = await admin
    .from("integration_connections")
    .select("*")
    .eq("provider", "etsy")
    .eq("external_account_id", shopId)
    .in("status", ["connected", "error", "restricted"]);
  const connections = (conns ?? []) as IntegrationConnection[];
  if (!connections.length) {
    await finishEvent(admin, claim.id, "ignored", null, `No PrintFlow connection for shop ${shopId}`);
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const receiptId = receiptIdFromResourceUrl(payload.resource_url, shopId);
  // Only transient failures ask Etsy to redeliver; permanent ones (auth, missing data) are logged and acknowledged.
  const failures: string[] = [];
  const permanent: string[] = [];
  let orgId: string | null = null;
  for (const conn of connections) {
    orgId = conn.organization_id;
    const ctx = await systemContext(conn.organization_id);
    const logId = await startSyncLog(ctx, { connectionId: conn.id, provider: "etsy", operation: "webhook", trigger: "webhook", metadata: { event: eventType, receipt_id: receiptId, webhook_id: eventId } });
    const c = emptyCounters();
    try {
      if (!receiptId) throw new IntegrationError("validation", "Webhook resource_url did not reference a receipt of this shop");
      // Always re-read the receipt from Etsy rather than trusting the payload.
      const order = await etsyAdapter.getOrder(marketplaceAuth(conn, { admin }), receiptId);
      if (!order) throw new IntegrationError("validation", `Receipt ${receiptId} not found on Etsy`);
      c.processed = 1;
      const res = await processNormalizedOrder(ctx, conn, order, await loadImportCatalog(ctx, "etsy"));
      if (res.outcome === "created") c.created = 1;
      else if (res.outcome === "updated") c.updated = 1;
      else c.skipped = 1;
      await finishSyncLog(ctx, logId, c, { metadata: { event: eventType, receipt_id: receiptId, outcome: res.outcome } });
    } catch (e) {
      const message = describeIntegrationError(e, "Etsy");
      const transient = !(e instanceof IntegrationError) || e.retryable;
      (transient ? failures : permanent).push(message);
      await finishSyncLog(ctx, logId, c, { fatal: message, metadata: { event: eventType, receipt_id: receiptId, retry: transient } });
    }
  }
  if (failures.length) {
    await finishEvent(admin, claim.id, "failed", orgId, failures.join("; "));
    // Non-2xx makes Etsy retry with backoff; the scheduled sync is a second safety net.
    return { status: 500, body: { error: "Processing failed; will retry" } };
  }
  // Nothing retryable left: the delivery is done (permanent problems stay visible in sync history).
  await finishEvent(admin, claim.id, "processed", orgId, permanent.length ? permanent.join("; ") : undefined);
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------- eBay account deletion

const publicKeyCache = new Map<string, { key: string; digest: string; fetchedAt: number }>();

async function ebayPublicKey(kid: string) {
  const hit = publicKeyCache.get(kid);
  if (hit && Date.now() - hit.fetchedAt < 3600_000) return hit;
  const token = await ebayApplicationToken();
  const { data } = await requestJson<{ key?: string; digest?: string; algorithm?: string }>(
    `${ebayConfig().apiBase}/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`,
    { provider: "eBay", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  if (!data?.key) throw new Error("eBay did not return the notification public key");
  const entry = { key: data.key, digest: data.digest ?? "SHA1", fetchedAt: Date.now() };
  publicKeyCache.set(kid, entry);
  return entry;
}

/**
 * Handles eBay's Marketplace Account Deletion notification: verifies the
 * signature, then anonymises that buyer's personal data held by PrintFlow.
 */
export async function handleEbayAccountDeletion(rawBody: string, signatureHeader: string | null): Promise<WebhookResult> {
  const sig = parseEbaySignatureHeader(signatureHeader);
  if (!sig) return { status: 412, body: { error: "Missing or invalid x-ebay-signature" } };
  try {
    const pk = await ebayPublicKey(sig.kid);
    if (!verifyEbaySignature(rawBody, { ...sig, digest: pk.digest || sig.digest }, pk.key)) {
      return { status: 412, body: { error: "Signature verification failed" } };
    }
  } catch (e) {
    console.error("[ebay-deletion] verification error", e);
    return { status: 500, body: { error: "Could not verify signature" } };
  }
  let payload: EbayDeletionPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  const admin = createAdminClient();
  const eventId = payload.notification?.notificationId ?? `deletion-${Date.now()}`;
  const claim = await claimEvent(admin, "ebay", eventId, payload.metadata?.topic ?? "MARKETPLACE_ACCOUNT_DELETION", {
    topic: payload.metadata?.topic,
    // Keep only what is needed to prove compliance; the username itself is erased below.
    notificationId: payload.notification?.notificationId,
    eventDate: payload.notification?.eventDate,
  });
  if (claim.duplicate) return { status: 200, body: { ok: true } };
  const data = payload.notification?.data ?? {};
  const refs = [data.username, data.userId].filter((v): v is string => Boolean(v));
  const anonymised = refs.length ? await anonymiseEbayBuyer(admin, refs) : 0;
  await finishEvent(admin, claim.id, "processed", null, anonymised ? undefined : "No matching data held");
  return { status: 200, body: { ok: true } };
}

async function anonymiseEbayBuyer(admin: AdminClient, refs: string[]) {
  const { data: rows } = await admin.from("external_orders").select("id, organization_id, order_id").eq("sales_channel", "ebay").in("buyer_ref", refs);
  let count = 0;
  for (const row of rows ?? []) {
    count++;
    await admin
      .from("external_orders")
      .update({ buyer_name: "Deleted eBay user", buyer_ref: null, normalized: { redacted: true, reason: "eBay account deletion" } })
      .eq("id", row.id);
    if (!row.order_id) continue;
    const { data: order } = await admin.from("orders").select("customer_id").eq("id", row.order_id).maybeSingle();
    await admin
      .from("orders")
      .update({ customer_name: "Deleted eBay user", customer_email: null, customer_phone: null, billing_address: null, shipping_address: null })
      .eq("id", row.order_id);
    if (order?.customer_id) {
      // Only anonymise the customer record if all of its orders came from this buyer.
      const { data: others } = await admin
        .from("orders")
        .select("id")
        .eq("customer_id", order.customer_id)
        .neq("customer_name", "Deleted eBay user");
      if (!others?.length) {
        await admin
          .from("customers")
          .update({ name: "Deleted eBay user", email: null, phone: null, address_line1: null, address_line2: null, city: null, region: null, postcode: null, notes: null })
          .eq("id", order.customer_id);
      }
    }
  }
  return count;
}
