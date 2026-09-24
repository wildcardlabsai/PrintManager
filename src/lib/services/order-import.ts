import "server-only";
import { matchSku, type SkuCatalogEntry } from "@/lib/domain/sku-matching";
import type { NormalizedOrder } from "@/lib/integrations/marketplace/types";
import { orderCreateSchema } from "@/lib/validation/schemas";
import type { AppContext } from "./context";
import { check } from "./errors";
import { createOrder } from "./orders";

/**
 * Shared pipeline every marketplace adapter will feed in Phase 2:
 *
 *   adapter.fetchOrders() → NormalizedOrder
 *     → duplicate check (channel + external order ID)
 *     → SKU matching
 *     → customer match/create
 *     → createOrder() (order + items + production jobs + shipment)
 *
 * No marketplace API is called here; this only consumes normalised data.
 */
export type ImportOutcome =
  | { status: "imported"; orderId: string; orderNumber: string }
  | { status: "duplicate"; orderId: string }
  | { status: "unmatched"; lines: { title: string; sku: string | null; reason: string }[] };

export async function loadSkuCatalog(ctx: AppContext): Promise<SkuCatalogEntry[]> {
  const products = check(
    await ctx.supabase
      .from("products")
      .select("id, sku, product_variants(id, sku, is_active)")
      .eq("organization_id", ctx.orgId)
      .is("archived_at", null),
  ) as { id: string; sku: string; product_variants: { id: string; sku: string; is_active: boolean }[] }[];
  return products.flatMap((p) => [
    { productId: p.id, variantId: null, sku: p.sku },
    ...p.product_variants.filter((v) => v.is_active).map((v) => ({ productId: p.id, variantId: v.id, sku: v.sku })),
  ]);
}

export async function importNormalizedOrder(
  ctx: AppContext,
  order: NormalizedOrder,
  catalog: SkuCatalogEntry[],
): Promise<ImportOutcome> {
  const { data: existing } = await ctx.supabase
    .from("orders")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("sales_channel", order.channel)
    .eq("external_order_id", order.externalOrderId)
    .maybeSingle();
  if (existing) return { status: "duplicate", orderId: existing.id };

  const matches = order.lines.map((line) => ({ line, match: matchSku(line.sku, catalog) }));
  const unmatched = matches.filter((m) => !m.match.matched);
  if (unmatched.length) {
    return {
      status: "unmatched",
      lines: unmatched.map((m) => ({
        title: m.line.title,
        sku: m.line.sku,
        reason: m.match.matched ? "" : m.match.reason,
      })),
    };
  }

  let customerId: string | null = null;
  if (order.buyer.email) {
    const { data } = await ctx.supabase
      .from("customers")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .ilike("email", order.buyer.email)
      .limit(1)
      .maybeSingle();
    customerId = data?.id ?? null;
  }

  const input = orderCreateSchema.parse({
    customer_id: customerId,
    new_customer: customerId ? null : { name: order.buyer.name, email: order.buyer.email ?? null, phone: order.buyer.phone ?? null },
    sales_channel: order.channel,
    external_order_id: order.externalOrderId,
    order_date: order.orderedAt,
    payment_status: order.paid ? "paid" : "pending",
    items: matches.map(({ line, match }) => ({
      product_id: match.matched ? match.productId : "",
      variant_id: match.matched ? match.variantId : null,
      quantity: line.quantity,
      unit_price: line.unitPrice,
    })),
    shipping_provider: "royal_mail",
    shipping_charged: order.shippingCharged,
    discount: order.discount,
    fees: order.fees,
    shipping_address: order.shippingAddress ?? null,
    customer_notes: order.buyerNote ?? null,
  });
  const created = await createOrder(ctx, input);
  return { status: "imported", orderId: created.id, orderNumber: created.order_number };
}
