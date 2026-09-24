import { calculateMargin, type CostBreakdown } from "@/lib/domain/costing";
import { formatMoney } from "@/lib/domain/money";
import { cn } from "@/lib/utils";

export function CostBreakdownTable({
  breakdown,
  sellingPrice,
  currency,
  detail,
  className,
}: {
  breakdown: CostBreakdown;
  sellingPrice: number;
  currency: string;
  detail?: { filament?: string; electricity?: string; packaging?: string };
  className?: string;
}) {
  const m = calculateMargin(sellingPrice, breakdown.total);
  const money = (v: number) => formatMoney(v, currency);
  const row = (label: string, value: number, sub?: string) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span>
        {label}
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
      <span className="tabular">{money(value)}</span>
    </div>
  );
  return (
    <div className={cn("divide-y text-[13px]", className)}>
      {row("Filament", breakdown.filament, detail?.filament)}
      {row("Electricity", breakdown.electricity, detail?.electricity)}
      {row("Packaging", breakdown.packaging, detail?.packaging)}
      {breakdown.other > 0 && row("Other", breakdown.other)}
      <div className="flex justify-between py-1.5 font-semibold">
        <span>Unit cost</span>
        <span className="tabular">{money(breakdown.total)}</span>
      </div>
      <div className="flex justify-between py-1.5">
        <span className="text-muted-foreground">Selling price</span>
        <span className="tabular">{money(sellingPrice)}</span>
      </div>
      <div className="flex justify-between py-1.5 font-semibold">
        <span>Gross profit</span>
        <span className={cn("tabular", m.profit < 0 ? "text-red-700" : "text-emerald-700")}>
          {money(m.profit)}
          {m.margin != null && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{Math.round(m.margin * 100)}%</span>}
        </span>
      </div>
    </div>
  );
}
