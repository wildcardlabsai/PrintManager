import "server-only";
import { describeIntegrationError } from "@/lib/integrations/errors";
import { SHIPPING_INTEGRATIONS } from "@/lib/integrations/shipping/registry";
import type { PackageFormat } from "@/lib/integrations/shipping/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Order, OrderItem, Shipment } from "@/types/db";
import { logAudit } from "../audit";
import type { AppContext } from "../context";
import { AppError, check, checkFound } from "../errors";
import { hasAddress } from "../orders";
import { getApiKey, getConnection } from "./credentials";
import { emptyCounters, finishSyncLog, startSyncLog } from "./sync-log";

export const LABEL_BUCKET = "shipping-labels";

export interface LabelInput {
  weightGrams: number;
  format: PackageFormat;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  serviceCode: string | null;
  /** The user explicitly confirmed a second label for an order that already has one. */
  allowAdditional?: boolean;
}

/** The connected shipping provider for this business, if any. */
export async function activeShippingConnection(ctx: AppContext) {
  const { data } = await ctx.supabase
    .from("integration_connections")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .eq("kind", "shipping")
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();
  return data as import("./types").IntegrationConnection | null;
}

export async function createShippingLabel(ctx: AppContext, orderId: string, input: LabelInput) {
  const conn = await activeShippingConnection(ctx);
  if (!conn) throw new AppError("No shipping provider connected. Connect Royal Mail Click & Drop in Settings → Integrations.", "validation");
  const provider = SHIPPING_INTEGRATIONS[conn.provider];
  if (!provider?.capabilities.createLabel) throw new AppError("This shipping provider cannot create labels.", "validation");

  const order = checkFound(
    await ctx.supabase.from("orders").select("*").eq("id", orderId).eq("organization_id", ctx.orgId).maybeSingle(),
    "Order",
  ) as Order;
  if (["cancelled", "completed"].includes(order.status)) throw new AppError(`A ${order.status} order can't have a new label.`, "validation");
  const shipment = checkFound(await ctx.supabase.from("shipments").select("*").eq("order_id", orderId).maybeSingle(), "Shipment") as Shipment;
  if (shipment.external_shipment_id && !input.allowAdditional) {
    throw new AppError("This order already has a label/shipment at the carrier. Confirm to create another one.", "conflict");
  }
  if (!hasAddress(order.shipping_address)) throw new AppError("Add a shipping address to the order first.", "validation");
  const items = check(await ctx.supabase.from("order_items").select("*").eq("order_id", orderId)) as OrderItem[];

  const logId = await startSyncLog(ctx, { connectionId: conn.id, provider: conn.provider, operation: "label", trigger: "manual", metadata: { order_id: orderId, order_number: order.order_number } });
  const counters = emptyCounters();
  counters.processed = 1;
  try {
    const result = await provider.createLabel(
      { apiKey: await getApiKey(conn.id), config: conn.config },
      {
        orderNumber: order.order_number,
        orderDate: order.order_date,
        serviceCode: input.serviceCode,
        recipient: { name: order.customer_name, email: order.customer_email, phone: order.customer_phone, address: order.shipping_address! },
        parcel: { weightGrams: input.weightGrams, format: input.format, lengthMm: input.lengthMm, widthMm: input.widthMm, heightMm: input.heightMm },
        contents: items.map((i) => ({
          name: [i.product_name, i.variant_name].filter(Boolean).join(" — "),
          sku: i.sku,
          quantity: i.quantity,
          unitValue: Number(i.unit_price),
          unitWeightGrams: null,
        })),
        subtotal: Number(order.subtotal),
        shippingCharged: Number(order.shipping_charged),
        total: Number(order.total),
        currency: ctx.settings.currency,
      },
    );

    let storagePath: string | null = null;
    if (result.labelPdf) {
      storagePath = `${ctx.orgId}/${shipment.id}-${result.externalShipmentId}.pdf`;
      const { error } = await createAdminClient().storage.from(LABEL_BUCKET).upload(storagePath, result.labelPdf, { contentType: "application/pdf", upsert: true });
      if (error) {
        console.error("[labels] storage", error);
        storagePath = null;
      }
    }
    check(
      await ctx.supabase
        .from("shipments")
        .update({
          provider: provider.provider,
          external_shipment_id: result.externalShipmentId,
          tracking_number: result.trackingNumber ?? shipment.tracking_number,
          label_status: result.labelStatus,
          label_provider: conn.provider,
          label_storage_path: storagePath,
          label_created_at: new Date().toISOString(),
          label_error: result.message,
          package_weight_g: Math.round(input.weightGrams),
          package_format: input.format,
          package_length_mm: input.lengthMm,
          package_width_mm: input.widthMm,
          package_height_mm: input.heightMm,
          ...(result.cost != null ? { shipping_cost: result.cost } : {}),
        })
        .eq("id", shipment.id),
    );
    counters.created = 1;
    await finishSyncLog(ctx, logId, counters, { metadata: { order_id: orderId, external_shipment_id: result.externalShipmentId, label_status: result.labelStatus } });
    await logAudit(ctx, "shipment.updated", { type: "shipment", id: shipment.id }, `${provider.name} shipment ${result.externalShipmentId} created for ${order.order_number}`, {
      order_id: orderId,
      label_status: result.labelStatus,
      tracking_number: result.trackingNumber,
    });
    return result;
  } catch (e) {
    const message = describeIntegrationError(e, provider.name);
    await ctx.supabase.from("shipments").update({ label_error: message }).eq("id", shipment.id);
    await finishSyncLog(ctx, logId, counters, { fatal: message, metadata: { order_id: orderId } });
    throw new AppError(message, "validation");
  }
}

/** Reads the tracking number/shipped date back from the carrier. */
export async function refreshLabelTracking(ctx: AppContext, orderId: string) {
  const shipment = checkFound(
    await ctx.supabase.from("shipments").select("*").eq("order_id", orderId).eq("organization_id", ctx.orgId).maybeSingle(),
    "Shipment",
  ) as Shipment;
  if (!shipment.external_shipment_id || !shipment.label_provider) throw new AppError("This order has no carrier shipment yet.", "validation");
  const conn = await getConnection(ctx.orgId, shipment.label_provider as "royal_mail_click_drop");
  const provider = SHIPPING_INTEGRATIONS[shipment.label_provider];
  if (!conn || conn.status !== "connected" || !provider?.getTracking) throw new AppError("The shipping provider is not connected.", "validation");
  try {
    const t = await provider.getTracking({ apiKey: await getApiKey(conn.id), config: conn.config }, shipment.external_shipment_id);
    const patch: Partial<Shipment> = {};
    if (t.trackingNumber && t.trackingNumber !== shipment.tracking_number) patch.tracking_number = t.trackingNumber;
    if (t.trackingNumber && shipment.label_status === "pending") {
      patch.label_status = "created";
      patch.label_error = null;
    }
    if (Object.keys(patch).length) check(await ctx.supabase.from("shipments").update(patch).eq("id", shipment.id));
    return t;
  } catch (e) {
    throw new AppError(describeIntegrationError(e, provider.name), "validation");
  }
}

/** Label PDF for download: stored copy first, otherwise from the carrier (OBA accounts). */
export async function getLabelPdf(ctx: AppContext, orderId: string): Promise<{ pdf: Buffer; filename: string }> {
  const shipment = checkFound(
    await ctx.supabase.from("shipments").select("*, order:orders!inner(order_number)").eq("order_id", orderId).eq("organization_id", ctx.orgId).maybeSingle(),
    "Shipment",
  ) as Shipment & { order: { order_number: string } };
  const filename = `label-${shipment.order.order_number}.pdf`;
  if (shipment.label_storage_path) {
    const { data, error } = await createAdminClient().storage.from(LABEL_BUCKET).download(shipment.label_storage_path);
    if (!error && data) return { pdf: Buffer.from(await data.arrayBuffer()), filename };
  }
  if (!shipment.external_shipment_id || !shipment.label_provider) throw new AppError("No label exists for this order.", "not_found");
  const conn = await getConnection(ctx.orgId, shipment.label_provider as "royal_mail_click_drop");
  const provider = SHIPPING_INTEGRATIONS[shipment.label_provider];
  if (!conn || !provider?.retrieveLabel) throw new AppError("The label can't be downloaded from this provider.", "not_found");
  try {
    return { pdf: await provider.retrieveLabel({ apiKey: await getApiKey(conn.id), config: conn.config }, shipment.external_shipment_id), filename };
  } catch (e) {
    throw new AppError(describeIntegrationError(e, provider.name), "validation");
  }
}
