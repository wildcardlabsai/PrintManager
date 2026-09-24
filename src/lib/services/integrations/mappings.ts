import "server-only";
import { PROVIDER_NAMES } from "@/lib/integrations/registry";
import type { Product, ProductVariant } from "@/types/db";
import { logAudit } from "../audit";
import type { AppContext } from "../context";
import { AppError, check, checkFound } from "../errors";
import { getConnection } from "./credentials";
import { loadImportCatalog, processNormalizedOrder, type ImportOutcome } from "./import";
import type { ExternalOrderRow } from "./types";

export async function listAttentionImports(ctx: AppContext) {
  return check(
    await ctx.supabase
      .from("external_orders")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .in("import_status", ["mapping_required", "error"])
      .order("ordered_at", { ascending: false })
      .limit(200),
  ) as ExternalOrderRow[];
}

export async function countAttentionImports(ctx: AppContext) {
  const { count } = await ctx.supabase
    .from("external_orders")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.orgId)
    .eq("import_status", "mapping_required");
  return count ?? 0;
}

export async function listRecentExternalOrders(ctx: AppContext, limit = 50) {
  return check(
    await ctx.supabase
      .from("external_orders")
      .select("id, sales_channel, external_order_id, import_status, import_note, buyer_name, ordered_at, order_id, last_synced_at, external_status")
      .eq("organization_id", ctx.orgId)
      .order("last_synced_at", { ascending: false })
      .limit(limit),
  ) as Omit<ExternalOrderRow, "normalized" | "unmatched_lines" | "connection_id" | "currency" | "buyer_ref" | "external_updated_at" | "first_seen_at" | "organization_id">[];
}

export interface MappingListRow {
  id: string;
  sales_channel: "etsy" | "ebay";
  external_listing_id: string | null;
  external_product_id: string | null;
  external_sku: string | null;
  external_title: string | null;
  source: "auto" | "manual";
  created_at: string;
  product: Pick<Product, "id" | "name" | "sku"> | null;
  variant: Pick<ProductVariant, "id" | "name" | "sku"> | null;
}

export async function listMappings(ctx: AppContext) {
  return check(
    await ctx.supabase
      .from("product_mappings")
      .select("id, sales_channel, external_listing_id, external_product_id, external_sku, external_title, source, created_at, product:products(id, name, sku), variant:product_variants(id, name, sku)")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(500),
  ) as unknown as MappingListRow[];
}

/**
 * Saves a manual mapping for one unmatched line. By default it maps the
 * listing (and variation) so every future order of that listing resolves;
 * lines without a listing id map by SKU.
 */
export async function mapExternalLine(
  ctx: AppContext,
  input: { externalOrderRowId: string; externalLineId: string; productId: string; variantId: string | null },
) {
  const row = checkFound(
    await ctx.supabase.from("external_orders").select("*").eq("id", input.externalOrderRowId).eq("organization_id", ctx.orgId).maybeSingle(),
    "Imported order",
  ) as ExternalOrderRow;
  const line = row.normalized.lines.find((l) => l.externalLineId === input.externalLineId);
  if (!line) throw new AppError("That line is not part of this order.", "not_found");
  const product = checkFound(
    await ctx.supabase.from("products").select("id, name").eq("id", input.productId).eq("organization_id", ctx.orgId).maybeSingle(),
    "Product",
  ) as Pick<Product, "id" | "name">;
  if (input.variantId) {
    checkFound(await ctx.supabase.from("product_variants").select("id").eq("id", input.variantId).eq("product_id", product.id).maybeSingle(), "Variant");
  }
  const mapping = line.externalListingId
    ? { external_listing_id: line.externalListingId, external_product_id: line.externalProductId, external_sku: null }
    : { external_listing_id: null, external_product_id: null, external_sku: line.sku };
  if (!mapping.external_listing_id && !mapping.external_sku) throw new AppError("This line has neither a listing ID nor a SKU to map.", "validation");

  // Replace any previous mapping for the same identity.
  let del = ctx.supabase.from("product_mappings").delete().eq("organization_id", ctx.orgId).eq("sales_channel", row.sales_channel);
  del = mapping.external_listing_id ? del.eq("external_listing_id", mapping.external_listing_id) : del.is("external_listing_id", null);
  del = mapping.external_product_id ? del.eq("external_product_id", mapping.external_product_id) : del.is("external_product_id", null);
  del = mapping.external_sku ? del.eq("external_sku", mapping.external_sku) : del.is("external_sku", null);
  check(await del);
  check(
    await ctx.supabase.from("product_mappings").insert({
      organization_id: ctx.orgId,
      sales_channel: row.sales_channel,
      ...mapping,
      external_title: line.title.slice(0, 300),
      product_id: product.id,
      variant_id: input.variantId,
      source: "manual",
      created_by: ctx.userId,
    }),
  );
  await logAudit(ctx, "product.updated", { type: "product", id: product.id }, `${PROVIDER_NAMES[row.sales_channel]} listing "${line.title}" mapped to ${product.name}`, {
    sales_channel: row.sales_channel,
    ...mapping,
  });
}

/** Re-runs the import for a held order (after mappings were added). */
export async function retryExternalImport(ctx: AppContext, externalOrderRowId: string): Promise<ImportOutcome> {
  const row = checkFound(
    await ctx.supabase.from("external_orders").select("*").eq("id", externalOrderRowId).eq("organization_id", ctx.orgId).maybeSingle(),
    "Imported order",
  ) as ExternalOrderRow;
  if ((row.normalized as unknown as { redacted?: boolean }).redacted) throw new AppError("This order's data was erased at the buyer's request.", "validation");
  const conn = await getConnection(ctx.orgId, row.sales_channel);
  return processNormalizedOrder(ctx, conn, row.normalized, await loadImportCatalog(ctx, row.sales_channel));
}

export async function deleteMapping(ctx: AppContext, id: string) {
  check(await ctx.supabase.from("product_mappings").delete().eq("id", id).eq("organization_id", ctx.orgId));
}
