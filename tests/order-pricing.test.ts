import { describe, expect, it } from "vitest";
import { calculateOrderTotals, mergeOrderLines } from "@/lib/domain/order-pricing";

describe("calculateOrderTotals", () => {
  it("computes total and profit", () => {
    const t = calculateOrderTotals({
      lines: [
        { quantity: 3, unitPrice: 12.99, unitCost: 2.6 },
        { quantity: 1, unitPrice: 6.99, unitCost: 1.2 },
      ],
      shippingCharged: 2.99,
      discount: 1,
      fees: 2.1,
      postageCost: 2.7,
    });
    expect(t.subtotal).toBe(45.96);
    expect(t.total).toBe(47.95);
    expect(t.productCost).toBe(9);
    expect(t.estimatedProfit).toBe(34.15);
  });

  it("caps the discount at the order value", () => {
    const t = calculateOrderTotals({ lines: [{ quantity: 1, unitPrice: 5, unitCost: 1 }], shippingCharged: 0, discount: 50 });
    expect(t.discount).toBe(5);
    expect(t.total).toBe(0);
  });

  it("avoids floating point drift", () => {
    const t = calculateOrderTotals({ lines: [{ quantity: 3, unitPrice: 0.1, unitCost: 0 }], shippingCharged: 0.2, discount: 0 });
    expect(t.total).toBe(0.5);
  });
});

describe("mergeOrderLines", () => {
  it("merges duplicate product/variant lines so only one job is created", () => {
    const merged = mergeOrderLines([
      { productId: "a", variantId: null, quantity: 2 },
      { productId: "a", variantId: null, quantity: 1 },
      { productId: "a", variantId: "red", quantity: 1 },
      { productId: "b", quantity: 4 },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged.find((l) => l.productId === "a" && !l.variantId)?.quantity).toBe(3);
  });
});
