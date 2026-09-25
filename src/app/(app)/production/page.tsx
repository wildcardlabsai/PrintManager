import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, BellRingIcon, CheckCircle2Icon, LayersIcon, SparklesIcon } from "lucide-react";
import { JobActions } from "@/components/production/job-actions";
import { JobPrinterActions } from "@/components/production/job-printer-actions";
import { JobProgress } from "@/components/production/job-progress";
import { AssignPrinterSelect, MoveButtons, PrioritySelect } from "@/components/production/queue-controls";
import { TelemetryProgress } from "@/components/printers/telemetry-bits";
import { AutoRefresh } from "@/components/shared/auto-refresh";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Stat } from "@/components/shared/stat";
import { DemoBadge, StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatGrams, formatShortDateTime, todayRange } from "@/lib/domain/dates";
import { PRIORITY_META } from "@/lib/domain/labels";
import { JOB_STAGE_META, jobStage, rawStatusLabel } from "@/lib/printers/status";
import { hasPermission, requirePageContext } from "@/lib/services/context";
import { listUsableFilaments } from "@/lib/services/filaments";
import { loadPrinterView, toPrinterJob } from "@/lib/services/printers/production-view";
import { getProductionBoard, jobLabel, type QueueJob } from "@/lib/services/production";

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

function FileRef({ job }: { job: QueueJob }) {
  if (!job.print_file) return <span className="text-muted-foreground">No print file chosen</span>;
  return (
    <span>
      {job.print_file.name}
      {job.print_file.verified_at && <CheckCircle2Icon className="ml-1 inline size-3 text-emerald-600" aria-label="Proven file" />}
    </span>
  );
}

export default async function ProductionPage() {
  const ctx = await requirePageContext();
  const [board, view, spools] = await Promise.all([getProductionBoard(ctx, { printedLimit: 20 }), loadPrinterView(ctx), listUsableFilaments(ctx)]);
  const canOperate = hasPermission(ctx, "operate_printers");
  const canManage = hasPermission(ctx, "manage_production");
  const printerOptions = view.printers.map((p) => ({ id: p.id, name: p.name, status: p.status, connection_mode: p.connection_mode }));
  const tz = ctx.settings.timezone;
  const now = view.now;
  const today = todayRange(tz);
  const printedToday = board.printed.filter((j) => j.completed_at && new Date(j.completed_at) >= today.from).length;
  const queuedMinutes = board.queued.reduce((s, j) => s + j.estimated_minutes, 0);
  const queuedGrams = board.queued.reduce((s, j) => s + Number(j.estimated_grams), 0);
  const connectedCount = view.printers.filter((p) => p.connection_mode === "agent_lan").length;
  const idleConnected = view.printers.filter((p) => view.isLive(p) && p.raw_status === "ready" && p.bed_clear && !p.current_job);

  const actionsFor = (j: QueueJob, size: "sm" | "default" = "sm") => (
    <JobPrinterActions
      job={toPrinterJob(j, view.isConnected(j.printer_id))}
      printers={view.sendPrinters}
      files={view.filesFor(j)}
      suggestions={j.status === "queued" ? view.suggestionsFor(j) : undefined}
      spools={spools}
      canOperate={canOperate}
      size={size}
    />
  );
  const recordActions = (j: QueueJob, compact = false) =>
    canManage ? (
      <JobActions job={{ ...j, connected: view.isConnected(j.printer_id) }} printers={printerOptions} spools={spools} compact={compact} />
    ) : null;

  return (
    <>
      <AutoRefresh intervalMs={15_000} />
      <PageHeader title="Production" description="What to print next, what's on the printers, and what needs attention." />
      <PageBody>
        <div className="grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:grid-cols-5 sm:divide-y-0">
          <Stat label="Next to print" value={board.queued.length} sub={`${formatDuration(queuedMinutes)} · ${formatGrams(queuedGrams)}`} />
          <Stat label="On printers" value={board.active.length} sub={`${view.printers.length} printers · ${connectedCount} connected`} />
          <Stat label="Needs attention" value={board.attention.length} emphasis={board.attention.length ? "danger" : null} />
          <Stat label="Failed" value={board.failed.length} emphasis={board.failed.length ? "warning" : null} sub="Retry or reassign" />
          <Stat label="Printed today" value={printedToday} />
        </div>
        <p className="text-xs text-muted-foreground">
          {connectedCount
            ? `Connected printers are started with "Send to printer" and report their own progress. ${
                ctx.settings.auto_print_enabled ? "Automatic print queue is ON." : "Automatic print queue is off — every print is started by a person."
              }`
            : "No printer is connected yet: production actions are records of what you did at the printer. Connect a Flashforge printer from Printers → Agents."}
        </p>

        {board.attention.length > 0 && (
          <Card className="border-red-200">
            <CardHeader className="bg-red-50/60">
              <CardTitle className="flex items-center gap-2 text-red-800">
                <BellRingIcon className="size-4" /> Needs attention
              </CardTitle>
            </CardHeader>
            <ul className="divide-y">
              {board.attention.map((j) => (
                <li key={j.id} className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/production/${j.id}`} className="font-medium hover:underline">
                        {j.product_name} × {j.quantity}
                      </Link>
                      <span className="font-mono text-xs text-muted-foreground">{jobLabel(j)}</span>
                      <StatusBadge meta={JOB_STAGE_META[jobStage(j)]} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {j.printer?.name ?? "No printer"} · <OrderRef job={j} />
                    </div>
                    <div className="text-xs text-red-700">{j.attention_reason}</div>
                  </div>
                  {actionsFor(j)}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div>
              <CardTitle>On the printers</CardTitle>
              <CardDescription>Sending, queued on a printer, printing or paused</CardDescription>
            </div>
          </CardHeader>
          {board.active.length === 0 ? (
            <EmptyState title="Nothing printing" description="Send the next job from the queue below." className="py-6" />
          ) : (
            <ul className="grid gap-px bg-border sm:grid-cols-2">
              {board.active.map((j) => {
                const connected = view.isConnected(j.printer_id);
                const printer = view.printers.find((p) => p.id === j.printer_id);
                return (
                  <li key={j.id} className="space-y-2 bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/production/${j.id}`} className="font-medium hover:underline">
                            {j.product_name} × {j.quantity}
                          </Link>
                          <StatusBadge meta={JOB_STAGE_META[jobStage(j)]} />
                          {j.is_demo && <DemoBadge />}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {j.printer?.name ?? "No printer"}
                          {connected && printer ? ` · ${rawStatusLabel(printer.raw_status)}` : ""} · <OrderRef job={j} />
                        </div>
                      </div>
                      {recordActions(j)}
                    </div>
                    {connected ? (
                      <TelemetryProgress
                        progress={j.progress}
                        layer={j.current_layer}
                        totalLayers={j.total_layers}
                        elapsedSeconds={j.printer_elapsed_seconds}
                        remainingSeconds={j.remaining_seconds}
                        paused={j.status === "paused"}
                      />
                    ) : (
                      <JobProgress job={j} now={now} />
                    )}
                    {actionsFor(j)}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {board.failed.filter((j) => !j.needs_attention).length > 0 && (
          <Card className="border-amber-200">
            <CardHeader className="bg-amber-50/60">
              <CardTitle className="flex items-center gap-2 text-amber-900">
                <AlertTriangleIcon className="size-4" /> Failed
              </CardTitle>
            </CardHeader>
            <ul className="divide-y">
              {board.failed
                .filter((j) => !j.needs_attention)
                .map((j) => (
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
                    {recordActions(j)}
                  </li>
                ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Next to print</CardTitle>
              <CardDescription>
                Ordered by priority, then queue position.
                {idleConnected.length > 0 && ` Ready now: ${idleConnected.map((p) => p.name).join(", ")}.`}
              </CardDescription>
            </div>
          </CardHeader>
          {board.queued.length === 0 ? (
            <EmptyState icon={LayersIcon} title="The queue is empty" description="Production jobs are created automatically when you add orders." />
          ) : (
            <ol className="divide-y">
              {board.queued.map((j, i) => {
                const suggestion = view.suggestionsFor(j).find((s) => s.compatible);
                return (
                  <li key={j.id} className="grid gap-2 px-3 py-3 md:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.3fr)_auto] md:items-center md:px-4">
                    <span className="tabular hidden text-xs text-muted-foreground md:block">{i + 1}</span>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="tabular text-xs text-muted-foreground md:hidden">{i + 1}.</span>
                        <Link href={`/production/${j.id}`} className="font-medium hover:underline">
                          {j.product_name} × {j.quantity}
                        </Link>
                        <StatusBadge meta={JOB_STAGE_META[jobStage(j)]} />
                        {j.priority !== "normal" && <StatusBadge meta={PRIORITY_META[j.priority]} />}
                        {j.is_demo && <DemoBadge />}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        <span className="font-mono">{jobLabel(j)}</span> · <OrderRef job={j} />
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatDuration(j.estimated_minutes)} · {formatGrams(j.estimated_grams)} {[j.material, j.colour].filter(Boolean).join(" ")}
                        {j.multi_colour || j.print_file?.multi_colour ? " · multi-colour" : ""} · <FileRef job={j} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      {canManage ? (
                        <div className="flex items-center gap-1.5">
                          <AssignPrinterSelect jobId={j.id} printerId={j.printer_id} printers={printerOptions} className="min-w-0 flex-1" />
                          <PrioritySelect jobId={j.id} priority={j.priority} className="w-24" />
                          <MoveButtons jobId={j.id} isFirst={i === 0} isLast={i === board.queued.length - 1} />
                        </div>
                      ) : (
                        <span className="text-xs">{j.printer?.name ?? "Unassigned"}</span>
                      )}
                      {suggestion && suggestion.printerId !== j.printer_id && (
                        <p className="text-[11px] text-muted-foreground">
                          <SparklesIcon className="mr-0.5 inline size-3" />
                          Suggested: <span className="font-medium text-foreground">{suggestion.printerName}</span>
                          {suggestion.reasons.length ? ` — ${suggestion.reasons.slice(0, 2).join(", ")}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {actionsFor(j)}
                      {recordActions(j, true)}
                    </div>
                  </li>
                );
              })}
            </ol>
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
                      {!j.filament_recorded && (
                        <div className="mt-1">
                          {canOperate ? actionsFor(j) : <Badge tone="amber">Review pending</Badge>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-48 truncate sm:table-cell">
                      <OrderRef job={j} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{j.printer?.name ?? "—"}</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{formatDuration(j.actual_minutes)}</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">
                      {j.filament_recorded ? formatGrams(j.actual_grams) : <span className="text-muted-foreground">Not recorded</span>}
                    </TableCell>
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
