import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, LayersIcon } from "lucide-react";
import { JobActions } from "@/components/production/job-actions";
import { JobProgress } from "@/components/production/job-progress";
import { AssignPrinterSelect, MoveButtons, PrioritySelect } from "@/components/production/queue-controls";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Stat } from "@/components/shared/stat";
import { DemoBadge, StatusBadge } from "@/components/shared/status-badge";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatGrams, formatShortDateTime, todayRange } from "@/lib/domain/dates";
import { PRIORITY_META } from "@/lib/domain/labels";
import { requirePageContext } from "@/lib/services/context";
import { listUsableFilaments } from "@/lib/services/filaments";
import { getProductionBoard, jobLabel, type QueueJob } from "@/lib/services/production";
import { listPrinterOptions } from "@/lib/services/products";

export const metadata: Metadata = { title: "Production" };

function OrderRef({ job }: { job: QueueJob }) {
  if (!job.order) return <span className="text-muted-foreground">—</span>;
  return (
    <Link href={`/orders/${job.order.id}`} className="hover:underline">
      {job.order.order_number}
      <span className="text-muted-foreground"> · {job.order.customer_name}</span>
    </Link>
  );
}

export default async function ProductionPage() {
  const ctx = await requirePageContext();
  const [board, printers, spools] = await Promise.all([
    getProductionBoard(ctx, { printedLimit: 20 }),
    listPrinterOptions(ctx),
    listUsableFilaments(ctx),
  ]);
  const tz = ctx.settings.timezone;
  const now = new Date();
  const today = todayRange(tz);
  const printedToday = board.printed.filter((j) => j.completed_at && new Date(j.completed_at) >= today.from).length;
  const queuedMinutes = board.queued.reduce((s, j) => s + j.estimated_minutes, 0);
  const queuedGrams = board.queued.reduce((s, j) => s + Number(j.estimated_grams), 0);

  return (
    <>
      <PageHeader
        title="Production"
        description="What to print next, what's on the printers, and what needs attention."
      />
      <PageBody>
        <div className="grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:grid-cols-4 sm:divide-y-0">
          <Stat label="Next to print" value={board.queued.length} sub={`${formatDuration(queuedMinutes)} · ${formatGrams(queuedGrams)}`} />
          <Stat label="Printing" value={board.active.length} sub={`${printers.length} printers`} />
          <Stat label="Failed" value={board.failed.length} emphasis={board.failed.length ? "danger" : null} sub="Need re-queue" />
          <Stat label="Printed today" value={printedToday} />
        </div>
        <p className="text-xs text-muted-foreground">
          Production actions are recorded manually in Phase 1 — they don&apos;t control your printers. Live printer integration is coming in Phase 3.
        </p>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Currently printing</CardTitle>
              <CardDescription>Jobs you&apos;ve started on a printer</CardDescription>
            </div>
          </CardHeader>
          {board.active.length === 0 ? (
            <EmptyState title="Nothing printing" description="Start the next job from the queue below." className="py-6" />
          ) : (
            <ul className="grid gap-px bg-border sm:grid-cols-2">
              {board.active.map((j) => (
                <li key={j.id} className="space-y-2 bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link href={`/production/${j.id}`} className="font-medium hover:underline">
                          {j.product_name} × {j.quantity}
                        </Link>
                        {j.status === "paused" && <StatusBadge meta={{ label: "Paused", tone: "slate" }} />}
                        {j.is_demo && <DemoBadge />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {j.printer?.name ?? "No printer"} · <OrderRef job={j} />
                      </div>
                    </div>
                    <JobActions job={j} printers={printers} spools={spools} />
                  </div>
                  <JobProgress job={j} now={now} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {board.failed.length > 0 && (
          <Card className="border-red-200">
            <CardHeader className="bg-red-50/60">
              <CardTitle className="flex items-center gap-2 text-red-800">
                <AlertTriangleIcon className="size-4" /> Failed — needs attention
              </CardTitle>
            </CardHeader>
            <ul className="divide-y">
              {board.failed.map((j) => (
                <li key={j.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <Link href={`/production/${j.id}`} className="font-medium hover:underline">
                      {j.product_name} × {j.quantity}
                    </Link>
                    {j.is_demo && <DemoBadge className="ml-1.5" />}
                    <div className="text-xs text-muted-foreground">
                      <OrderRef job={j} /> · failed {formatShortDateTime(j.failed_at, tz)} · attempt {j.attempts}
                    </div>
                    {j.failure_reason && <div className="text-xs text-red-700">{j.failure_reason}</div>}
                  </div>
                  <JobActions job={j} printers={printers} spools={spools} />
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Next to print</CardTitle>
              <CardDescription>Ordered by priority, then queue position. Top of the list prints first.</CardDescription>
            </div>
          </CardHeader>
          {board.queued.length === 0 ? (
            <EmptyState icon={LayersIcon} title="The queue is empty" description="Production jobs are created automatically when you add orders." />
          ) : (
            <>
              <ol className="divide-y md:hidden">
                {board.queued.map((j, i) => (
                  <li key={j.id} className="space-y-2 px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="tabular text-xs text-muted-foreground">{i + 1}.</span>
                          <Link href={`/production/${j.id}`} className="font-medium">
                            {j.product_name} × {j.quantity}
                          </Link>
                          {j.priority !== "normal" && <StatusBadge meta={PRIORITY_META[j.priority]} />}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <OrderRef job={j} />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDuration(j.estimated_minutes)} · {formatGrams(j.estimated_grams)} {j.material} {j.colour}
                        </div>
                      </div>
                      <JobActions job={j} printers={printers} spools={spools} compact />
                    </div>
                    <div className="flex items-center gap-2">
                      <AssignPrinterSelect jobId={j.id} printerId={j.printer_id} printers={printers} className="flex-1" />
                      <MoveButtons jobId={j.id} isFirst={i === 0} isLast={i === board.queued.length - 1} />
                    </div>
                  </li>
                ))}
              </ol>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="hidden lg:table-cell">Order</TableHead>
                      <TableHead>Printer</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                      <TableHead className="hidden 2xl:table-cell">Filament</TableHead>
                      <TableHead className="hidden 2xl:table-cell">Created</TableHead>
                      <TableHead className="w-24">Move</TableHead>
                      <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {board.queued.map((j, i) => (
                      <TableRow key={j.id}>
                        <TableCell className="tabular text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <Link href={`/production/${j.id}`} className="font-medium hover:underline">
                            {j.product_name} × {j.quantity}
                          </Link>
                          {j.is_demo && <DemoBadge className="ml-1.5" />}
                          <div className="text-[11px] text-muted-foreground">
                            <span className="font-mono">{jobLabel(j)}</span> · {formatGrams(j.estimated_grams)} {j.material} {j.colour}
                          </div>
                        </TableCell>
                        <TableCell className="hidden max-w-48 truncate lg:table-cell">
                          <OrderRef job={j} />
                        </TableCell>
                        <TableCell>
                          <AssignPrinterSelect jobId={j.id} printerId={j.printer_id} printers={printers} className="w-44" />
                        </TableCell>
                        <TableCell>
                          <PrioritySelect jobId={j.id} priority={j.priority} className="w-24" />
                        </TableCell>
                        <TableCell className="tabular text-right">{formatDuration(j.estimated_minutes)}</TableCell>
                        <TableCell className="hidden text-muted-foreground 2xl:table-cell">
                          {formatGrams(j.estimated_grams)} · {[j.material, j.colour].filter(Boolean).join(" ")}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground 2xl:table-cell">{formatShortDateTime(j.created_at, tz)}</TableCell>
                        <TableCell>
                          <MoveButtons jobId={j.id} isFirst={i === 0} isLast={i === board.queued.length - 1} />
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <JobActions job={j} printers={printers} spools={spools} compact />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recently printed</CardTitle>
          </CardHeader>
          {board.printed.length === 0 ? (
            <EmptyState title="No completed jobs yet" className="py-6" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="hidden sm:table-cell">Order</TableHead>
                  <TableHead className="hidden md:table-cell">Printer</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Time</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Filament</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {board.printed.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell>
                      <Link href={`/production/${j.id}`} className="font-medium hover:underline">
                        {j.product_name} × {j.quantity}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden max-w-48 truncate sm:table-cell">
                      <OrderRef job={j} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{j.printer?.name ?? "—"}</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{formatDuration(j.actual_minutes)}</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{formatGrams(j.actual_grams)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatShortDateTime(j.completed_at, tz)}</TableCell>
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
