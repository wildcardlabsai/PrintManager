import "server-only";
import { describeIntegrationError, IntegrationError } from "@/lib/integrations/errors";
import { MARKETPLACES, PROVIDER_NAMES, marketplaceForChannel } from "@/lib/integrations/registry";
import type { Order, OrderItem, Shipment } from "@/types/db";
import { logAudit } from "../audit";
import type { AppContext } from "../context";
import { AppError, check, checkFound } from "../errors";
import { getConnection, marketplaceAuth } from "./credentials";
import { emptyCounters, finishSyncLog, startSyncLog } from "./sync-log";
import type { MarketplaceFulfillment } from "./types";

/** Retry schedule for failed fulfilment updates (minutes after the last attempt). */
export function nextRetryDelayMinutes(attempts: number) {
  return Math.min(2 ** Math.max(0, attempts - 1) * 5, 24 * 60);
}
export const MAX_AUTOMATIC_ATTEMPTS = 6;

export type FulfillmentOutcome =
  | { status: "synced"; alreadySynced: boolean; externalId: string | null }
  | { status: "failed"; error: string };

/**
 * Sends shipment/tracking for a shipped marketplace order back to Etsy/eBay.
 * PrintFlow records "synced" only after the marketplace confirms.
 */
export async function pushOrderFulfillment(ctx: AppContext, orderId: string, trigger: "manual" | "schedule" | "system" = "manual"): Promise<FulfillmentOutcome> {
  const order = checkFound(
    await ctx.supabase.from("orders").select("*").eq("id", orderId).eq("organization_id", ctx.orgId).maybeSingle(),
    "Order",
  ) as Order;
  const provider = marketplaceForChannel(order.sales_channel);
  if (!provider || !order.external_order_id) throw new AppError("Only Etsy and eBay orders with an external order ID can be synced.", "validation");
  if (order.status !== "shipped" && order.status !== "completed") throw new AppError("Mark the order as shipped before sending tracking to the marketplace.", "validation");
  const name = PROVIDER_NAMES[provider];

  const conn = await getConnection(ctx.orgId, provider);
  if (!conn || conn.status === "disconnected") throw new AppError(`${name} is not connected. Connect it in Settings → Integrations.`, "validation");

  const [itemsRes, shipmentRes, existingRes] = await Promise.all([
    ctx.supabase.from("order_items").select("*").eq("order_id", orderId),
    ctx.supabase.from("shipments").select("*").eq("order_id", orderId).maybeSingle(),
    ctx.supabase.from("marketplace_fulfillments").select("*").eq("order_id", orderId).maybeSingle(),
  ]);
  const items = check(itemsRes) as OrderItem[];
  const shipment = check(shipmentRes) as Shipment | null;
  const existing = check(existingRes) as MarketplaceFulfillment | null;
  const tracking = shipment?.tracking_number ?? null;

  if (existing?.status === "synced" && existing.tracking_number === tracking) {
    return { status: "synced", alreadySynced: true, externalId: existing.external_fulfillment_id };
  }

  const attempts = (existing?.attempts ?? 0) + 1;
  const base = {
    organization_id: ctx.orgId,
    order_id: orderId,
    connection_id: conn.id,
    sales_channel: order.sales_channel,
    tracking_number: tracking,
    carrier: shipment?.provider ?? null,
    attempts,
    last_attempt_at: new Date().toISOString(),
  };
  check(await ctx.supabase.from("marketplace_fulfillments").upsert({ ...base, status: "pending", error: null }, { onConflict: "order_id" }));

  const logId = await startSyncLog(ctx, { connectionId: conn.id, provider, operation: "fulfillment", trigger, metadata: { order_id: orderId, order_number: order.order_number } });
  const counters = emptyCounters();
  counters.processed = 1;
  try {
    const result = await MARKETPLACES[provider].pushFulfillment(marketplaceAuth(conn), {
      externalOrderId: order.external_order_id,
      lines: items.filter((i) => i.external_line_id).map((i) => ({ externalLineId: i.external_line_id!, quantity: i.quantity })),
      trackingNumber: tracking,
      provider: shipment?.provider ?? "royal_mail",
      service: shipment?.service ?? null,
      shippedAt: shipment?.shipped_at ?? order.shipped_at ?? new Date().toISOString(),
    });
    check(
      await ctx.supabase
        .from("marketplace_fulfillments")
        .update({ status: "synced", synced_at: new Date().toISOString(), external_fulfillment_id: result.externalFulfillmentId, response: result.response, error: null })
        .eq("order_id", orderId),
    );
    counters.updated = 1;
    await finishSyncLog(ctx, logId, counters, { metadata: { order_id: orderId, external_fulfillment_id: result.externalFulfillmentId } });
    await logAudit(ctx, "shipment.updated", { type: "order", id: orderId }, `Tracking sent to ${name} for ${order.order_number}`, {
      order_id: orderId,
      provider,
      tracking_number: tracking,
    });
    return { status: "synced", alreadySynced: false, externalId: result.externalFulfillmentId };
  } catch (e) {
    const message = describeIntegrationError(e, name);
    await ctx.supabase
      .from("marketplace_fulfillments")
      .update({ status: "failed", error: message, response: e instanceof IntegrationError ? { status: e.details.status ?? null } : null })
      .eq("order_id", orderId);
    await finishSyncLog(ctx, logId, counters, { fatal: message, metadata: { order_id: orderId } });
    return { status: "failed", error: message };
  }
}

export async function getOrderFulfillment(ctx: AppContext, orderId: string) {
  const { data } = await ctx.supabase.from("marketplace_fulfillments").select("*").eq("order_id", orderId).maybeSingle();
  return (data as MarketplaceFulfillment | null) ?? null;
}
