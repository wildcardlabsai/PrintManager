import type { Metadata } from "next";
import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { DailyColumns, ProductionColumns, RevenueProfitChart } from "@/components/reports/charts";
import { RangePicker } from "@/components/reports/range-picker";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Stat } from "@/components/shared/stat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { REPORT_RANGES, REPORT_RANGE_LABELS, formatDuration, formatGrams, resolveReportRange, type ReportRangeKey } from "@/lib/domain/dates";
import { SALES_CHANNEL_LABELS } from "@/lib/domain/labels";
import { formatMoney } from "@/lib/domain/money";
import { requirePageContext } from "@/lib/services/context";
import { getReport } from "@/lib/services/reports";

export const metadata: Metadata = { title: "Reports" };

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 1000) / 10}%`);

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const tz = ctx.settings.timezone;
  const key = (REPORT_RANGES.includes(sp.range as ReportRangeKey) ? sp.range : "30d") as ReportRangeKey;
  const range = resolveReportRange(key, tz, {
    from: typeof sp.from === "string" ? sp.from : undefined,
    to: typeof sp.to === "string" ? sp.to : undefined,
  });
  const r = await getReport(ctx, range);
  const money = (v: number) => formatMoney(v, ctx.settings.currency);
  const fmtDay = (d: Date) => format(new TZDate(d.getTime(), tz), "yyyy-MM-dd");
  const label = `${format(new TZDate(range.from.getTime(), tz), "d MMM yyyy")} – ${format(new TZDate(range.to.getTime(), tz), "d MMM yyyy")}`;
  const hasOrders = r.summary.orders > 0;

  return (
    <>
      <PageHeader title="Reports" description={`${REPORT_RANGE_LABELS[key]} · ${label}`} />
      <PageBody>
        <RangePicker active={key} from={fmtDay(range.from)} to={fmtDay(range.to)} />

        <section aria-label="Summary" className="grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
          <Stat label="Revenue" value={money(r.summary.revenue)} />
          <Stat label="Estimated profit" value={money(r.summary.profit)} sub={`Margin ${pct(r.summary.margin)}`} />
          <Stat label="Orders" value={r.summary.orders} sub={r.summary.cancelled ? `${r.summary.cancelled} cancelled` : undefined} />
          <Stat label="Avg. order value" value={money(r.summary.averageOrderValue)} />
          <Stat label="Units sold" value={r.summary.unitsSold} />
          <Stat label="Filament used" value={formatGrams(r.filament.grams)} sub={money(r.filament.cost)} />
        </section>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Revenue & estimated profit</CardTitle>
              <CardDescription>Per day, by order date. Cancelled orders excluded.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {hasOrders ? (
              <RevenueProfitChart data={r.daily} currency={ctx.settings.currency} />
            ) : (
              <EmptyState title="No orders in this period" className="py-8" />
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Orders per day</CardTitle>
            </CardHeader>
            <CardContent>
              {hasOrders ? <DailyColumns data={r.daily} dataKey="orders" name="Orders" fmt="count" ariaLabel="Orders per day" /> : <EmptyState title="No orders in this period" className="py-8" />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>By sales channel</CardTitle>
            </CardHeader>
            {r.channels.length === 0 ? (
              <EmptyState title="No sales in this period" className="py-8" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Est. profit</TableHead>
                    <TableHead className="w-28">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.channels.map((c) => {
                    const share = r.summary.revenue > 0 ? c.revenue / r.summary.revenue : 0;
                    return (
                      <TableRow key={c.channel}>
                        <TableCell className="font-medium">{SALES_CHANNEL_LABELS[c.channel]}</TableCell>
                        <TableCell className="tabular text-right">{c.orders}</TableCell>
                        <TableCell className="tabular text-right">{money(c.revenue)}</TableCell>
                        <TableCell className="tabular hidden text-right sm:table-cell">{money(c.profit)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-muted" aria-hidden>
                              <div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${Math.round(share * 100)}%` }} />
                            </div>
                            <span className="tabular w-9 text-right text-xs text-muted-foreground">{Math.round(share * 100)}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Top products</CardTitle>
          </CardHeader>
          {r.products.length === 0 ? (
            <EmptyState title="No products sold in this period" className="py-8" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Product cost</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Gross margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.products.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="tabular text-right">{p.units}</TableCell>
                    <TableCell className="tabular text-right">{money(p.revenue)}</TableCell>
                    <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">{money(p.cost)}</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{money(p.margin)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Production</CardTitle>
                <CardDescription>
                  {r.production.jobsPrinted} jobs printed ({r.production.unitsPrinted} units) · {r.production.jobsFailed} failed · failure rate{" "}
                  {pct(r.production.failureRate)} · {formatDuration(r.production.printMinutes)} print time
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {r.production.jobsPrinted + r.production.jobsFailed > 0 ? (
                <ProductionColumns data={r.production.daily} />
              ) : (
                <EmptyState title="No jobs completed in this period" className="py-8" />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Filament usage</CardTitle>
                <CardDescription>Recorded usage from completed jobs, failed prints and manual entries.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {r.filament.grams > 0 ? (
                <>
                  <DailyColumns data={r.filament.daily} dataKey="grams" name="Filament" fmt="grams" ariaLabel="Filament grams used per day" />
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Material</TableHead>
                        <TableHead className="text-right">Used</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.filament.byMaterial.map((m) => (
                        <TableRow key={m.material}>
                          <TableCell className="font-medium">{m.material}</TableCell>
                          <TableCell className="tabular text-right">{formatGrams(m.grams)}</TableCell>
                          <TableCell className="tabular text-right">{money(m.cost)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              ) : (
                <EmptyState title="No filament usage recorded in this period" className="py-8" />
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
