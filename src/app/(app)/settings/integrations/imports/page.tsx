import type { Metadata } from "next";
import { PackageSearchIcon } from "lucide-react";
import { IMPORT_STATUS_META } from "@/components/integrations/labels";
import { MapLineForm, RetryImportButton } from "@/components/integrations/map-line-form";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBody } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatDateTime } from "@/lib/domain/dates";
import { SALES_CHANNEL_LABELS } from "@/lib/domain/labels";
import { formatMoney } from "@/lib/domain/money";
import { requirePageContext } from "@/lib/services/context";
import { listAttentionImports } from "@/lib/services/integrations/mappings";
import { listProductOptions } from "@/lib/services/products";

export const metadata: Metadata = { title: "Imports needing mapping" };

export default async function ImportsPage() {
  const ctx = await requirePageContext();
  const [rows, products] = await Promise.all([listAttentionImports(ctx), listProductOptions(ctx)]);
  const options = products.flatMap((p) => [
    { value: `${p.id}|`, label: p.name, description: p.sku, keywords: p.sku },
    ...p.product_variants.map((v) => ({ value: `${p.id}|${v.id}`, label: `${p.name} — ${v.name}`, description: v.sku, keywords: v.sku })),
  ]);
  const tz = ctx.settings.timezone;

  return (
    <PageBody>
      <p className="text-sm text-muted-foreground">
        These marketplace orders were not imported because some items don&apos;t match a PrintFlow product. No order or production job has been
        created for them. Map each item once — future orders for the same listing are matched automatically — then retry the import.
      </p>
      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState icon={PackageSearchIcon} title="Nothing needs mapping" description="Every imported marketplace item matched a PrintFlow product." />
        </div>
      ) : (
        rows.map((row) => (
          <Card key={row.id}>
            <CardHeader>
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {SALES_CHANNEL_LABELS[row.sales_channel]} order <span className="font-mono">{row.external_order_id}</span>
                  <StatusBadge meta={IMPORT_STATUS_META[row.import_status]} />
                </CardTitle>
                <CardDescription>
                  {row.buyer_name ?? "Buyer"} · ordered {formatDateTime(row.ordered_at, tz)} ·{" "}
                  {formatMoney(row.normalized.total, row.currency ?? ctx.settings.currency)} · {row.import_note}
                </CardDescription>
              </div>
              <RetryImportButton rowId={row.id} />
            </CardHeader>
            <ul className="divide-y">
              {row.unmatched_lines.map((l) => (
                <li key={l.externalLineId} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium">{l.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.variation && `${l.variation} · `}
                      SKU {l.sku ? <span className="font-mono">{l.sku}</span> : <em>none</em>}
                      {l.externalListingId && <> · listing {l.externalListingId}</>}
                      {" · "}
                      {l.reason === "missing_sku" ? "No SKU on the listing" : "SKU not found in PrintFlow"}
                    </div>
                  </div>
                  <MapLineForm rowId={row.id} lineId={l.externalLineId} options={options} label={l.title} />
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </PageBody>
  );
}
