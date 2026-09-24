import { describe, expect, it } from "vitest";
import { calculateMargin, calculateUnitCost, productUnitCost } from "@/lib/domain/costing";

describe("calculateUnitCost", () => {
  it("matches the specification example (80 g, 3 h, £20/kg, £0.20/h, £0.40 packaging)", () => {
    const cost = calculateUnitCost({
      filamentGrams: 80,
      printMinutes: 180,
      filamentCostPerKg: 20,
      electricityCostPerHour: 0.2,
      packagingCost: 0.4,
    });
    expect(cost).toEqual({ filament: 1.6, electricity: 0.6, packaging: 0.4, other: 0, total: 2.6 });
    expect(calculateMargin(12.99, cost.total).profit).toBe(10.39);
  });

  it("treats negative or invalid inputs as zero", () => {
    const cost = calculateUnitCost({
      filamentGrams: -5,
      printMinutes: Number.NaN,
      filamentCostPerKg: 20,
      electricityCostPerHour: 0.2,
      packagingCost: -1,
    });
    expect(cost.total).toBe(0);
  });

  it("falls back to settings defaults when the product has no overrides", () => {
    const cost = productUnitCost(
      { filament_grams: 100, print_minutes: 60, filament_cost_per_kg: null, packaging_cost: null, other_cost: 0.5 },
      { default_filament_cost_per_kg: 25, electricity_cost_per_hour: 0.3, default_packaging_cost: 0.2 },
    );
    expect(cost.total).toBe(2.5 + 0.3 + 0.2 + 0.5);
  });

  it("returns null margin for free items", () => {
    expect(calculateMargin(0, 1).margin).toBeNull();
  });
});
