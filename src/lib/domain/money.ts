/** Round to 2 decimal places using integer pennies to avoid float drift. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: number | null | undefined, currency = "GBP"): string {
  const key = currency;
  let fmt = formatters.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat("en-GB", { style: "currency", currency });
    } catch {
      fmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
    }
    formatters.set(key, fmt);
  }
  return fmt.format(toNumber(value));
}

/** Money with more precision, for per-gram costs. */
export function formatMoneyPrecise(value: number | null | undefined, currency = "GBP", digits = 4): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(toNumber(value));
  } catch {
    return toNumber(value).toFixed(digits);
  }
}
