import { roundMoney, toNumber } from "./money";

/**
 * Product cost model (per unit):
 *   filament    = grams × (cost per kg ÷ 1000)
 *   electricity = print hours × electricity cost per hour
 *   packaging   = packaging cost
 *   other       = optional additional cost
 */
export interface CostInputs {
  filamentGrams: number;
  printMinutes: number;
  filamentCostPerKg: number;
  electricityCostPerHour: number;
  packagingCost: number;
  otherCost?: number;
}

export interface CostBreakdown {
  filament: number;
  electricity: number;
  packaging: number;
  other: number;
  total: number;
}

export function calculateUnitCost(inputs: CostInputs): CostBreakdown {
  const grams = Math.max(0, toNumber(inputs.filamentGrams));
  const hours = Math.max(0, toNumber(inputs.printMinutes)) / 60;
  const filament = roundMoney(grams * (Math.max(0, toNumber(inputs.filamentCostPerKg)) / 1000));
  const electricity = roundMoney(hours * Math.max(0, toNumber(inputs.electricityCostPerHour)));
  const packaging = roundMoney(Math.max(0, toNumber(inputs.packagingCost)));
  const other = roundMoney(Math.max(0, toNumber(inputs.otherCost)));
  return { filament, electricity, packaging, other, total: roundMoney(filament + electricity + packaging + other) };
}

export interface MarginResult {
  profit: number;
  /** Margin as a fraction of selling price (0.8 = 80%). Null when price is zero. */
  margin: number | null;
}

export function calculateMargin(sellingPrice: number, unitCost: number): MarginResult {
  const price = toNumber(sellingPrice);
  const profit = roundMoney(price - toNumber(unitCost));
  return { profit, margin: price > 0 ? profit / price : null };
}

/** The settings a product's cost depends on. */
export interface CostingSettings {
  default_filament_cost_per_kg: number;
  electricity_cost_per_hour: number;
  default_packaging_cost: number;
}

/** The product (or product + variant overrides) fields a cost depends on. */
export interface CostingProduct {
  filament_grams: number;
  print_minutes: number;
  filament_cost_per_kg: number | null;
  packaging_cost: number | null;
  other_cost: number;
}

export function costInputsFor(product: CostingProduct, settings: CostingSettings): CostInputs {
  return {
    filamentGrams: product.filament_grams,
    printMinutes: product.print_minutes,
    filamentCostPerKg: product.filament_cost_per_kg ?? settings.default_filament_cost_per_kg,
    electricityCostPerHour: settings.electricity_cost_per_hour,
    packagingCost: product.packaging_cost ?? settings.default_packaging_cost,
    otherCost: product.other_cost,
  };
}

export function productUnitCost(product: CostingProduct, settings: CostingSettings): CostBreakdown {
  return calculateUnitCost(costInputsFor(product, settings));
}
