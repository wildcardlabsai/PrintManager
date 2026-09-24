import { formatDuration } from "@/lib/domain/dates";
import { elapsedPrintMinutes } from "@/lib/domain/production";
import type { JobStatus } from "@/types/db";

/**
 * Elapsed time since the operator pressed Start (minus pauses) against the
 * estimate. This is not printer telemetry.
 */
export function JobProgress({
  job,
  now = new Date(),
}: {
  job: { status: JobStatus; accumulated_minutes: number; last_resumed_at: string | null; estimated_minutes: number };
  now?: Date;
}) {
  const elapsed = elapsedPrintMinutes(job, now);
  const pct = job.estimated_minutes > 0 ? Math.min(100, Math.round((elapsed / job.estimated_minutes) * 100)) : 0;
  const over = job.estimated_minutes > 0 && elapsed > job.estimated_minutes;
  const remaining = Math.max(0, job.estimated_minutes - elapsed);
  return (
    <div className="space-y-1">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Elapsed versus estimated print time"
      >
        <div className={over ? "h-full bg-amber-500" : "h-full bg-primary"} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          {formatDuration(elapsed)} elapsed{job.status === "paused" ? " (paused)" : ""}
        </span>
        <span>{over ? `${formatDuration(elapsed - job.estimated_minutes)} over estimate` : `~${formatDuration(remaining)} left`}</span>
      </div>
    </div>
  );
}
