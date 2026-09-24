import { roundMoney, toNumber } from "./money";

export interface PricedLine {
  quantity: number;
  unitPrice: number;
  unitCost: number;
}

export interface OrderPricingInput {
  lines: PricedLine[];
  /** Shipping charged to the customer. */
  shippingCharged: number;
  discount: number;
  /** Marketplace / payment fees. */
  fees?: number;
  /** Postage the business pays the carrier. */
  postageCost?: number;
}

export interface OrderTotals {
  subtotal: number;
  shippingCharged: number;
  discount: number;
  total: number;
  productCost: number;
  fees: number;
  postageCost: number;
  estimatedProfit: number;
}

/**
 * Order totals and estimated profit.
 *   total  = subtotal + shipping charged − discount
 *   profit = total − product cost − postage − fees
 */
export function calculateOrderTotals(input: OrderPricingInput): OrderTotals {
  let subtotal = 0;
  let productCost = 0;
  for (const line of input.lines) {
    const qty = Math.max(0, Math.trunc(toNumber(line.quantity)));
    subtotal += qty * toNumber(line.unitPrice);
    productCost += qty * toNumber(line.unitCost);
  }
  subtotal = roundMoney(subtotal);
  productCost = roundMoney(productCost);
  const shippingCharged = roundMoney(Math.max(0, toNumber(input.shippingCharged)));
  const maxDiscount = subtotal + shippingCharged;
  const discount = roundMoney(Math.min(Math.max(0, toNumber(input.discount)), maxDiscount));
  const fees = roundMoney(Math.max(0, toNumber(input.fees)));
  const postageCost = roundMoney(Math.max(0, toNumber(input.postageCost)));
  const total = roundMoney(subtotal + shippingCharged - discount);
  const estimatedProfit = roundMoney(total - productCost - postageCost - fees);
  return { subtotal, shippingCharged, discount, total, productCost, fees, postageCost, estimatedProfit };
}

/**
 * Merge lines for the same product/variant so one order never produces two
 * production jobs for the same item.
 */
export function mergeOrderLines<T extends { productId: string; variantId?: string | null; quantity: number }>(
  lines: T[],
): T[] {
  const merged = new Map<string, T>();
  for (const line of lines) {
    const key = `${line.productId}:${line.variantId ?? ""}`;
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, quantity: existing.quantity + line.quantity });
    } else {
      merged.set(key, { ...line });
    }
  }
  return [...merged.values()];
}
