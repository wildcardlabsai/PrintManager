import "server-only";
import type { MaterialMapping } from "../../../../agent/src/protocol";
import { checklistComplete, LIVE_CHECKLIST } from "@/lib/printers/checklist";
import { checkDispatch, type DispatchCheck } from "@/lib/printers/dispatch";
import { connectionView } from "@/lib/printers/status";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LiveChecklist, Order, PrintFile, Printer, PrinterCommand, PrinterCommandType, ProductionJob } from "@/types/db";
import { logAudit, recordStatusChange } from "../audit";
import { requirePermission, type AppContext } from "../context";
import { AppError, check, checkFound } from "../errors";
import { jobLabel, syncOrderWithJobs } from "../production";
import { createStartCommand, type PrintOptions } from "./dispatch";
import { resolveJobFile } from "./telemetry";

/**
 * Everything a person does to a connected printer goes through here:
 * authenticated server action → permission check → validation → a queued,
 * whitelisted command for the Printer Agent. The browser never talks to a
 * printer, and nothing here can run anything but the fixed command types.
 */

async function loadPrinter(ctx: AppContext, id: string) {
  return checkFound(
    await ctx.supabase.from("printers").select("*").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle(),
    "Printer",
  ) as Printer;
}

async function loadJob(ctx: AppContext, id: string) {
  return checkFound(
    await ctx.supabase.from("production_jobs").select("*").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle(),
    "Production job",
  ) as ProductionJob;
}

async function agentActive(printer: Pick<Printer, "agent_id" | "organization_id">) {
  if (!printer.agent_id) return false;
  const { data } = await createAdminClient()
    .from("printer_agents")
    .select("status, organization_id")
    .eq("id", printer.agent_id)
    .maybeSingle();
  return data?.status === "active" && data.organization_id === printer.organization_id;
}

async function printerBusy(ctx: AppContext, printerId: string, exceptJobId?: string) {
  const [jobs, cmds] = await Promise.all([
    ctx.supabase
      .from("production_jobs")
      .select("id")
      .eq("printer_id", printerId)
      .in("status", ["sending", "sent", "printing", "paused"]),
    ctx.supabase.from("printer_commands").select("id").eq("printer_id", printerId).eq("type", "start_print").in("status", ["pending", "sent"]),
  ]);
  const busyJobs = (check(jobs) as { id: string }[]).filter((j) => j.id !== exceptJobId);
  return busyJobs.length > 0 || (check(cmds) as unknown[]).length > 0;
}

function assertLive(ctx: AppContext, printer: Printer) {
  if (printer.connection_mode !== "agent_lan") throw new AppError(`${printer.name} isn't connected to PrintFlow.`, "validation");
  const view = connectionView(printer, new Date(), ctx.settings.printer_offline_after_seconds);
  if (!view.live) throw new AppError(`${printer.name}: ${view.label}. ${view.detail}`, "validation");
}

// ---------------------------------------------------------------------------
// Sending prints
// ---------------------------------------------------------------------------

export interface SendPrintInput {
  printerId: string;
  printFileId: string;
  options: PrintOptions;
  materialMappings: MaterialMapping[];
  /** The warnings the person saw and accepted in the confirmation dialog. */
  acknowledgedWarnings: string[];
}

export interface DispatchPreview extends DispatchCheck {
  printer: Pick<Printer, "id" | "name" | "model" | "telemetry" | "telemetry_source">;
  file: PrintFile | null;
}

async function dispatchContext(ctx: AppContext, printerId: string, printFileId: string | null, jobId: string | null, mappings: MaterialMapping[], testPrint = false) {
  const printer = await loadPrinter(ctx, printerId);
  const job = jobId ? await loadJob(ctx, jobId) : null;
  const [order, file, active, busy] = await Promise.all([
    job?.order_id
      ? ctx.supabase.from("orders").select("status, payment_status").eq("id", job.order_id).maybeSingle().then((r) => check(r) as Pick<Order, "status" | "payment_status"> | null)
      : Promise.resolve(null),
    printFileId
      ? ctx.supabase.from("print_files").select("*").eq("id", printFileId).eq("organization_id", ctx.orgId).maybeSingle().then((r) => check(r) as PrintFile | null)
      : job
        ? resolveJobFile(createAdminClient(), job, printer).then((f) => (f && f.organization_id === ctx.orgId ? f : null))
        : Promise.resolve(null),
    agentActive(printer),
    printerBusy(ctx, printerId, jobId ?? undefined),
  ]);
  const verdict = checkDispatch({
    printer,
    agentActive: active,
    job,
    order,
    file,
    printerBusy: busy,
    materialMappings: mappings,
    testPrint,
    now: new Date(),
    offlineAfterSeconds: ctx.settings.printer_offline_after_seconds,
  });
  return { printer, job, file, verdict };
}

/** What the confirmation dialog shows before anything is sent. */
export async function previewDispatch(ctx: AppContext, args: { jobId: string | null; printerId: string; printFileId: string | null; mappings: MaterialMapping[]; testPrint?: boolean }): Promise<DispatchPreview> {
  const { printer, file, verdict } = await dispatchContext(ctx, args.printerId, args.printFileId, args.jobId, args.mappings, args.testPrint);
  return {
    ...verdict,
    printer: { id: printer.id, name: printer.name, model: printer.model, telemetry: printer.telemetry, telemetry_source: printer.telemetry_source },
    file,
  };
}

function assertAcknowledged(verdict: DispatchCheck, acknowledged: string[]) {
  if (verdict.blockers.length) throw new AppError(verdict.blockers[0], "validation");
  const missing = verdict.warnings.filter((w) => !acknowledged.includes(w));
  if (missing.length) throw new AppError(`Please review before sending: ${missing.join(" ")}`, "validation");
}

export async function sendJobToPrinter(ctx: AppContext, jobId: string, input: SendPrintInput) {
  requirePermission(ctx, "operate_printers");
  const { printer, job, file, verdict } = await dispatchContext(ctx, input.printerId, input.printFileId, jobId, input.materialMappings);
  assertAcknowledged(verdict, input.acknowledgedWarnings);
  const admin = createAdminClient();
  const { commandId, fileName } = await createStartCommand(admin, {
    orgId: ctx.orgId,
    settings: ctx.settings,
    printer,
    job: job!,
    file: file!,
    options: input.options,
    mappings: input.materialMappings,
    automatic: false,
    requestedBy: ctx.userId,
  });
  await recordStatusChange(ctx, "production_job", job!.id, "queued", "sending", `Sent to ${printer.name}`);
  await logAudit(ctx, "production_job.sent_to_printer", { type: "production_job", id: job!.id }, `${jobLabel(job!)} sent to ${printer.name} (${file!.name})`, {
    order_id: job!.order_id,
    printer_id: printer.id,
    print_file_id: file!.id,
    command_id: commandId,
    printer_file_name: fileName,
    options: input.options,
    material_mappings: input.materialMappings,
    acknowledged_warnings: input.acknowledgedWarnings,
  });
  return { commandId };
}

/** A supervised test print for the live checklist (no production job). Admins only. */
export async function sendTestPrint(ctx: AppContext, input: SendPrintInput) {
  requirePermission(ctx, "configure_printers");
  const { printer, file, verdict } = await dispatchContext(ctx, input.printerId, input.printFileId, null, input.materialMappings, true);
  assertAcknowledged(verdict, input.acknowledgedWarnings);
  const { commandId } = await createStartCommand(createAdminClient(), {
    orgId: ctx.orgId,
    settings: ctx.settings,
    printer,
    job: null,
    file: file!,
    options: input.options,
    mappings: input.materialMappings,
    automatic: false,
    requestedBy: ctx.userId,
  });
  await logAudit(ctx, "printer.command_requested", { type: "printer", id: printer.id }, `Test print of ${file!.name} sent to ${printer.name}`, {
    command_id: commandId,
    type: "start_print",
    test_print: true,
  });
  return { commandId };
}

// ---------------------------------------------------------------------------
// Job control and other commands
// ---------------------------------------------------------------------------

async function queueCommand(
  ctx: AppContext,
  printer: Printer,
  type: Exclude<PrinterCommandType, "start_print">,
  job: ProductionJob | null,
  payload: Record<string, unknown>,
) {
  const { data, error } = await createAdminClient()
    .from("printer_commands")
    .insert({
      organization_id: ctx.orgId,
      printer_id: printer.id,
      agent_id: printer.agent_id,
      production_job_id: job?.id ?? null,
      type,
      payload,
      requested_by: ctx.userId,
      expires_at: new Date(Date.now() + ctx.settings.printer_command_timeout_seconds * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new AppError("Could not queue the command. Please try again.");
  await logAudit(
    ctx,
    "printer.command_requested",
    { type: "printer", id: printer.id },
    `${type.replace("_", " ")} requested for ${printer.name}${job ? ` (${jobLabel(job)})` : ""}`,
    { command_id: data.id, type, production_job_id: job?.id ?? null },
  );
  return data.id as string;
}

export async function controlJobOnPrinter(ctx: AppContext, jobId: string, action: "pause" | "resume" | "stop", confirmed: boolean) {
  requirePermission(ctx, "operate_printers");
  if (action === "stop" && !confirmed) throw new AppError("Stopping a print needs confirmation.", "validation");
  const job = await loadJob(ctx, jobId);
  if (!job.printer_id) throw new AppError("This job has no printer.", "validation");
  const allowed = { pause: ["printing", "sent"], resume: ["paused"], stop: ["sent", "printing", "paused"] }[action];
  if (!allowed.includes(job.status)) throw new AppError(`Can't ${action} a job that is ${job.status}.`, "validation");
  const printer = await loadPrinter(ctx, job.printer_id);
  if (!(await agentActive(printer))) throw new AppError("No active Printer Agent for this printer.", "validation");
  assertLive(ctx, printer);
  if (!job.external_printer_job_id && !job.printer_file_name) {
    throw new AppError("PrintFlow can't identify this print on the printer, so it won't control it. Use the printer's screen.", "validation");
  }
  const commandId = await queueCommand(ctx, printer, action, job, {
    expectedJobId: job.external_printer_job_id,
    expectedFileName: job.printer_file_name,
  });
  return { commandId };
}

export async function requestPrinterCheck(ctx: AppContext, printerId: string, type: "refresh" | "test_connection") {
  requirePermission(ctx, "operate_printers");
  const printer = await loadPrinter(ctx, printerId);
  if (printer.connection_mode !== "agent_lan") throw new AppError(`${printer.name} isn't connected to PrintFlow.`, "validation");
  if (!(await agentActive(printer))) throw new AppError("No active Printer Agent is assigned to this printer.", "validation");
  return { commandId: await queueCommand(ctx, printer, type, null, {}) };
}

export async function getCommand(ctx: AppContext, commandId: string) {
  return checkFound(
    await ctx.supabase
      .from("printer_commands")
      .select("id, type, status, error, error_code, result, created_at, sent_at, completed_at, printer_id, production_job_id")
      .eq("id", commandId)
      .eq("organization_id", ctx.orgId)
      .maybeSingle(),
    "Command",
  ) as Pick<PrinterCommand, "id" | "type" | "status" | "error" | "error_code" | "result" | "created_at" | "sent_at" | "completed_at" | "printer_id" | "production_job_id">;
}

/** Cancels a start that the agent hasn't picked up yet. */
export async function cancelPendingStart(ctx: AppContext, jobId: string) {
  requirePermission(ctx, "operate_printers");
  const job = await loadJob(ctx, jobId);
  if (job.status !== "sending") throw new AppError("This job isn't being sent.", "validation");
  const admin = createAdminClient();
  const { data: cancelled } = await admin
    .from("printer_commands")
    .update({ status: "cancelled", completed_at: new Date().toISOString(), error: "Cancelled by user" })
    .eq("production_job_id", jobId)
    .eq("type", "start_print")
    .eq("status", "pending")
    .select("id");
  if (!cancelled?.length) {
    throw new AppError("The Printer Agent has already picked this up. Wait for the printer to respond, then stop it if needed.", "conflict");
  }
  await admin.from("production_jobs").update({ status: "queued", printer_file_name: null }).eq("id", jobId).eq("status", "sending");
  await recordStatusChange(ctx, "production_job", jobId, "sending", "queued", "Send cancelled");
  await logAudit(ctx, "production_job.updated", { type: "production_job", id: jobId }, `${jobLabel(job)}: send to printer cancelled`, { order_id: job.order_id });
}

/** After a finished print is removed from the plate. Optionally tells the printer too. */
export async function confirmBedClear(ctx: AppContext, printerId: string, tellPrinter: boolean) {
  requirePermission(ctx, "operate_printers");
  const printer = await loadPrinter(ctx, printerId);
  const phaseBusy = ["printing", "heating", "pause", "pausing", "calibrate_doing", "busy"].includes(printer.raw_status ?? "");
  if (printer.connection_mode === "agent_lan" && phaseBusy) throw new AppError(`${printer.name} is still printing.`, "validation");
  check(
    await ctx.supabase
      .from("printers")
      .update({ bed_clear: true, bed_clear_confirmed_at: new Date().toISOString() })
      .eq("id", printerId)
      .eq("organization_id", ctx.orgId),
  );
  await logAudit(ctx, "printer.bed_cleared", { type: "printer", id: printerId }, `${printer.name}: build plate confirmed clear`);
  if (tellPrinter && printer.connection_mode === "agent_lan" && printer.raw_status === "completed" && (await agentActive(printer))) {
    await queueCommand(ctx, printer, "clear_platform", null, {});
  }
}

// ---------------------------------------------------------------------------
// Failures and attention
// ---------------------------------------------------------------------------

/** Retry: back to the queue on the same printer (never started automatically). */
export async function retryJob(ctx: AppContext, jobId: string, printerId: string | null) {
  requirePermission(ctx, "manage_production");
  const job = await loadJob(ctx, jobId);
  if (job.status !== "failed" && !(job.status === "queued" && job.needs_attention)) {
    throw new AppError("Only failed jobs (or jobs whose send failed) can be retried.", "validation");
  }
  const patch: Partial<ProductionJob> = {
    status: "queued",
    printer_id: printerId === undefined ? job.printer_id : printerId,
    needs_attention: false,
    attention_code: null,
    attention_reason: null,
    started_at: null,
    completed_at: null,
    failed_at: null,
    last_resumed_at: null,
    accumulated_minutes: 0,
    actual_minutes: null,
    progress: null,
    remaining_seconds: null,
    printer_status: null,
    external_printer_job_id: null,
    printer_file_name: null,
    sent_at: null,
  };
  if (job.status === "failed") patch.attempts = job.attempts + 1;
  check(await ctx.supabase.from("production_jobs").update(patch).eq("id", jobId));
  await recordStatusChange(ctx, "production_job", jobId, job.status, "queued", printerId !== job.printer_id ? "Reassigned for retry" : "Retry");
  await logAudit(ctx, "production_job.requeued", { type: "production_job", id: jobId }, `${jobLabel(job)} queued again${printerId !== job.printer_id ? " on another printer" : ""}`, {
    order_id: job.order_id,
    printer_id: patch.printer_id,
    previous_printer_id: job.printer_id,
  });
  if (job.order_id) await syncOrderWithJobs(ctx, job.order_id);
}

/** Mark failed: keep the failure, record waste, and clear the alert. */
export async function acknowledgeFailure(ctx: AppContext, jobId: string, input: { reason: string | null; wasteGrams: number | null; wasteFilamentId: string | null }) {
  requirePermission(ctx, "manage_production");
  const job = await loadJob(ctx, jobId);
  const running = ["sent", "printing", "paused"].includes(job.status);
  if (running) throw new AppError("This print may still be running. Stop it (or confirm on the printer) before marking it failed.", "validation");
  if (input.wasteFilamentId && input.wasteGrams && input.wasteGrams > 0) {
    const { error } = await ctx.supabase.rpc("record_filament_usage", {
      p_filament: input.wasteFilamentId,
      p_grams: input.wasteGrams,
      p_job: job.id,
      p_note: `${jobLabel(job)} failed print`,
    });
    if (error) throw new AppError("Filament usage could not be recorded.");
  }
  const patch: Partial<ProductionJob> = {
    needs_attention: false,
    attention_code: null,
    attention_reason: null,
    failure_reason: input.reason ?? job.failure_reason,
  };
  if (job.status !== "failed") Object.assign(patch, { status: "failed", failed_at: new Date().toISOString() });
  check(await ctx.supabase.from("production_jobs").update(patch).eq("id", jobId));
  if (job.status !== "failed") await recordStatusChange(ctx, "production_job", jobId, job.status, "failed", input.reason);
  await logAudit(ctx, "production_job.attention_resolved", { type: "production_job", id: jobId }, `${jobLabel(job)} marked failed`, {
    order_id: job.order_id,
    reason: input.reason,
    waste_grams: input.wasteGrams,
  });
  if (job.order_id) await syncOrderWithJobs(ctx, job.order_id);
}

/** Dismiss an informational alert (e.g. after checking a printer that went offline). */
export async function dismissAttention(ctx: AppContext, jobId: string) {
  requirePermission(ctx, "manage_production");
  const job = await loadJob(ctx, jobId);
  check(await ctx.supabase.from("production_jobs").update({ needs_attention: false, attention_code: null, attention_reason: null }).eq("id", jobId));
  await logAudit(ctx, "production_job.attention_resolved", { type: "production_job", id: jobId }, `${jobLabel(job)}: alert dismissed`, {
    order_id: job.order_id,
    code: job.attention_code,
  });
}

/**
 * Review a finished print: actual filament used (PrintFlow never guesses it),
 * and whether the file can be trusted for automatic printing.
 */
export async function reviewPrint(ctx: AppContext, jobId: string, input: { filamentId: string | null; actualGrams: number | null; printOk: boolean; markFileProven: boolean; notes: string | null }) {
  requirePermission(ctx, "manage_production");
  const job = await loadJob(ctx, jobId);
  if (job.status !== "printed") throw new AppError("Only printed jobs can be reviewed.", "validation");
  if (job.filament_recorded) throw new AppError("This print has already been reviewed.", "conflict");
  if (input.filamentId && input.actualGrams && input.actualGrams > 0) {
    const { error } = await ctx.supabase.rpc("record_filament_usage", {
      p_filament: input.filamentId,
      p_grams: input.actualGrams,
      p_job: job.id,
      p_note: `${jobLabel(job)} printed`,
    });
    if (error) throw new AppError("Filament usage could not be recorded. Check the spool has enough remaining.");
  }
  check(
    await ctx.supabase
      .from("production_jobs")
      .update({
        filament_recorded: true,
        actual_grams: input.actualGrams,
        filament_id: input.filamentId ?? job.filament_id,
        notes: input.notes ? (job.notes ? `${job.notes}\n${input.notes}` : input.notes) : job.notes,
      })
      .eq("id", jobId),
  );
  if (input.printOk && input.markFileProven && job.print_file_id) {
    const { data: file } = await ctx.supabase.from("print_files").select("id, name, verified_at").eq("id", job.print_file_id).maybeSingle();
    if (file && !file.verified_at) {
      check(await ctx.supabase.from("print_files").update({ verified_at: new Date().toISOString(), verified_by: ctx.userId }).eq("id", file.id));
      await logAudit(ctx, "print_file.verified", { type: "print_file", id: file.id }, `Print file "${file.name}" marked proven after ${jobLabel(job)}`);
    }
  }
  await logAudit(ctx, "production_job.reviewed", { type: "production_job", id: jobId }, `${jobLabel(job)} reviewed`, {
    order_id: job.order_id,
    actual_grams: input.actualGrams,
    estimated_grams: job.estimated_grams,
    print_ok: input.printOk,
  });
}

// ---------------------------------------------------------------------------
// Live test checklist
// ---------------------------------------------------------------------------

export async function confirmChecklistStep(ctx: AppContext, printerId: string, key: string, note: string | null) {
  requirePermission(ctx, "configure_printers");
  const step = LIVE_CHECKLIST.find((s) => s.key === key && s.how === "confirm");
  if (!step) throw new AppError("That checklist step is recorded automatically.", "validation");
  const printer = await loadPrinter(ctx, printerId);
  const next: LiveChecklist = { ...printer.live_checklist, [key]: { at: new Date().toISOString(), by: ctx.userId, source: "user", note } };
  check(await ctx.supabase.from("printers").update({ live_checklist: next }).eq("id", printerId));
  await logAudit(ctx, "printer.checklist_updated", { type: "printer", id: printerId }, `${printer.name}: "${step.label}" confirmed`, { step: key, note });
}

export async function markPrinterVerified(ctx: AppContext, printerId: string) {
  requirePermission(ctx, "configure_printers");
  const printer = await loadPrinter(ctx, printerId);
  if (!checklistComplete(printer.live_checklist ?? {})) throw new AppError("Complete every checklist step first.", "validation");
  const simulated = Object.values(printer.live_checklist).some((e) => e?.source === "mock");
  check(await ctx.supabase.from("printers").update({ live_verified_at: new Date().toISOString(), live_verified_by: ctx.userId }).eq("id", printerId));
  await logAudit(ctx, "printer.verified", { type: "printer", id: printerId }, `${printer.name} verified for production${simulated ? " (against a simulated printer)" : ""}`, {
    simulated,
  });
}

export async function resetPrinterVerification(ctx: AppContext, printerId: string) {
  requirePermission(ctx, "configure_printers");
  const printer = await loadPrinter(ctx, printerId);
  check(await ctx.supabase.from("printers").update({ live_checklist: {}, live_verified_at: null, live_verified_by: null }).eq("id", printerId));
  await logAudit(ctx, "printer.checklist_updated", { type: "printer", id: printerId }, `${printer.name}: live checklist reset`);
}

export type { Order };
