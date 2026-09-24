import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Etsy webhooks follow the Standard Webhooks signing scheme:
 *   signed content = `${webhook-id}.${webhook-timestamp}.${raw body}`
 *   signature      = base64(HMAC-SHA256(secret, signed content)), sent as "v1,<sig>"
 *   secret         = the "whsec_…" signing secret from the Etsy developer portal
 * The header may carry several space-separated signatures (key rotation).
 */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type WebhookVerification = { ok: true } | { ok: false; reason: string };

export function signEtsyWebhook(secret: string, id: string, timestamp: string, body: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export function verifyEtsyWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): WebhookVerification {
  if (!secret) return { ok: false, reason: "ETSY_WEBHOOK_SECRET is not configured" };
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "Missing webhook signature headers" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "Invalid webhook timestamp" };
  if (Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: "Webhook timestamp outside tolerance" };

  const expected = Buffer.from(signEtsyWebhook(secret, id, timestamp, rawBody));
  const candidates = signature
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .map((part) => Buffer.from(part.slice(3)));
  const match = candidates.some((c) => c.length === expected.length && timingSafeEqual(c, expected));
  return match ? { ok: true } : { ok: false, reason: "Signature mismatch" };
}

export interface EtsyWebhookPayload {
  event_type?: string;
  resource_url?: string;
  shop_id?: number | string;
}

/** "ORDER_PAID" / "order.paid" -> "order.paid" */
export function normaliseEtsyEventType(t: string | undefined | null) {
  return (t ?? "").trim().toLowerCase().replace(/_/g, ".");
}

/**
 * Extracts the receipt id from resource_url, accepting only Etsy API receipt
 * URLs for the notifying shop (the URL is never fetched as-is).
 */
export function receiptIdFromResourceUrl(resourceUrl: string | undefined, shopId: string): string | null {
  if (!resourceUrl) return null;
  const m = /\/v3\/application\/shops\/(\d+)\/receipts\/(\d+)(?:[/?#]|$)/.exec(resourceUrl);
  if (!m || m[1] !== shopId) return null;
  return m[2];
}
