import { matchSku, type SkuCatalogEntry } from "./sku-matching";

/**
 * Resolves a marketplace order line to a PrintFlow product/variant.
 * Order of precedence:
 *   1. an explicit mapping for the listing (+ variation product id)
 *   2. an explicit mapping for the listing alone
 *   3. an explicit mapping for the SKU
 *   4. automatic SKU match against the catalogue (exact variant SKU, exact
 *      product SKU, then unambiguous case/space-insensitive match)
 * Titles are never used to guess. Anything else is "mapping required".
 */
export interface MappingRow {
  external_listing_id: string | null;
  external_product_id: string | null;
  external_sku: string | null;
  product_id: string;
  variant_id: string | null;
}

export interface LineRef {
  externalListingId: string | null;
  externalProductId: string | null;
  sku: string | null;
}

export type LineResolution =
  | { resolved: true; productId: string; variantId: string | null; via: "mapping" | "sku"; exact: boolean }
  | { resolved: false; reason: "missing_sku" | "unknown_sku" };

export function resolveLine(line: LineRef, mappings: MappingRow[], catalog: SkuCatalogEntry[]): LineResolution {
  const byListing = (withProduct: boolean) =>
    mappings.find(
      (m) =>
        line.externalListingId &&
        m.external_listing_id === line.externalListingId &&
        (withProduct ? m.external_product_id != null && m.external_product_id === line.externalProductId : m.external_product_id == null) &&
        m.external_sku == null,
    );
  const hit =
    byListing(true) ??
    byListing(false) ??
    (line.sku ? mappings.find((m) => m.external_sku != null && m.external_sku === line.sku && m.external_listing_id == null) : undefined);
  if (hit) return { resolved: true, productId: hit.product_id, variantId: hit.variant_id, via: "mapping", exact: true };

  const sku = matchSku(line.sku, catalog);
  if (sku.matched) return { resolved: true, productId: sku.productId, variantId: sku.variantId, via: "sku", exact: sku.exact };
  return { resolved: false, reason: sku.reason };
}

export type NewOrderDecision =
  | { action: "create" }
  | { action: "skip"; importStatus: "awaiting_payment" | "cancelled" | "skipped"; note: string };

/**
 * Whether a marketplace order PrintFlow has never seen should become a
 * PrintFlow order. Only paid, not-yet-shipped orders create production work.
 */
export function decideNewOrder(status: "awaiting_payment" | "paid" | "shipped" | "completed" | "cancelled" | "refunded"): NewOrderDecision {
  switch (status) {
    case "paid":
      return { action: "create" };
    case "awaiting_payment":
      return { action: "skip", importStatus: "awaiting_payment", note: "Waiting for payment — will import once paid." };
    case "cancelled":
    case "refunded":
      return { action: "skip", importStatus: "cancelled", note: "Cancelled or refunded on the marketplace before import." };
    case "shipped":
    case "completed":
      return { action: "skip", importStatus: "skipped", note: "Already shipped on the marketplace before it was imported." };
  }
}
