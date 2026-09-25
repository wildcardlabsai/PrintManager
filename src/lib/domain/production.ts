import type { JobStatus, OrderStatus, ProductionStatus, JobPriority } from "@/types/db";

export type JobAction = "start" | "pause" | "resume" | "complete" | "fail" | "cancel" | "requeue";

const JOB_ACTIONS: Record<JobStatus, JobAction[]> = {
  queued: ["start", "cancel"],
  // Dispatch to a connected printer is in flight: wait for the printer (or the timeout).
  sending: [],
  sent: ["fail"],
  printing: ["complete", "pause", "fail", "cancel"],
  paused: ["resume", "complete", "fail", "cancel"],
  failed: ["requeue", "cancel"],
  printed: [],
  cancelled: ["requeue"],
};

export function allowedJobActions(status: JobStatus): JobAction[] {
  return JOB_ACTIONS[status];
}

export function canPerformJobAction(status: JobStatus, action: JobAction) {
  return JOB_ACTIONS[status].includes(action);
}

export const JOB_ACTION_TARGET: Record<JobAction, JobStatus> = {
  start: "printing",
  pause: "paused",
  resume: "printing",
  complete: "printed",
  fail: "failed",
  cancel: "cancelled",
  requeue: "queued",
};

export const ACTIVE_JOB_STATUSES: JobStatus[] = ["printing", "paused"];

/** Whole minutes of printing so far, excluding paused time. */
export function elapsedPrintMinutes(
  job: { accumulated_minutes: number; last_resumed_at: string | null; status: JobStatus },
  now: Date = new Date(),
): number {
  let minutes = job.accumulated_minutes ?? 0;
  if (job.status === "printing" && job.last_resumed_at) {
    const diff = now.getTime() - new Date(job.last_resumed_at).getTime();
    if (diff > 0) minutes += diff / 60000;
  }
  return Math.max(0, Math.round(minutes));
}

/** Order-level production summary derived from its jobs. */
export function deriveProductionStatus(jobs: { status: JobStatus }[]): ProductionStatus {
  const live = jobs.filter((j) => j.status !== "cancelled");
  if (live.length === 0) return "not_started";
  if (live.every((j) => j.status === "printed")) return "completed";
  if (live.some((j) => j.status === "failed")) return "failed";
  if (live.some((j) => j.status === "printing" || j.status === "paused" || j.status === "printed")) {
    return "in_progress";
  }
  return "not_started";
}

const PRE_PRINT: OrderStatus[] = ["new", "confirmed", "awaiting_print"];

/**
 * How an order's status should move after its jobs change. Returns null when
 * the order should stay where it is (e.g. it is on hold or already packing).
 */
export function orderStatusAfterJobChange(orderStatus: OrderStatus, jobs: { status: JobStatus }[]): OrderStatus | null {
  const live = jobs.filter((j) => j.status !== "cancelled");
  const allPrinted = live.length > 0 && live.every((j) => j.status === "printed");
  if (allPrinted && (PRE_PRINT.includes(orderStatus) || orderStatus === "printing")) return "printed";
  const anyActive = live.some((j) => j.status === "printing" || j.status === "paused");
  if (anyActive && PRE_PRINT.includes(orderStatus)) return "printing";
  return null;
}

export const PRIORITY_RANK: Record<JobPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Queue order: priority first, then manual queue position, then age. */
export function compareQueue(
  a: { priority: JobPriority; queue_position: number; created_at: string },
  b: { priority: JobPriority; queue_position: number; created_at: string },
) {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    a.queue_position - b.queue_position ||
    a.created_at.localeCompare(b.created_at)
  );
}
