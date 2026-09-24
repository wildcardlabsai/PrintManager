import type { Metadata } from "next";
import Link from "next/link";
import { CylinderIcon, PlusIcon } from "lucide-react";
import { FilamentFormDialog, SpoolRowActions } from "@/components/filament/filament-dialogs";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Stat } from "@/components/shared/stat";
import { DemoBadge, StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatGrams } from "@/lib/domain/dates";
import { SPOOL_STATUS_META } from "@/lib/domain/labels";
import { formatMoney, formatMoneyPrecise } from "@/lib/domain/money";
import { requirePageContext } from "@/lib/services/context";
import { listFilaments, listRecentUsage } from "@/lib/services/filaments";

export const metadata: Metadata = { title: "Filament" };

export default async function FilamentPage({ searchParams }: PageProps<"/filament">) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const showArchived = sp.archived === "1";
  const [spools, usage] = await Promise.all([listFilaments(ctx, { includeArchived: showArchived }), listRecentUsage(ctx, 15)]);
  const currency = ctx.settings.currency;
  const money = (v: number) => formatMoney(v, currency);
  const live = spools.filter((s) => s.status !== "archived" && s.status !== "empty");
  const remaining = live.reduce((s, f) => s + Number(f.remaining_g), 0);
  const value = live.reduce((s, f) => s + Number(f.remaining_g) * Number(f.cost_per_gram), 0);
  const low = spools.filter((s) => s.status === "low" || (s.status !== "empty" && s.status !== "archived" && s.remaining_g <= ctx.settings.low_filament_threshold_g));

  return (
    <>
      <PageHeader
        title="Filament"
        description="Spool inventory. Stock is only deducted when usage is recorded — never when a job is created."
        actions={
          <FilamentFormDialog
            currency={currency}
            trigger={
              <Button size="sm">
                <PlusIcon /> Add spool
              </Button>
            }
          />
        }
      />
      <PageBody>
        <div className="grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:grid-cols-4 sm:divide-y-0">
          <Stat label="Spools in stock" value={live.length} />
          <Stat label="Filament on hand" value={formatGrams(remaining)} />
          <Stat label="Stock value" value={money(value)} />
          <Stat label="Low / running out" value={low.length} emphasis={low.length ? "warning" : null} sub={`Below ${ctx.settings.low_filament_threshold_g} g`} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Spools</CardTitle>
            <Link href={showArchived ? "/filament" : "/filament?archived=1"} className="text-xs font-medium text-muted-foreground hover:text-foreground">
              {showArchived ? "Hide archived" : "Show archived"}
            </Link>
          </CardHeader>
          {spools.length === 0 ? (
            <EmptyState icon={CylinderIcon} title="No spools yet" description="Add your filament so you can track stock and cost per gram." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Spool</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Cost</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Per gram</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spools.map((s) => {
                  const pct = Math.min(100, Math.round((s.remaining_g / s.weight_purchased_g) * 100));
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden
                            className="size-5 shrink-0 rounded-full border"
                            style={{ background: s.colour_hex ?? "transparent" }}
                          />
                          <div>
                            <div className="font-medium">
                              {s.material} · {s.colour}
                              {s.is_demo && <DemoBadge className="ml-1.5" />}
                            </div>
                            <div className="text-xs text-muted-foreground">{s.brand || "—"}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="w-28 space-y-1 sm:w-40">
                          <div className="tabular text-xs">
                            {formatGrams(s.remaining_g)} <span className="text-muted-foreground">/ {formatGrams(s.weight_purchased_g)}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                            <div
                              className={pct < 15 ? "h-full bg-red-500" : pct < 30 ? "h-full bg-amber-500" : "h-full bg-emerald-500"}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="tabular hidden text-right md:table-cell">{money(s.cost)}</TableCell>
                      <TableCell className="tabular hidden text-right sm:table-cell">
                        {formatMoneyPrecise(Number(s.cost_per_gram), currency)}
                        <div className="text-xs text-muted-foreground">{money(Number(s.cost_per_gram) * 1000)}/kg</div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge meta={SPOOL_STATUS_META[s.status]} />
                      </TableCell>
                      <TableCell>
                        <SpoolRowActions spool={s} currency={currency} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent usage</CardTitle>
          </CardHeader>
          {usage.length === 0 ? (
            <EmptyState title="No usage recorded yet" description="Usage is logged when you complete a production job or record usage on a spool." className="py-6" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Spool</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Cost</TableHead>
                  <TableHead className="hidden md:table-cell">For</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="text-muted-foreground">{formatDateTime(u.created_at, ctx.settings.timezone)}</TableCell>
                    <TableCell>{u.filament ? `${u.filament.material} ${u.filament.colour}` : "—"}</TableCell>
                    <TableCell className="tabular text-right">{formatGrams(u.grams)}</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{money(u.cost)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {u.job ? (
                        <Link href={`/production/${u.job.id}`} className="hover:underline">
                          {u.job.product_name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{u.note ?? "Manual"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </PageBody>
    </>
  );
}
