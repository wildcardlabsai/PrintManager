import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, ArrowRightIcon, CylinderIcon, InfoIcon, PauseCircleIcon, PlusIcon } from "lucide-react";
import { JobActions } from "@/components/production/job-actions";
import { JobProgress } from "@/components/production/job-progress";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Stat } from "@/components/shared/stat";
import { DemoBadge, StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatGrams, formatShortDateTime, zonedNow } from "@/lib/domain/dates";
import { ORDER_STATUS_META, PRINTER_STATUS_META, PRIORITY_META, SALES_CHANNEL_SHORT } from "@/lib/domain/labels";
import { formatMoney } from "@/lib/domain/money";
import { requirePageContext } from "@/lib/services/context";
import { getDashboard } from "@/lib/services/dashboard";
import { hasDemoData } from "@/lib/services/demo-data";
import { listUsableFilaments } from "@/lib/services/filaments";
import { format } from "date-fns";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const [d, spools, demo] = await Promise.all([getDashboard(ctx), listUsableFilaments(ctx), hasDemoData(ctx)]);
  const money = (v: number) => formatMoney(v, ctx.settings.currency);
  const tz = ctx.settings.timezone;
  const now = zonedNow(tz);
  const printers = d.printers.map((p) => ({ id: p.id, name: p.name, status: p.status }));
  const firstName = (ctx.fullName ?? "").split(" ")[0];
  const nextJobs = d.board.queued.slice(0, 6);
  const notify = ctx.settings.notifications ?? {};
  const alerts = [
    notify.job_failed !== false && d.production.failed > 0 && {
      icon: AlertTriangleIcon,
      tone: "red",
      text: `${d.production.failed} failed print${d.production.failed === 1 ? "" : "s"} to re-queue`,
      href: "/production",
    },
    notify.low_filament !== false && d.lowSpools.length > 0 && {
      icon: CylinderIcon,
      tone: "amber",
      text: `${d.lowSpools.length} spool${d.lowSpools.length === 1 ? "" : "s"} low or empty: ${d.lowSpools
        .slice(0, 3)
        .map((s) => `${s.material} ${s.colour}`)
        .join(", ")}`,
      href: "/filament",
    },
    d.orders.onHold > 0 && {
      icon: PauseCircleIcon,
      tone: "amber",
      text: `${d.orders.onHold} order${d.orders.onHold === 1 ? "" : "s"} on hold`,
      href: "/orders?view=closed",
    },
  ].filter(Boolean) as { icon: typeof AlertTriangleIcon; tone: "red" | "amber"; text: string; href: string }[];

  return (
    <>
      <PageHeader
        title={`${greeting(now.getHours())}${firstName ? `, ${firstName}` : ""}`}
        description={format(now, "EEEE d MMMM")}
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href="/production">Production queue</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/orders/new">
                <PlusIcon /> New order
              </Link>
            </Button>
          </>
        }
      />
      <PageBody>
        {sp.notice === "demo-failed" && !demo && (
          <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            Your business was created, but the demo data couldn&apos;t be loaded. You can try again from{" "}
            <Link href="/settings#demo" className="font-medium underline">
              Settings
            </Link>
            .
          </p>
        )}
        {demo && (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-card px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2">
              <DemoBadge /> Demo data is loaded. Records marked Demo are samples.
            </span>
            <Link href="/settings#demo" className="text-xs font-medium text-primary hover:underline">
              Remove demo data
            </Link>
          </div>
        )}

        {alerts.length > 0 && (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.text}>
                <Link
                  href={a.href}
                  className={
                    a.tone === "red"
                      ? "flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-900 hover:bg-red-100"
                      : "flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 hover:bg-amber-100"
                  }
                >
                  <a.icon className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1">{a.text}</span>
                  <ArrowRightIcon className="size-4" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}

        <section aria-label="Orders" className="grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:grid-cols-3 sm:[&>*:nth-child(-n+3)]:border-t-0 xl:grid-cols-6 xl:divide-y-0">
          <Stat label="Orders today" value={d.orders.today} href="/orders?view=all" />
          <Stat label="New orders" value={d.orders.new} href="/orders?view=new" emphasis={notify.new_order !== false && d.orders.new ? "warning" : null} />
          <Stat label="Awaiting print" value={d.orders.awaitingPrint} href="/orders?view=production" />
          <Stat label="Printing" value={d.orders.printing} href="/orders?view=production" />
          <Stat label="Ready to pack" value={d.orders.toPack} href="/orders?view=pack" />
          <Stat label="Ready to ship" value={d.orders.toShip} href="/shipping" />
        </section>

        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Production</CardTitle>
                  <CardDescription>
                    {d.production.queued} waiting · {d.production.printing} printing · {d.production.completedToday} done today ·{" "}
                    {formatDuration(d.production.remainingMinutes)} of printing left
                  </CardDescription>
                </div>
                <Link href="/production" className="text-xs font-medium text-primary hover:underline">
                  Full queue
                </Link>
              </CardHeader>
              {d.board.active.length > 0 && (
                <ul className="divide-y border-b">
                  {d.board.active.map((j) => (
                    <li key={j.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_220px_auto] sm:items-center">
                      <div className="min-w-0">
                        <Link href={`/production/${j.id}`} className="font-medium hover:underline">
                          {j.product_name} × {j.quantity}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {j.status === "paused" ? "Paused on " : "Printing on "}
                          {j.printer?.name ?? "—"}
                          {j.order && (
                            <>
                              {" · "}
                              <Link href={`/orders/${j.order.id}`} className="hover:underline">
                                {j.order.order_number}
                              </Link>
                            </>
                          )}
                        </div>
                      </div>
                      <JobProgress job={j} />
                      <JobActions job={j} printers={printers} spools={spools} />
                    </li>
                  ))}
                </ul>
              )}
              <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">Next to print</div>
              {nextJobs.length === 0 ? (
                <EmptyState title="Nothing waiting to print" description="New orders create production jobs automatically." className="py-6" />
              ) : (
                <ol className="divide-y">
                  {nextJobs.map((j, i) => (
                    <li key={j.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="tabular w-4 text-xs text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/production/${j.id}`} className="font-medium hover:underline">
                            {j.product_name} × {j.quantity}
                          </Link>
                          {j.priority !== "normal" && <StatusBadge meta={PRIORITY_META[j.priority]} />}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {formatDuration(j.estimated_minutes)} · {formatGrams(j.estimated_grams)} {j.material} {j.colour}
                          {" · "}
                          {j.printer?.name ?? "No printer"}
                          {j.order && ` · ${j.order.order_number}`}
                        </div>
                      </div>
                      <JobActions job={j} printers={printers} spools={spools} compact />
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent orders</CardTitle>
                <Link href="/orders?view=all" className="text-xs font-medium text-primary hover:underline">
                  All orders
                </Link>
              </CardHeader>
              {d.recentOrders.length === 0 ? (
                <EmptyState
                  title="No orders yet"
                  action={
                    <Button asChild size="sm">
                      <Link href="/orders/new">
                        <PlusIcon /> Create your first order
                      </Link>
                    </Button>
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead className="hidden sm:table-cell">Channel</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="hidden lg:table-cell">Product</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.recentOrders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>
                          <Link href={`/orders/${o.id}`} className="font-medium text-primary hover:underline">
                            {o.order_number}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{SALES_CHANNEL_SHORT[o.sales_channel]}</TableCell>
                        <TableCell className="max-w-36 truncate">{o.customer_name}</TableCell>
                        <TableCell className="hidden max-w-44 truncate text-muted-foreground lg:table-cell">{o.item_summary}</TableCell>
                        <TableCell className="tabular text-right">{money(o.total)}</TableCell>
                        <TableCell>
                          <StatusBadge meta={ORDER_STATUS_META[o.status]} />
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">{formatShortDateTime(o.order_date, tz)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Printers</CardTitle>
                <Link href="/printers" className="text-xs font-medium text-primary hover:underline">
                  Manage
                </Link>
              </CardHeader>
              <ul className="divide-y">
                {d.printers.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{p.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {p.current_job ? (
                          <Link href={`/production/${p.current_job.id}`} className="hover:underline">
                            {p.current_job.product_name} × {p.current_job.quantity}
                          </Link>
                        ) : (
                          "No job in progress"
                        )}
                      </div>
                    </div>
                    <StatusBadge meta={PRINTER_STATUS_META[p.status]} />
                  </li>
                ))}
              </ul>
              <p className="flex items-center gap-1.5 border-t px-4 py-2 text-[11px] text-muted-foreground">
                <InfoIcon className="size-3.5 shrink-0" aria-hidden />
                Manual status — live printer integration coming in Phase 3.
              </p>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Takings</CardTitle>
                <Link href="/reports" className="text-xs font-medium text-primary hover:underline">
                  Reports
                </Link>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead />
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Est. profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ["Today", d.finance.revenueToday, d.finance.profitToday],
                    ["This week", d.finance.revenueWeek, d.finance.profitWeek],
                    ["This month", d.finance.revenueMonth, d.finance.profitMonth],
                  ].map(([label, rev, profit]) => (
                    <TableRow key={label as string}>
                      <TableCell className="font-medium">{label}</TableCell>
                      <TableCell className="tabular text-right">{money(rev as number)}</TableCell>
                      <TableCell className="tabular text-right">{money(profit as number)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">Excludes cancelled orders. Profit is after product cost, postage and fees.</p>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}
