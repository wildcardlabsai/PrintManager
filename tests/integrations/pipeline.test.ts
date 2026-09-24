import { describe, expect, it } from "vitest";
import { decideNewOrder, resolveLine, type MappingRow } from "@/lib/domain/mapping";
import { mergeOrderLines } from "@/lib/domain/order-pricing";
import { isoFromCountry } from "@/lib/domain/countries";

const catalog = [
  { productId: "p-display", variantId: null, sku: "PCD-01" },
  { productId: "p-display", variantId: "v-black", sku: "PCD-BLK-01" },
  { productId: "p-keyring", variantId: null, sku: "KEY-01" },
];

describe("line → product resolution", () => {
  it("auto-maps by exact SKU (variant first)", () => {
    expect(resolveLine({ externalListingId: "1", externalProductId: null, sku: "PCD-BLK-01" }, [], catalog)).toEqual({
      resolved: true,
      productId: "p-display",
      variantId: "v-black",
      via: "sku",
      exact: true,
    });
  });
  it("prefers explicit listing mappings over SKUs, including per-variation mappings", () => {
    const mappings: MappingRow[] = [
      { external_listing_id: "555", external_product_id: null, external_sku: null, product_id: "p-keyring", variant_id: null },
      { external_listing_id: "555", external_product_id: "777", external_sku: null, product_id: "p-display", variant_id: "v-black" },
    ];
    expect(resolveLine({ externalListingId: "555", externalProductId: "777", sku: "KEY-01" }, mappings, catalog)).toMatchObject({ productId: "p-display", variantId: "v-black", via: "mapping" });
    expect(resolveLine({ externalListingId: "555", externalProductId: "999", sku: null }, mappings, catalog)).toMatchObject({ productId: "p-keyring", via: "mapping" });
  });
  it("uses SKU-only mappings when there is no listing mapping", () => {
    const mappings: MappingRow[] = [{ external_listing_id: null, external_product_id: null, external_sku: "OLD-SKU", product_id: "p-keyring", variant_id: null }];
    expect(resolveLine({ externalListingId: "1", externalProductId: null, sku: "OLD-SKU" }, mappings, catalog)).toMatchObject({ productId: "p-keyring", via: "mapping" });
  });
  it("reports MAPPING REQUIRED instead of guessing", () => {
    expect(resolveLine({ externalListingId: "1", externalProductId: null, sku: "NOPE" }, [], catalog)).toEqual({ resolved: false, reason: "unknown_sku" });
    expect(resolveLine({ externalListingId: "1", externalProductId: null, sku: null }, [], catalog)).toEqual({ resolved: false, reason: "missing_sku" });
  });
});

describe("import decisions", () => {
  it("only paid, unshipped orders create production work", () => {
    expect(decideNewOrder("paid")).toEqual({ action: "create" });
    expect(decideNewOrder("awaiting_payment")).toMatchObject({ action: "skip", importStatus: "awaiting_payment" });
    expect(decideNewOrder("cancelled")).toMatchObject({ action: "skip", importStatus: "cancelled" });
    expect(decideNewOrder("refunded")).toMatchObject({ action: "skip", importStatus: "cancelled" });
    expect(decideNewOrder("shipped")).toMatchObject({ action: "skip", importStatus: "skipped" });
  });
  it("keeps separate marketplace lines separate but merges manual duplicates", () => {
    expect(
      mergeOrderLines([
        { productId: "a", variantId: null, quantity: 1, externalLineId: "t1" },
        { productId: "a", variantId: null, quantity: 1, externalLineId: "t2" },
      ]),
    ).toHaveLength(2);
    expect(
      mergeOrderLines([
        { productId: "a", variantId: null, quantity: 1 },
        { productId: "a", variantId: null, quantity: 2 },
      ]),
    ).toEqual([{ productId: "a", variantId: null, quantity: 3 }]);
  });
  it("converts countries for carriers", () => {
    expect(isoFromCountry("United Kingdom")).toBe("GB");
    expect(isoFromCountry("uk")).toBe("GB");
    expect(isoFromCountry("de")).toBe("DE");
    expect(isoFromCountry("Narnia")).toBeNull();
  });
});
