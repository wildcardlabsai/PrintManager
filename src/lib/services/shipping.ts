import "server-only";
import type { ShipmentInput } from "@/lib/validation/schemas";
import type { Order, Shipment } from "@/types/db";
import { logAudit } from "./audit";
import type { AppContext } from "./context";
import { check, checkFound } from "./errors";
import { changeOrderStatus, recalculateOrderProfit } from "./orders";

export const SHIPPING_VIEWS = {
  to_ship: { label: "To ship", statuses: ["printed", "packing", "ready_to_ship"] },
  awaiting_tracking: { label: "Missing tracking", statuses: ["packing", "ready_to_ship", "shipped"] },
  shipped: { label: "Shipped", statuses: ["shipped", "completed"] },
} as const;
export type ShippingView = keyof typeof SHIPPING_VIEWS;

export interface ShipmentRow extends Shipment {
  order: Pick<Order, "id" | "order_number" | "customer_name" | "status" | "sales_channel" | "shipping_address" | "order_date" | "total">;
}

export async function listShipments(ctx: AppContext, view: ShippingView = "to_ship"): Promise<ShipmentRow[]> {
  let q = ctx.supabase
    .from("shipments")
    .select(
      "*, order:orders!inner(id, order_number, customer_name, status, sales_channel, shipping_address, order_date, total)",
    )
    .eq("organization_id", ctx.orgId)
    .in("order.status", [...SHIPPING_VIEWS[view].statuses])
    .limit(200);
  if (view === "awaiting_tracking") q = q.is("tracking_number", null);
  if (view === "shipped") q = q.order("shipped_at", { ascending: false, nullsFirst: false });
  else q = q.order("created_at", { ascending: true });
  return check(await q) as ShipmentRow[];
}

export async function updateShipment(ctx: AppContext, orderId: string, input: ShipmentInput) {
  const before = checkFound(
    await ctx.supabase
      .from("shipments")
      .select("*")
      .eq("order_id", orderId)
      .eq("organization_id", ctx.orgId)
      .maybeSingle(),
    "Shipment",
  ) as Shipment;
  const label_status =
    input.tracking_number && before.label_status === "not_created" ? "manual" : before.label_status;
  const shipment = check(
    await ctx.supabase
      .from("shipments")
      .update({ ...input, label_status })
      .eq("id", before.id)
      .select("*")
      .single(),
  ) as Shipment;
  if (Number(before.shipping_cost) !== Number(input.shipping_cost)) await recalculateOrderProfit(ctx, orderId);
  await logAudit(
    ctx,
    "shipment.updated",
    { type: "shipment", id: shipment.id },
    input.tracking_number && input.tracking_number !== before.tracking_number
      ? `Tracking ${input.tracking_number} added`
      : "Shipping details updated",
    { order_id: orderId, provider: input.provider, tracking_number: input.tracking_number },
  );
  return shipment;
}

/** Saves shipping details and moves the order to Shipped in one step. */
export async function markOrderShipped(ctx: AppContext, orderId: string, input: ShipmentInput) {
  await updateShipment(ctx, orderId, input);
  await changeOrderStatus(ctx, orderId, "shipped");
}
