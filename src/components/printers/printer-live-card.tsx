import Link from "next/link";
import { ChevronRightIcon, PencilIcon, PrinterIcon, TriangleAlertIcon } from "lucide-react";
import { JobProgress } from "@/components/production/job-progress";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatShortDateTime } from "@/lib/domain/dates";
import { PRINTER_STATUS_META } from "@/lib/domain/labels";
import { connectionView, estimateRemainingSeconds, rawStatusLabel } from "@/lib/printers/status";
import { jobLabel } from "@/lib/production-labels";
import type { PrinterWithJob } from "@/lib/services/printers";
import { LoadedFilament, PrinterBadges, TelemetryProgress, ago, temp } from "./telemetry-bits";
import { PrinterControls } from "./printer-controls";
import { PrinterFormDialog } from "./printer-form-dialog";
import { PrinterStatusSelect } from "./printer-status-select";

/**
 * One printer at a glance. Connected printers show only what the printer
 * reported (anything missing reads "Not available"); manual printers show the
 * status a person set.
 */
export function PrinterLiveCard({
  printer: p,
  now,
  offlineAfter,
  timeZone,
  canOperate,
  canEdit,
}: {
  printer: PrinterWithJob;
  now: Date;
  offlineAfter: number;
  timeZone: string;
  canOperate: boolean;
  canEdit: boolean;
}) {
  const job = p.current_job;
  const manual = p.connection_mode === "manual";
  const conn = connectionView(p, now, offlineAfter);
  const t = conn.live ? p.telemetry : null;
  const untracked = t && t.printFileName && !job && ["printing", "heating", "pause", "pausing"].includes(t.status ?? "");

  return (
    <article className="flex flex-col rounded-lg border bg-card">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <Link href={`/printers/${p.id}`} className="group flex min-w-0 items-center gap-2.5">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <PrinterIcon className="size-4 text-muted-foreground" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold group-hover:underline">{p.name}</h3>
            <p className="truncate text-xs text-muted-foreground">
              {[p.manufacturer, p.model].filter(Boolean).join(" ")}
              {p.location && ` · ${p.location}`}
            </p>
          </div>
        </Link>
        {manual ? <StatusBadge meta={PRINTER_STATUS_META[p.status]} /> : <PrinterBadges printer={p} now={now} offlineAfter={offlineAfter} />}
      </header>

      <div className="flex-1 space-y-3 px-4 py-3 text-[13px]">
        {!manual && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium">{conn.live ? rawStatusLabel(p.raw_status) : conn.detail}</span>
            {t?.errorCode && (
              <span className="inline-flex items-center gap-1 text-red-700">
                <TriangleAlertIcon className="size-3.5" /> Error {t.errorCode}
              </span>
            )}
          </div>
        )}

        {job ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {job.status === "sending"
                  ? "Sending to printer"
                  : job.status === "sent"
                    ? "Queued on printer"
                    : job.status === "paused"
                      ? "Paused job"
                      : "Current job"}
              </span>
              <span className="font-mono">{jobLabel(job)}</span>
            </div>
            <Link href={`/production/${job.id}`} className="font-medium hover:underline">
              {job.product_name} × {job.quantity}
            </Link>
            {manual ? (
              <JobProgress job={job} now={now} />
            ) : (
              <TelemetryProgress
                progress={job.progress}
                layer={job.current_layer}
                totalLayers={job.total_layers}
                elapsedSeconds={job.printer_elapsed_seconds}
                remainingSeconds={job.remaining_seconds}
                paused={job.status === "paused"}
              />
            )}
            {job.needs_attention && job.attention_reason && <p className="text-xs text-red-700">{job.attention_reason}</p>}
          </div>
        ) : untracked ? (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Printing a file not started from PrintFlow</p>
            <p className="truncate font-mono text-xs">{t!.printFileName}</p>
            <TelemetryProgress
              progress={t!.printProgress == null ? null : t!.printProgress * 100}
              layer={t!.printLayer}
              totalLayers={t!.targetPrintLayer}
              elapsedSeconds={t!.printDuration}
              remainingSeconds={estimateRemainingSeconds(t!.printProgress, t!.printDuration)}
            />
          </div>
        ) : (
          <p className="text-muted-foreground">No job in progress.</p>
        )}

        {!manual && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Nozzle</dt>
            <dd>{temp(t?.nozzleTemp, t?.nozzleTargetTemp)}</dd>
            <dt className="text-muted-foreground">Bed</dt>
            <dd>{temp(t?.bedTemp, t?.bedTargetTemp)}</dd>
            <dt className="text-muted-foreground">Filament</dt>
            <dd>
              <LoadedFilament t={t} />
            </dd>
          </dl>
        )}

        {!manual && !p.bed_clear && !["printing", "heating", "pause", "pausing"].includes(p.raw_status ?? "") && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            Clear the build plate and confirm before the next print.
          </p>
        )}
        {p.queued_count > 0 && (
          <p className="text-xs text-muted-foreground">
            {p.queued_count} queued job{p.queued_count === 1 ? "" : "s"} assigned
          </p>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
        <span className="text-[11px] text-muted-foreground">
          {manual
            ? `Manual status · updated ${formatShortDateTime(p.status_updated_at, timeZone)}`
            : `Last status ${ago(p.last_seen_at, now)}${p.telemetry_source === "mock" ? " · simulated" : ""}`}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {!manual && (
            <PrinterControls
              printerId={p.id}
              printerName={p.name}
              live={conn.live}
              job={job ? { id: job.id, label: jobLabel(job), productName: job.product_name, status: job.status } : null}
              rawStatus={p.raw_status}
              bedClear={p.bed_clear}
              canOperate={canOperate}
            />
          )}
          {manual && canOperate && <PrinterStatusSelect id={p.id} status={p.status} name={p.name} />}
          {manual && canEdit && (
            <PrinterFormDialog
              printer={p}
              trigger={
                <Button size="icon-sm" variant="outline" aria-label={`Edit ${p.name}`}>
                  <PencilIcon />
                </Button>
              }
            />
          )}
          <Button asChild size="icon-sm" variant="ghost" aria-label={`${p.name} details`}>
            <Link href={`/printers/${p.id}`}>
              <ChevronRightIcon />
            </Link>
          </Button>
        </div>
      </footer>
    </article>
  );
}
