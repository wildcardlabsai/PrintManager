import "server-only";
import { decideNewOrder, resolveLine, type MappingRow } from "@/lib/domain/mapping";
import type { SkuCatalogEntry } from "@/lib/domain/sku-matching";
import type { NormalizedOrder } from "@/lib/integrations/marketplace/types";
import { PROVIDER_NAMES } from "@/lib/integrations/registry";
import { orderCreateSchema } from "@/lib/validation/schemas";
import type { Address, Customer, Order } from "@/types/db";
import { logAudit } from "../audit";
import type { AppContext } from "../context";
import { AppError, check } from "../errors";
import { changeOrderStatus, createOrder } from "../orders";
import type { ExternalOrderRow, IntegrationConnection } from "./types";

export type ImportOutcome =
  | { outcome: "created"; orderId: string; orderNumber: string }
  | { outcome: "updated"; orderId: string; changes: string[] }
  | { outcome: "unchanged"; orderId: string }
  | { outcome: "skipped"; importStatus: ExternalOrderRow["import_status"]; note: string };

/** Everything the pipeline needs to resolve products, loaded once per sync. */
export interface ImportCatalog {
  mappings: MappingRow[];
  skus: SkuCatalogEntry[];
}

export async function loadImportCatalog(ctx: AppContext, channel: "etsy" | "ebay"): Promise<ImportCatalog> {
  const [mappings, products] = await Promise.all([
    ctx.supabase
      .from("product_mappings")
      .select("external_listing_id, external_product_id, external_sku, product_id, variant_id")
      .eq("organization_id", ctx.orgId)
      .eq("sales_channel", channel),
    ctx.supabase
      .from("products")
      .select("id, sku, product_variants(id, sku, is_active)")
      .eq("organization_id", ctx.orgId)
      .is("archived_at", null),
  ]);
  const rows = check(products) as { id: string; sku: string; product_variants: { id: string; sku: string; is_active: boolean }[] }[];
  return {
    mappings: check(mappings) as MappingRow[],
    skus: rows.flatMap((p) => [
      { productId: p.id, variantId: null, sku: p.sku },
      ...p.product_variants.filter((v) => v.is_active).map((v) => ({ productId: p.id, variantId: v.id, sku: v.sku })),
    ]),
  };
}

async function upsertExternalOrder(
  ctx: AppContext,
  conn: IntegrationConnection | null,
  order: NormalizedOrder,
  patch: Partial<Pick<ExternalOrderRow, "import_status" | "import_note" | "order_id" | "unmatched_lines">>,
) {
  const { error } = await ctx.supabase.from("external_orders").upsert(
    {
      organization_id: ctx.orgId,
      connection_id: conn?.id ?? null,
      sales_channel: order.channel,
      external_order_id: order.externalOrderId,
      external_status: order.externalStatusRaw,
      currency: order.currency,
      buyer_name: order.buyer.name,
      buyer_ref: order.buyer.externalBuyerId,
      ordered_at: order.orderedAt,
      external_updated_at: order.updatedAt,
      normalized: order,
      last_synced_at: new Date().toISOString(),
      ...patch,
    },
    { onConflict: "organization_id,sales_channel,external_order_id" },
  );
  if (error) throw new AppError(`Could not record external order ${order.externalOrderId}: ${error.message}`);
}

async function findOrder(ctx: AppContext, order: NormalizedOrder) {
  const { data } = await ctx.supabase
    .from("orders")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .eq("sales_channel", order.channel)
    .eq("external_order_id", order.externalOrderId)
    .maybeSingle();
  return (data as Order | null) ?? null;
}

/** Match an existing customer by email, then by name + postcode; otherwise create one. */
async function matchOrCreateCustomer(ctx: AppContext, order: NormalizedOrder): Promise<string> {
  if (order.buyer.email) {
    const { data } = await ctx.supabase
      .from("customers")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .ilike("email", order.buyer.email.replace(/[%_]/g, "\\$&"))
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    if (data) return data.id;
  }
  const postcode = order.shippingAddress?.postcode?.trim();
  if (postcode) {
    const { data } = await ctx.supabase
      .from("customers")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .ilike("name", order.buyer.name.replace(/[%_]/g, "\\$&"))
      .ilike("postcode", postcode.replace(/[%_]/g, "\\$&"))
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    if (data) return data.id;
  }
  const a = order.shippingAddress;
  const created = check(
    await ctx.supabase
      .from("customers")
      .insert({
        organization_id: ctx.orgId,
        name: order.buyer.name.slice(0, 200),
        email: order.buyer.email,
        phone: order.buyer.phone,
        address_line1: a?.line1 ?? null,
        address_line2: a?.line2 ?? null,
        city: a?.city ?? null,
        region: a?.region ?? null,
        postcode: a?.postcode ?? null,
        country: a?.country ?? null,
        notes: `Created from ${PROVIDER_NAMES[order.channel as "etsy" | "ebay"]} order ${order.externalOrderId}`,
      })
      .select("id, name")
      .single(),
  ) as Pick<Customer, "id" | "name">;
  await logAudit(ctx, "customer.created", { type: "customer", id: created.id }, `Customer ${created.name} created from marketplace order`, {
    source: order.channel,
  });
  return created.id;
}

function sameAddress(a: Address | null, b: Address | null) {
  const k = (x: Address | null) => JSON.stringify([x?.line1, x?.line2, x?.city, x?.region, x?.postcode, x?.country].map((v) => (v ?? "").trim().toLowerCase()));
  return k(a) === k(b);
}

/** Apply marketplace-side changes to an order PrintFlow already has. Never creates duplicates. */
async function updateExistingOrder(ctx: AppContext, existing: Order, order: NormalizedOrder): Promise<string[]> {
  const changes: string[] = [];
  const label = PROVIDER_NAMES[order.channel as "etsy" | "ebay"];
  const closed = ["shipped", "completed", "cancelled"].includes(existing.status);

  if ((order.status === "cancelled" || order.status === "refunded") && !closed) {
    await changeOrderStatus(ctx, existing.id, "cancelled", `Cancelled on ${label}`);
    changes.push("cancelled");
  }
  if (order.status === "refunded" && existing.payment_status !== "refunded") {
    check(await ctx.supabase.from("orders").update({ payment_status: "refunded" }).eq("id", existing.id));
    changes.push("payment refunded");
  }
  if ((order.status === "shipped" || order.status === "completed") && !closed) {
    // Shipped directly on the marketplace: record it, don't push anything back.
    const tracked = order.marketplaceShipments.find((s) => s.trackingNumber);
    if (tracked) {
      await ctx.supabase
        .from("shipments")
        .update({ tracking_number: tracked.trackingNumber, label_status: "manual", shipped_at: tracked.shippedAt ?? new Date().toISOString() })
        .eq("order_id", existing.id)
        .is("tracking_number", null);
    }
    await changeOrderStatus(ctx, existing.id, "shipped", `Marked shipped on ${label}`);
    await ctx.supabase
      .from("marketplace_fulfillments")
      .upsert(
        {
          organization_id: ctx.orgId,
          order_id: existing.id,
          connection_id: existing.integration_connection_id,
          sales_channel: order.channel,
          status: "synced",
          tracking_number: tracked?.trackingNumber ?? null,
          carrier: tracked?.carrier ?? null,
          synced_at: new Date().toISOString(),
          response: { source: "marketplace", note: `Shipped on ${label} directly` },
        },
        { onConflict: "order_id", ignoreDuplicates: true },
      );
    changes.push("shipped on marketplace");
  }
  // Address corrections before the parcel goes out.
  const editable = ["new", "confirmed", "awaiting_print", "printing", "printed", "on_hold"].includes(existing.status);
  if (editable && order.shippingAddress && !sameAddress(existing.shipping_address, order.shippingAddress)) {
    check(await ctx.supabase.from("orders").update({ shipping_address: order.shippingAddress }).eq("id", existing.id));
    changes.push("address updated");
  }
  const patch: Record<string, unknown> = { last_external_sync_at: new Date().toISOString() };
  if (order.externalStatusRaw !== existing.external_status) patch.external_status = order.externalStatusRaw;
  check(await ctx.supabase.from("orders").update(patch).eq("id", existing.id));
  if (changes.length) {
    await logAudit(ctx, "order.updated", { type: "order", id: existing.id }, `Order ${existing.order_number} updated from ${label}: ${changes.join(", ")}`, {
      source: order.channel,
      changes,
    });
  }
  return changes;
}

/**
 * The shared pipeline for one marketplace order:
 *   duplicate check → (existing: update) → payment/state gate → product
 *   mapping → customer match → create order + production jobs.
 * Unresolved products stop the import with MAPPING REQUIRED; no order and no
 * production work is created until they are mapped.
 */
export async function processNormalizedOrder(
  ctx: AppContext,
  conn: IntegrationConnection | null,
  order: NormalizedOrder,
  catalog: ImportCatalog,
): Promise<ImportOutcome> {
  // 1. Duplicate detection: (organization, sales_channel, external_order_id) is unique.
  const existing = await findOrder(ctx, order);
  if (existing) {
    const changes = await updateExistingOrder(ctx, existing, order);
    await upsertExternalOrder(ctx, conn, order, { import_status: "imported", import_note: null, order_id: existing.id, unmatched_lines: [] });
    return changes.length ? { outcome: "updated", orderId: existing.id, changes } : { outcome: "unchanged", orderId: existing.id };
  }

  // 2. Only paid, unshipped orders become production work.
  const decision = decideNewOrder(order.status);
  if (decision.action === "skip") {
    await upsertExternalOrder(ctx, conn, order, { import_status: decision.importStatus, import_note: decision.note, unmatched_lines: [] });
    return { outcome: "skipped", importStatus: decision.importStatus, note: decision.note };
  }
  if (!order.lines.length) {
    const note = "The marketplace order has no line items.";
    await upsertExternalOrder(ctx, conn, order, { import_status: "error", import_note: note });
    return { outcome: "skipped", importStatus: "error", note };
  }

  // 3. Product mapping.
  const resolved = order.lines.map((line) => ({ line, r: resolveLine(line, catalog.mappings, catalog.skus) }));
  const unmatched = resolved.filter((x) => !x.r.resolved);
  if (unmatched.length) {
    const note = `${unmatched.length} item${unmatched.length === 1 ? "" : "s"} need${unmatched.length === 1 ? "s" : ""} a product mapping.`;
    await upsertExternalOrder(ctx, conn, order, {
      import_status: "mapping_required",
      import_note: note,
      unmatched_lines: unmatched.map(({ line, r }) => ({
        externalLineId: line.externalLineId,
        title: line.title,
        sku: line.sku,
        externalListingId: line.externalListingId,
        externalProductId: line.externalProductId,
        variation: line.variation,
        reason: r.resolved ? "" : r.reason,
      })),
    });
    return { outcome: "skipped", importStatus: "mapping_required", note };
  }

  // Remember automatic SKU matches so they are visible (and editable) as mappings.
  const autoMappings = resolved
    .filter((x) => x.r.resolved && x.r.via === "sku" && x.line.externalListingId)
    .map(({ line, r }) => ({
      organization_id: ctx.orgId,
      sales_channel: order.channel,
      external_listing_id: line.externalListingId,
      external_product_id: line.externalProductId,
      external_sku: null,
      external_title: line.title.slice(0, 300),
      product_id: r.resolved ? r.productId : "",
      variant_id: r.resolved ? r.variantId : null,
      source: "auto",
      created_by: ctx.userId,
    }));
  if (autoMappings.length) {
    const { error } = await ctx.supabase.from("product_mappings").insert(autoMappings);
    if (error && error.code !== "23505") console.error("[import] auto mapping insert failed", error);
    catalog.mappings.push(...autoMappings.map((m) => ({ ...m, variant_id: m.variant_id })));
  }

  // 4. Customer.
  const customerId = await matchOrCreateCustomer(ctx, order);

  // 5. Create the PrintFlow order (and its production jobs) through the normal order service.
  const label = PROVIDER_NAMES[order.channel as "etsy" | "ebay"];
  const notes = [`Imported from ${label} order ${order.externalOrderId}.`];
  if (order.currency !== ctx.settings.currency) notes.push(`Marketplace currency is ${order.currency}; amounts are shown as recorded.`);
  const subtotal = order.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const input = orderCreateSchema.parse({
    customer_id: customerId,
    sales_channel: order.channel,
    external_order_id: order.externalOrderId,
    order_date: order.orderedAt,
    payment_status: "paid",
    items: resolved.map(({ line, r }) => ({
      product_id: r.resolved ? r.productId : "",
      variant_id: r.resolved ? r.variantId : null,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      external_line_id: line.externalLineId,
      external_listing_id: line.externalListingId,
    })),
    shipping_provider: ctx.settings.default_shipping_provider,
    shipping_charged: order.shippingCharged,
    postage_cost: 0,
    discount: Math.min(order.discount, subtotal + order.shippingCharged),
    fees: order.fees,
    shipping_address: order.shippingAddress,
    customer_notes: order.buyerNote,
    internal_notes: notes.join(" "),
  });
  try {
    const created = await createOrder(ctx, input, {
      orderDate: order.orderedAt,
      integration: { connectionId: conn?.id ?? "", externalStatus: order.externalStatusRaw },
    });
    await upsertExternalOrder(ctx, conn, order, { import_status: "imported", import_note: null, order_id: created.id, unmatched_lines: [] });
    return { outcome: "created", orderId: created.id, orderNumber: created.order_number };
  } catch (e) {
    // A concurrent webhook/sync may have created it a moment ago: fall back to the update path.
    if (e instanceof AppError && e.code === "conflict") {
      const again = await findOrder(ctx, order);
      if (again) {
        await upsertExternalOrder(ctx, conn, order, { import_status: "imported", import_note: null, order_id: again.id, unmatched_lines: [] });
        return { outcome: "unchanged", orderId: again.id };
      }
    }
    throw e;
  }
}
