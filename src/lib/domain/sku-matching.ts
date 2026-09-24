/**
 * Matches an incoming marketplace line to a PrintFlow product/variant.
 * Order of preference: exact variant SKU, exact product SKU, then
 * case/whitespace-insensitive SKU. Titles are never used to auto-match —
 * unmatched lines are surfaced for a human to resolve.
 */
export interface SkuCatalogEntry {
  productId: string;
  variantId: string | null;
  sku: string;
}

export type SkuMatch =
  | { matched: true; productId: string; variantId: string | null; exact: boolean }
  | { matched: false; reason: "missing_sku" | "unknown_sku" };

const normalise = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

export function matchSku(sku: string | null | undefined, catalog: SkuCatalogEntry[]): SkuMatch {
  if (!sku || !sku.trim()) return { matched: false, reason: "missing_sku" };
  const variantExact = catalog.find((c) => c.variantId && c.sku === sku);
  if (variantExact) return { matched: true, productId: variantExact.productId, variantId: variantExact.variantId, exact: true };
  const productExact = catalog.find((c) => !c.variantId && c.sku === sku);
  if (productExact) return { matched: true, productId: productExact.productId, variantId: null, exact: true };
  const target = normalise(sku);
  const loose = catalog.filter((c) => normalise(c.sku) === target);
  if (loose.length === 1) return { matched: true, productId: loose[0].productId, variantId: loose[0].variantId, exact: false };
  return { matched: false, reason: "unknown_sku" };
}
