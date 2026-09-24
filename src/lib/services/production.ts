import "server-only";
import {
  JOB_ACTION_TARGET,
  canPerformJobAction,
  compareQueue,
  deriveProductionStatus,
  elapsedPrintMinutes,
  orderStatusAfterJobChange,
  type JobAction,
} from "@/lib/domain/production";
import { orderStatusSideEffects } from "@/lib/domain/order-workflow";
import type { JobCompleteInput, JobUpdateInput } from "@/lib/validation/schemas";
import type {
  AuditLog,
  Filament,
  FilamentUsage,
  JobPriority,
  JobStatus,
  Order,
  Printer,
  ProductionJob,
  StatusHistoryEntry,
} from "@/types/db";
import { logAudit, recordStatusChange, type AuditEvent } from "./audit";
import type { AppContext } from "./context";
import { AppError, check, checkFound, fromDbError } from "./errors";
import { resolveUserNames } from "./orders";

export const jobLabel = (job: Pick<ProductionJob, "job_number">) => `JOB-${String(job.job_number).padStart(4, "0")}`;

export interface QueueJob extends ProductionJob {
  printer: Pick<Printer, "id" | "name"> | null;
  order: Pick<Order, "id" | "order_number" | "customer_name" | "status" | "sales_channel"> | null;
}

const QUEUE_SELECT =
  "*, printer:printers(id, name), order:orders(id, order_number, customer_name, status, sales_channel)";

export interface ProductionBoard {
  queued: QueueJob[];
  active: QueueJob[];
  failed: QueueJob[];
  printed: QueueJob[];
}

export async function getProductionBoard(ctx: AppContext, opts: { printedLimit?: number } = {}): Promise<ProductionBoard> {
  const [open, printed] = await Promise.all([
    ctx.supabase
      .from("production_jobs")
      .select(QUEUE_SELECT)
      .eq("organization_id", ctx.orgId)
      .in("status", ["queued", "printing", "paused", "failed"])
      .limit(500),
    ctx.supabase
      .from("production_jobs")
      .select(QUEUE_SELECT)
      .eq("organization_id", ctx.orgId)
      .eq("status", "printed")
      .order("completed_at", { ascending: false })
      .limit(opts.printedLimit ?? 25),
  ]);
  const openJobs = (check(open) as QueueJob[]).filter((j) => j.order?.status !== "on_hold" || j.status !== "queued");
  return {
    queued: openJobs.filter((j) => j.status === "queued").sort(compareQueue),
    active: openJobs
      .filter((j) => j.status === "printing" || j.status === "paused")
      .sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? "")),
    failed: openJobs.filter((j) => j.status === "failed").sort((a, b) => (b.failed_at ?? "").localeCompare(a.failed_at ?? "")),
    printed: check(printed) as QueueJob[],
  };
}

export interface JobDetail {
  job: QueueJob;
  filament: Pick<Filament, "id" | "brand" | "material" | "colour" | "remaining_g"> | null;
  usage: FilamentUsage[];
  history: (StatusHistoryEntry & { changed_by_name: string | null })[];
  activity: AuditLog[];
}

export async function getJob(ctx: AppContext, id: string): Promise<JobDetail> {
  const job = checkFound(
    await ctx.supabase.from("production_jobs").select(QUEUE_SELECT).eq("id", id).eq("organization_id", ctx.orgId).maybeSingle(),
    "Production job",
  ) as QueueJob;
  const [filament, usage, history, activity] = await Promise.all([
    job.filament_id
      ? ctx.supabase.from("filaments").select("id, brand, material, colour, remaining_g").eq("id", job.filament_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    ctx.supabase.from("filament_usage").select("*").eq("production_job_id", id).order("created_at"),
    ctx.supabase
      .from("status_history")
      .select("*")
      .eq("entity_type", "production_job")
      .eq("entity_id", id)
      .order("created_at", { ascending: false }),
    ctx.supabase
      .from("audit_logs")
      .select("*")
      .eq("entity_type", "production_job")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const historyRows = check(history) as StatusHistoryEntry[];
  const names = await resolveUserNames(ctx, historyRows.map((h) => h.changed_by));
  return {
    job,
    filament: check(filament) as JobDetail["filament"],
    usage: check(usage) as FilamentUsage[],
    history: historyRows.map((h) => ({ ...h, changed_by_name: h.changed_by ? names.get(h.changed_by) ?? null : null })),
    activity: check(activity) as AuditLog[],
  };
}

async function loadJob(ctx: AppContext, id: string) {
  return checkFound(
    await ctx.supabase.from("production_jobs").select("*").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle(),
    "Production job",
  ) as ProductionJob;
}

async function assertPrinterFree(ctx: AppContext, printerId: string, exceptJobId: string) {
  const { data } = await ctx.supabase
    .from("production_jobs")
    .select("job_number, product_name, printer:printers(name)")
    .eq("printer_id", printerId)
    .eq("status", "printing")
    .neq("id", exceptJobId)
    .limit(1)
    .maybeSingle();
  if (data) {
    const printer = (data as unknown as { printer: { name: string } | null }).printer;
    throw new AppError(
      `${printer?.name ?? "That printer"} is already printing ${jobLabel(data as Pick<ProductionJob, "job_number">)} (${
        (data as { product_name: string }).product_name
      }). Complete or pause it first.`,
      "conflict",
    );
  }
}

/** Phase 1 printer status is manual; PrintFlow records the change the user's action implies. */
async function setPrinterStatus(ctx: AppContext, printerId: string, status: "printing" | "idle", onlyIf?: string) {
  let q = ctx.supabase
    .from("printers")
    .update({ status, status_source: "manual", status_updated_at: new Date().toISOString() })
    .eq("id", printerId);
  if (onlyIf) q = q.eq("status", onlyIf);
  const { error } = await q;
  if (error) console.error("[printers] status update failed", error);
}

async function printerHasOtherActiveJob(ctx: AppContext, printerId: string, exceptJobId: string) {
  const { count } = await ctx.supabase
    .from("production_jobs")
    .select("id", { count: "exact", head: true })
    .eq("printer_id", printerId)
    .eq("status", "printing")
    .neq("id", exceptJobId);
  return (count ?? 0) > 0;
}

export interface JobActionPayload {
  printerId?: string | null;
  complete?: JobCompleteInput;
  failureReason?: string | null;
  wasteGrams?: number | null;
  wasteFilamentId?: string | null;
}

const ACTION_EVENTS: Record<JobAction, AuditEvent> = {
  start: "production_job.started",
  pause: "production_job.paused",
  resume: "production_job.resumed",
  complete: "production_job.completed",
  fail: "production_job.failed",
  cancel: "production_job.cancelled",
  requeue: "production_job.requeued",
};

/**
 * Applies a manual production action. Phase 1 does not talk to printers:
 * these actions record what the operator did at the machine.
 */
export async function performJobAction(ctx: AppContext, jobId: string, action: JobAction, payload: JobActionPayload = {}) {
  const job = await loadJob(ctx, jobId);
  if (!canPerformJobAction(job.status, action)) {
    throw new AppError(`A job that is ${job.status} can't be ${action === "requeue" ? "re-queued" : `${action}ed`}.`, "validation");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const patch: Partial<ProductionJob> = { status: JOB_ACTION_TARGET[action] };
  const meta: Record<string, unknown> = { order_id: job.order_id };
  let note: string | null = null;

  switch (action) {
    case "start":
    case "resume": {
      const printerId = payload.printerId ?? job.printer_id;
      if (!printerId) throw new AppError("Assign a printer before starting this job.", "validation", { printer_id: "Required" });
      await assertPrinterFree(ctx, printerId, job.id);
      patch.printer_id = printerId;
      patch.last_resumed_at = nowIso;
      if (!job.started_at) patch.started_at = nowIso;
      meta.printer_id = printerId;
      break;
    }
    case "pause":
      patch.accumulated_minutes = elapsedPrintMinutes(job, now);
      patch.last_resumed_at = null;
      break;
    case "complete": {
      const input: Partial<JobCompleteInput> = payload.complete ?? {};
      const elapsed = elapsedPrintMinutes(job, now);
      patch.actual_minutes = input.actual_minutes ?? elapsed;
      patch.accumulated_minutes = elapsed;
      patch.last_resumed_at = null;
      patch.completed_at = nowIso;
      if (input.actual_grams != null) patch.actual_grams = input.actual_grams;
      if (input.filament_id) patch.filament_id = input.filament_id;
      if (input.notes) patch.notes = job.notes ? `${job.notes}\n${input.notes}` : input.notes;
      if (input.filament_id && input.actual_grams && input.actual_grams > 0) {
        const { error } = await ctx.supabase.rpc("record_filament_usage", {
          p_filament: input.filament_id,
          p_grams: input.actual_grams,
          p_job: job.id,
          p_note: `${jobLabel(job)} completed`,
        });
        if (error) throw fromDbError(error, "Filament usage could not be recorded.");
        meta.filament_id = input.filament_id;
      }
      meta.actual_minutes = patch.actual_minutes;
      meta.actual_grams = patch.actual_grams ?? null;
      break;
    }
    case "fail": {
      patch.accumulated_minutes = elapsedPrintMinutes(job, now);
      patch.last_resumed_at = null;
      patch.failed_at = nowIso;
      patch.failure_reason = payload.failureReason ?? null;
      note = payload.failureReason ?? null;
      if (payload.wasteFilamentId && payload.wasteGrams && payload.wasteGrams > 0) {
        const { error } = await ctx.supabase.rpc("record_filament_usage", {
          p_filament: payload.wasteFilamentId,
          p_grams: payload.wasteGrams,
          p_job: job.id,
          p_note: `${jobLabel(job)} failed print`,
        });
        if (error) throw fromDbError(error, "Filament usage could not be recorded.");
        meta.waste_grams = payload.wasteGrams;
      }
      meta.reason = payload.failureReason ?? null;
      break;
    }
    case "cancel":
      patch.last_resumed_at = null;
      break;
    case "requeue":
      if (job.status === "failed") patch.attempts = job.attempts + 1;
      patch.started_at = null;
      patch.completed_at = null;
      patch.last_resumed_at = null;
      patch.accumulated_minutes = 0;
      patch.actual_minutes = null;
      patch.actual_grams = null;
      break;
  }

  const { error } = await ctx.supabase.from("production_jobs").update(patch).eq("id", job.id);
  if (error) throw fromDbError(error);

  // Record the manual printer status implied by the action.
  const printerId = patch.printer_id ?? job.printer_id;
  if (printerId) {
    if (action === "start" || action === "resume") await setPrinterStatus(ctx, printerId, "printing");
    else if (job.status === "printing" && !(await printerHasOtherActiveJob(ctx, printerId, job.id))) {
      await setPrinterStatus(ctx, printerId, "idle", "printing");
    }
  }

  await recordStatusChange(ctx, "production_job", job.id, job.status, patch.status!, note);
  await logAudit(
    ctx,
    ACTION_EVENTS[action],
    { type: "production_job", id: job.id },
    `${jobLabel(job)} ${job.product_name} × ${job.quantity}: ${job.status} → ${patch.status}`,
    meta,
  );

  if (job.order_id) await syncOrderWithJobs(ctx, job.order_id);
}

/** Keeps the order's production status (and main status) in step with its jobs. */
export async function syncOrderWithJobs(ctx: AppContext, orderId: string) {
  const [orderRes, jobsRes] = await Promise.all([
    ctx.supabase.from("orders").select("id, order_number, status, production_status").eq("id", orderId).maybeSingle(),
    ctx.supabase.from("production_jobs").select("status").eq("order_id", orderId),
  ]);
  const order = check(orderRes) as Pick<Order, "id" | "order_number" | "status" | "production_status"> | null;
  if (!order) return;
  const jobs = check(jobsRes) as { status: JobStatus }[];

  const production_status = deriveProductionStatus(jobs);
  const nextStatus = orderStatusAfterJobChange(order.status, jobs);
  const patch: Partial<Order> = {};
  if (production_status !== order.production_status) patch.production_status = production_status;
  if (nextStatus && nextStatus !== order.status) {
    patch.status = nextStatus;
    Object.assign(patch, orderStatusSideEffects(nextStatus));
    delete (patch as Record<string, unknown>).setShippedAt;
    delete (patch as Record<string, unknown>).setCompletedAt;
  }
  if (!Object.keys(patch).length) return;
  check(await ctx.supabase.from("orders").update(patch).eq("id", orderId));
  if (patch.status) {
    await recordStatusChange(ctx, "order", orderId, order.status, patch.status, "Updated automatically from production");
    await logAudit(
      ctx,
      "order.status_changed",
      { type: "order", id: orderId },
      `Order ${order.order_number}: ${order.status} → ${patch.status} (production)`,
      { from: order.status, to: patch.status, automatic: true },
    );
  }
}

export async function assignPrinter(ctx: AppContext, jobId: string, printerId: string | null) {
  const job = await loadJob(ctx, jobId);
  if (job.status === "printing" && printerId !== job.printer_id) {
    if (printerId) await assertPrinterFree(ctx, printerId, job.id);
  }
  check(await ctx.supabase.from("production_jobs").update({ printer_id: printerId }).eq("id", jobId));
  if (job.status === "printing") {
    if (job.printer_id && !(await printerHasOtherActiveJob(ctx, job.printer_id, job.id))) {
      await setPrinterStatus(ctx, job.printer_id, "idle", "printing");
    }
    if (printerId) await setPrinterStatus(ctx, printerId, "printing");
  }
  await logAudit(
    ctx,
    "production_job.updated",
    { type: "production_job", id: jobId },
    `${jobLabel(job)} ${printerId ? "assigned to a printer" : "unassigned"}`,
    { order_id: job.order_id, printer_id: printerId, previous_printer_id: job.printer_id },
  );
}

export async function updateJob(ctx: AppContext, jobId: string, input: JobUpdateInput) {
  const job = await loadJob(ctx, jobId);
  if (input.printer_id !== job.printer_id) await assignPrinter(ctx, jobId, input.printer_id);
  const { printer_id: _p, ...rest } = input;
  void _p;
  check(await ctx.supabase.from("production_jobs").update(rest).eq("id", jobId));
  await logAudit(ctx, "production_job.updated", { type: "production_job", id: jobId }, `${jobLabel(job)} details updated`, {
    order_id: job.order_id,
    priority: input.priority,
  });
}

export async function setJobPriority(ctx: AppContext, jobId: string, priority: JobPriority) {
  const job = await loadJob(ctx, jobId);
  check(await ctx.supabase.from("production_jobs").update({ priority }).eq("id", jobId));
  await logAudit(ctx, "production_job.updated", { type: "production_job", id: jobId }, `${jobLabel(job)} priority → ${priority}`, {
    order_id: job.order_id,
    priority,
  });
}

/**
 * Moves a queued job up/down within its priority band, or to the very front
 * of the queue ("print next", which also raises it to urgent).
 */
export async function moveJob(ctx: AppContext, jobId: string, direction: "up" | "down" | "next") {
  const job = await loadJob(ctx, jobId);
  if (job.status !== "queued") throw new AppError("Only jobs awaiting print can be reordered.", "validation");
  const queued = (
    check(
      await ctx.supabase
        .from("production_jobs")
        .select("id, priority, queue_position, created_at")
        .eq("organization_id", ctx.orgId)
        .eq("status", "queued"),
    ) as Pick<ProductionJob, "id" | "priority" | "queue_position" | "created_at">[]
  ).sort(compareQueue);

  if (direction === "next") {
    const minPos = Math.min(...queued.map((j) => j.queue_position));
    check(
      await ctx.supabase
        .from("production_jobs")
        .update({ priority: "urgent", queue_position: minPos - 1 })
        .eq("id", jobId),
    );
  } else {
    const band = queued.filter((j) => j.priority === job.priority);
    const idx = band.findIndex((j) => j.id === jobId);
    const swapWith = band[direction === "up" ? idx - 1 : idx + 1];
    if (!swapWith) {
      throw new AppError(
        direction === "up"
          ? `Already first among ${job.priority}-priority jobs. Raise its priority to move it further up.`
          : `Already last among ${job.priority}-priority jobs.`,
        "validation",
      );
    }
    // Positions can tie (same created second), so assign distinct values.
    const a = job.queue_position;
    const b = swapWith.queue_position === a ? a + (direction === "up" ? -0.001 : 0.001) : swapWith.queue_position;
    check(await ctx.supabase.from("production_jobs").update({ queue_position: b }).eq("id", jobId));
    check(await ctx.supabase.from("production_jobs").update({ queue_position: a }).eq("id", swapWith.id));
  }
  await logAudit(ctx, "production_job.updated", { type: "production_job", id: jobId }, `${jobLabel(job)} moved ${direction === "next" ? "to the front of the queue" : direction}`, {
    order_id: job.order_id,
  });
}
