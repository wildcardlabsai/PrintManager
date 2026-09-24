import Link from "next/link";
import { PencilIcon, PrinterIcon } from "lucide-react";
import { JobProgress } from "@/components/production/job-progress";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatShortDateTime } from "@/lib/domain/dates";
import { PRINTER_STATUS_META } from "@/lib/domain/labels";
import type { PrinterWithJob } from "@/lib/services/printers";
import { PrinterFormDialog } from "./printer-form-dialog";
import { PrinterStatusSelect } from "./printer-status-select";

export function PrinterCard({ printer: p, timeZone, editable = true }: { printer: PrinterWithJob; timeZone: string; editable?: boolean }) {
  const job = p.current_job;
  return (
    <article className="flex flex-col rounded-lg border bg-card">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <PrinterIcon className="size-4 text-muted-foreground" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{p.name}</h3>
            <p className="truncate text-xs text-muted-foreground">
              {[p.manufacturer, p.model].filter(Boolean).join(" ")}
              {p.location && ` · ${p.location}`}
            </p>
          </div>
        </div>
        <StatusBadge meta={PRINTER_STATUS_META[p.status]} />
      </header>
      <div className="flex-1 space-y-3 px-4 py-3 text-[13px]">
        {job ? (
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">{job.status === "paused" ? "Paused job" : "Current job"}</div>
            <Link href={`/production/${job.id}`} className="font-medium hover:underline">
              {job.product_name} × {job.quantity}
            </Link>
            <JobProgress job={job} />
          </div>
        ) : (
          <p className="text-muted-foreground">No job in progress.</p>
        )}
        {p.queued_count > 0 && (
          <p className="text-xs text-muted-foreground">
            {p.queued_count} queued job{p.queued_count === 1 ? "" : "s"} assigned
          </p>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
        <span className="text-[11px] text-muted-foreground">
          Manual status · updated {formatShortDateTime(p.status_updated_at, timeZone)}
        </span>
        {editable && (
          <div className="flex items-center gap-1.5">
            <PrinterStatusSelect id={p.id} status={p.status} name={p.name} />
            <PrinterFormDialog
              printer={p}
              trigger={
                <Button size="icon-sm" variant="outline" aria-label={`Edit ${p.name}`}>
                  <PencilIcon />
                </Button>
              }
            />
          </div>
        )}
      </footer>
    </article>
  );
}
