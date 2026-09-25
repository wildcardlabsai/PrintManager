import type { Metadata } from "next";
import Link from "next/link";
import { PrintersTabs } from "@/components/printers/printers-tabs";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatGrams } from "@/lib/domain/dates";
import { requirePageContext } from "@/lib/services/context";
import { getPrinterStats } from "@/lib/services/printers/stats";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Printer statistics" };

const PRESETS = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
];

function parseDate(s: string | string[] | undefined) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const NA = <span className="text-muted-foreground">Not available</span>;
const hours = (h: number | null) => (h == null ? NA : formatDuration(h * 60));

export default async function PrinterStatsPage({ searchParams }: PageProps<"/printers/stats">) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const now = new Date();
  const from = parseDate(sp.from);
  const to = parseDate(sp.to);
  const days = typeof sp.days === "string" && ["7", "30", "90"].includes(sp.days) ? Number(sp.days) : 30;
  const range =
    from && to && from <= to
      ? { from, to: new Date(to.getTime() + 86400000 - 1) }
      : { from: new Date(now.getTime() - days * 86400000), to: now };
  const rows = await getPrinterStats(ctx, range);
  const custom = Boolean(from && to);

  return (
    <>
      <PageHeader title="Printers" description="Utilisation and reliability from PrintFlow's own records." />
      <PrintersTabs active="stats" />
      <PageBody>
        <div className="flex flex-wrap items-end gap-2">
          {PRESETS.map((p) => (
            <Link
              key={p.key}
              href={`/printers/stats?days=${p.key}`}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[13px]",
                !custom && String(days) === p.key ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted",
              )}
            >
              {p.label}
            </Link>
          ))}
          <form className="flex flex-wrap items-end gap-2" action="/printers/stats">
            <label className="text-xs text-muted-foreground">
              From
              <input type="date" name="from" defaultValue={typeof sp.from === "string" ? sp.from : ""} className="ml-1 rounded-md border bg-card px-2 py-1 text-[13px]" />
            </label>
            <label className="text-xs text-muted-foreground">
              To
              <input type="date" name="to" defaultValue={typeof sp.to === "string" ? sp.to : ""} className="ml-1 rounded-md border bg-card px-2 py-1 text-[13px]" />
            </label>
            <button type="submit" className="rounded-md border px-2.5 py-1 text-[13px] hover:bg-muted">
              Apply
            </button>
          </form>
        </div>
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Printer</TableHead>
                <TableHead className="text-right">Utilisation</TableHead>
                <TableHead className="text-right">Print time</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Success rate</TableHead>
                <TableHead className="text-right">Filament</TableHead>
                <TableHead className="text-right">Avg print</TableHead>
                <TableHead className="text-right">Idle</TableHead>
                <TableHead className="text-right">Offline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.printer.id}>
                  <TableCell>
                    <Link href={`/printers/${r.printer.id}`} className="font-medium hover:underline">
                      {r.printer.name}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular text-right">{Math.round(r.utilisation * 100)}%</TableCell>
                  <TableCell className="tabular text-right">{hours(r.printHours)}</TableCell>
                  <TableCell className="tabular text-right">{r.completed}</TableCell>
                  <TableCell className="tabular text-right">{r.failed}</TableCell>
                  <TableCell className="tabular text-right">{r.successRate == null ? NA : `${Math.round(r.successRate * 100)}%`}</TableCell>
                  <TableCell className="tabular text-right">{r.filamentGrams ? formatGrams(r.filamentGrams) : NA}</TableCell>
                  <TableCell className="tabular text-right">{r.averageMinutes == null ? NA : formatDuration(r.averageMinutes)}</TableCell>
                  <TableCell className="tabular text-right">{hours(r.idleHours)}</TableCell>
                  <TableCell className="tabular text-right">{hours(r.offlineHours)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <p className="text-xs text-muted-foreground">
          Print time and success rate come from completed and failed jobs in the period. Filament is what was recorded against those jobs (the printers
          don&apos;t report actual usage). Idle and offline time are only available for connected printers whose connection history covers the whole
          period.
        </p>
      </PageBody>
    </>
  );
}
