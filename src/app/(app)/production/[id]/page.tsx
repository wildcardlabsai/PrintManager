import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JobActions } from "@/components/production/job-actions";
import { JobEditForm } from "@/components/production/job-edit-form";
import { JobPrinterActions } from "@/components/production/job-printer-actions";
import { JobProgress } from "@/components/production/job-progress";
import { TelemetryProgress } from "@/components/printers/telemetry-bits";
import { AutoRefresh } from "@/components/shared/auto-refresh";
import { DetailList } from "@/components/shared/detail-list";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { DemoBadge, StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatDuration, formatGrams } from "@/lib/domain/dates";
import { JOB_STATUS_META, ORDER_STATUS_META, PRIORITY_META } from "@/lib/domain/labels";
import { formatMoney } from "@/lib/domain/money";
import { JOB_STAGE_META, jobStage, rawStatusLabel } from "@/lib/printers/status";
import { hasPermission, requirePageContext } from "@/lib/services/context";
import { loadPrinterView, toPrinterJob } from "@/lib/services/printers/production-view";
import { AppError } from "@/lib/services/errors";
import { listUsableFilaments } from "@/lib/services/filaments";
import { getJob, jobLabel } from "@/lib/services/production";
import { listPrinterOptions } from "@/lib/services/products";
import type { JobStatus } from "@/types/db";

export const metadata: Metadata = { title: "Production job" };

export default async function JobPage({ params }: PageProps<"/production/[id]">) {
  const { id } = await params;
  const ctx = await requirePageContext();
  const [detail, printers, spools, view] = await Promise.all([
    getJob(ctx, id).catch((e) => {
      if (e instanceof AppError && e.code === "not_found") notFound();
      throw e;
    }),
    listPrinterOptions(ctx),
    listUsableFilaments(ctx),
    loadPrinterView(ctx),
  ]);
  const { job: j, filament, usage, history } = detail;
  const tz = ctx.settings.timezone;
  const connected = view.isConnected(j.printer_id);
  const printer = view.printers.find((p) => p.id === j.printer_id);
  const active = ["sending", "sent", "printing", "paused"].includes(j.status);
  const canManage = hasPermission(ctx, "manage_production");
  const canOperate = hasPermission(ctx, "operate_printers");

  return (
    <>
      <PageHeader
        back={{ href: "/production", label: "Production" }}
        title={`${j.product_name} × ${j.quantity}`}
        meta={
          <>
            <span className="font-mono text-xs text-muted-foreground">{jobLabel(j)}</span>
            <StatusBadge meta={connected || j.status !== "queued" ? JOB_STAGE_META[jobStage(j)] : JOB_STATUS_META[j.status]} />
            <StatusBadge meta={PRIORITY_META[j.priority]} />
            {j.is_demo && <DemoBadge />}
          </>
        }
        actions={
          <>
            <JobPrinterActions
              job={toPrinterJob(j, connected)}
              printers={view.sendPrinters}
              files={view.filesFor(j)}
              suggestions={j.status === "queued" ? view.suggestionsFor(j) : undefined}
              spools={spools}
              canOperate={canOperate}
            />
            {canManage && <JobActions job={{ ...j, connected }} printers={printers} spools={spools} />}
          </>
        }
      />
      {active && connected && <AutoRefresh intervalMs={10_000} />}
      <PageBody>
        {j.needs_attention && j.attention_reason && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            <strong>Needs attention:</strong> {j.attention_reason}
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            {active && (
              <Card>
                <CardContent className="space-y-2">
                  <div className="text-sm font-medium">
                    On {j.printer?.name ?? "an unassigned printer"}
                    {connected && printer && <span className="font-normal text-muted-foreground"> · {rawStatusLabel(printer.raw_status)}</span>}
                  </div>
                  {connected ? (
                    <>
                      <TelemetryProgress
                        progress={j.progress}
                        layer={j.current_layer}
                        totalLayers={j.total_layers}
                        elapsedSeconds={j.printer_elapsed_seconds}
                        remainingSeconds={j.remaining_seconds}
                        paused={j.status === "paused"}
                      />
                      <p className="text-xs text-muted-foreground">
                        {j.last_telemetry_at
                          ? `Reported by the printer ${formatDateTime(j.last_telemetry_at, tz)}. Remaining time is estimated from the printer's progress.`
                          : j.status === "sending"
                            ? "Waiting for the Printer Agent to upload the file."
                            : "Waiting for the printer to report this print."}
                      </p>
                    </>
                  ) : (
                    <>
                      <JobProgress job={j} />
                      <p className="text-xs text-muted-foreground">Time since you pressed Start (excluding pauses). This printer isn&apos;t connected, so there is no live progress.</p>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
            {j.status === "failed" && j.failure_reason && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <strong>Failed:</strong> {j.failure_reason}
              </div>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Job details</CardTitle>
              </CardHeader>
              <CardContent>
                <JobEditForm job={j} printers={printers} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Filament usage</CardTitle>
              </CardHeader>
              <CardContent>
                {usage.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No filament deducted yet. Usage is recorded when the job is completed (or when a failed print&apos;s waste is logged).
                  </p>
                ) : (
                  <ul className="divide-y text-[13px]">
                    {usage.map((u) => (
                      <li key={u.id} className="flex justify-between py-1.5">
                        <span>
                          {formatGrams(u.grams)} {u.note && <span className="text-muted-foreground">· {u.note}</span>}
                        </span>
                        <span className="tabular text-muted-foreground">
                          {formatMoney(u.cost, ctx.settings.currency)} · {formatDateTime(u.created_at, tz)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailList
                  items={[
                    [
                      "Order",
                      j.order ? (
                        <Link href={`/orders/${j.order.id}`} className="text-primary hover:underline">
                          {j.order.order_number} · {ORDER_STATUS_META[j.order.status].label}
                        </Link>
                      ) : (
                        "—"
                      ),
                    ],
                    ["Customer", j.order?.customer_name ?? "—"],
                    ["Printer", j.printer?.name ?? "Unassigned"],
                    ["Print file", j.print_file ? <Link href={`/print-files?file=${j.print_file.id}`} className="text-primary hover:underline">{j.print_file.name}</Link> : "—"],
                    ["File on printer", j.printer_file_name ? <span className="font-mono text-xs break-all">{j.printer_file_name}</span> : "—"],
                    ["Printer job ID", j.external_printer_job_id ? <span className="font-mono text-xs">{j.external_printer_job_id}</span> : "—"],
                    ["Multi-colour", j.multi_colour ? `${j.colour_channels} colours${j.ifs_required ? " · IFS" : ""}` : "No"],
                    ["Material", [j.material, j.colour].filter(Boolean).join(" · ") || "—"],
                    ["Estimated time", formatDuration(j.estimated_minutes)],
                    ["Actual time", formatDuration(j.actual_minutes)],
                    ["Estimated filament", formatGrams(j.estimated_grams)],
                    ["Actual filament", j.status === "printed" && !j.filament_recorded ? "Not recorded yet" : formatGrams(j.actual_grams)],
                    [
                      "Variance",
                      j.actual_grams != null && j.filament_recorded
                        ? `${Number(j.actual_grams) - Number(j.estimated_grams) >= 0 ? "+" : ""}${(Number(j.actual_grams) - Number(j.estimated_grams)).toFixed(1)} g`
                        : "—",
                    ],
                    ["Spool", filament ? `${filament.brand} ${filament.material} ${filament.colour}` : "—"],
                    ["Attempts", j.attempts],
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Timestamps</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailList
                  items={[
                    ["Created", formatDateTime(j.created_at, tz)],
                    ["Sent to printer", formatDateTime(j.sent_at, tz)],
                    ["Started", formatDateTime(j.started_at, tz)],
                    ["Completed", formatDateTime(j.completed_at, tz)],
                    ...(j.failed_at ? ([["Failed", formatDateTime(j.failed_at, tz)]] as [string, string][]) : []),
                    ["Updated", formatDateTime(j.updated_at, tz)],
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>History</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2 text-[13px]">
                  {history.map((h) => (
                    <li key={h.id}>
                      <div>
                        {h.from_status ? `${JOB_STATUS_META[h.from_status as JobStatus]?.label ?? h.from_status} → ` : "Created · "}
                        <strong>{JOB_STATUS_META[h.to_status as JobStatus]?.label ?? h.to_status}</strong>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(h.created_at, tz)} · {h.changed_by_name ?? "System"}
                        {h.note && ` · ${h.note}`}
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}
