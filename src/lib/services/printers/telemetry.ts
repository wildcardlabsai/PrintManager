import "server-only";
import {
  detectModel,
  MODEL_LABELS,
  type AgentCommand,
  type AgentErrorCode,
  type AgentPrinterConfig,
  type CommandResultRequest,
  type FileTicket,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type PrinterReport,
  type StartPrintPayload,
} from "../../../../agent/src/protocol";
import { applyObservations, dropSimulated } from "@/lib/printers/checklist";
import { autoDispatchEligibility } from "@/lib/printers/dispatch";
import { agentSilent, evaluatePrinterReport, reconcileJob, telemetryMatchesJob, type JobUpdate, type PrinterEventDraft } from "@/lib/printers/reconcile";
import { rawPhase } from "@/lib/printers/status";
import { compareQueue } from "@/lib/domain/production";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import type { AttentionCode, JobStatus, Order, PrintFile, Printer, PrinterCommand, ProductionJob, Settings } from "@/types/db";
import { logAudit, recordStatusChange, type AuditEvent } from "../audit";
import type { AppContext } from "../context";
import { systemContext } from "../integrations/system";
import { notify } from "../notifications";
import { jobLabel, syncOrderWithJobs } from "../production";
import { assertAgentOwnsPrinter, maybeRotateToken, type AuthenticatedAgent } from "./agents";
import { createStartCommand, DEFAULT_PRINT_OPTIONS } from "./dispatch";

const POLL_MS = () => Math.max(3, Number(process.env.PRINTER_AGENT_POLL_SECONDS ?? 10)) * 1000;
/** A command the agent took but never reported on is given up after this long. */
const SENT_COMMAND_GIVE_UP_MS = 30 * 60 * 1000;
const ACTIVE_JOB: JobStatus[] = ["sending", "sent", "printing", "paused"];

type Ctx = AppContext & { admin: AdminClient };

async function orgContext(orgId: string): Promise<Ctx> {
  const ctx = await systemContext(orgId);
  return { ...ctx, admin: ctx.supabase as unknown as AdminClient };
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export async function processHeartbeat(agent: AuthenticatedAgent, req: HeartbeatRequest, token: string, ip: string | null): Promise<HeartbeatResponse> {
  const ctx = await orgContext(agent.organization_id);
  const { admin } = ctx;
  const now = new Date();

  await admin
    .from("printer_agents")
    .update({
      last_seen_at: now.toISOString(),
      last_ip: ip,
      version: req.agent.version.slice(0, 40),
      platform: req.agent.platform.slice(0, 60),
      driver: req.agent.driver,
      library_version: req.agent.libraryVersion?.slice(0, 60) ?? null,
    })
    .eq("id", agent.id);

  const printers = (await admin
    .from("printers")
    .select("*")
    .eq("organization_id", agent.organization_id)
    .eq("agent_id", agent.id)
    .eq("connection_mode", "agent_lan")
    .is("archived_at", null)).data as Printer[] | null ?? [];

  const source = req.agent.driver === "mock" ? "mock" : "flashforge_lan";
  for (const printer of printers) {
    const report = req.printers.find((r) => r.printerId === printer.id);
    if (report) await applyReport(ctx, printer, report, source, now);
    else await admin.from("printers").update({ last_heartbeat_at: now.toISOString() }).eq("id", printer.id);
  }

  await expireCommands(ctx, now);
  await sweepStalePrinters(ctx, now);
  if (ctx.settings.auto_print_enabled) {
    for (const printer of printers) await tryAutoDispatch(ctx, printer.id, now);
  }

  const commands = await claimCommands(admin, agent.id, now);
  const rotatedToken = await maybeRotateToken(admin, agent, token);

  return {
    printers: printers.map(toAgentConfig),
    commands,
    pollIntervalMs: POLL_MS(),
    ...(rotatedToken ? { rotatedToken } : {}),
  };
}

function toAgentConfig(p: Printer): AgentPrinterConfig {
  const model = detectModel(p.model);
  return {
    id: p.id,
    name: p.name,
    model,
    modelLabel: model ? MODEL_LABELS[model] : `${p.manufacturer} ${p.model}`.trim(),
    serialNumber: p.serial_number,
    ipAddress: p.ip_address,
    lanPort: p.lan_port,
  };
}

async function claimCommands(admin: AdminClient, agentId: string, now: Date): Promise<AgentCommand[]> {
  const { data } = await admin
    .from("printer_commands")
    .update({ status: "sent", sent_at: now.toISOString() })
    .eq("agent_id", agentId)
    .eq("status", "pending")
    .gt("expires_at", now.toISOString())
    .select("id, printer_id, type, payload, expires_at, created_at");
  return ((data ?? []) as Pick<PrinterCommand, "id" | "printer_id" | "type" | "payload" | "expires_at" | "created_at">[])
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((c) => ({ id: c.id, printerId: c.printer_id, type: c.type, payload: c.payload, expiresAt: c.expires_at }) as AgentCommand);
}

// ---------------------------------------------------------------------------
// Applying a report
// ---------------------------------------------------------------------------

async function applyReport(ctx: Ctx, printer: Printer, report: PrinterReport, source: "flashforge_lan" | "mock", now: Date) {
  const { admin } = ctx;
  const nowIso = now.toISOString();
  const upd = evaluatePrinterReport(printer, report, now, ctx.settings.printer_offline_after_seconds);
  const patch: Partial<Printer> = { ...upd.patch, last_heartbeat_at: nowIso };
  const t = report.reachable ? report.telemetry : null;

  if (t) {
    patch.telemetry_source = source;
    // Simulated ticks never count for a real printer.
    let checklist = printer.live_checklist ?? {};
    if (source === "flashforge_lan" && printer.telemetry_source === "mock") {
      checklist = dropSimulated(checklist);
      patch.live_checklist = checklist;
      patch.live_verified_at = null;
      patch.live_verified_by = null;
    }
    const phase = rawPhase(t.status);
    const observed = applyObservations(
      checklist,
      {
        connected: true,
        status: Boolean(t.status),
        firmware: t.firmwareVersion,
        printing: phase === "printing",
        progress: phase === "printing" && (t.printProgress ?? 0) > 0,
        completed: phase === "completed",
      },
      source,
      nowIso,
    );
    if (observed) patch.live_checklist = observed;
    // Once anything starts on the plate it is no longer clear.
    if (["preparing", "printing", "paused"].includes(phase) && t.jobId && printer.bed_clear) patch.bed_clear = false;
  }

  // Jobs on this printer.
  const { data: jobs } = await admin
    .from("production_jobs")
    .select("*")
    .eq("organization_id", printer.organization_id)
    .eq("printer_id", printer.id)
    .in("status", ACTIVE_JOB);
  let currentJobId: string | null = null;
  const jobEvents = new Map<string, string>();
  for (const job of (jobs ?? []) as ProductionJob[]) {
    let ju: JobUpdate | null = null;
    if (t) {
      ju = reconcileJob(job, t, now, ctx.settings.printer_command_timeout_seconds);
      if (telemetryMatchesJob(job, t)) {
        currentJobId = job.id;
        if (t.jobId || t.printFileName) jobEvents.set("current", job.id);
      }
    } else if (upd.wentOffline && job.status !== "sending") {
      ju = {
        patch: { printer_status: "offline" },
        transition: null,
        attention: { code: "printer_offline", reason: "The printer went offline. PrintFlow can't see this print; check the printer." },
        clearAttention: false,
      };
    }
    if (ju) await applyJobUpdate(ctx, job, ju, printer);
  }
  if (t) patch.current_job_id = currentJobId;

  const { error } = await admin.from("printers").update(patch).eq("id", printer.id);
  if (error) console.error("[printers] telemetry update failed", printer.id, error);

  await recordPrinterEvents(ctx, printer, upd.events, jobEvents.get("current") ?? null);
  if (patch.status && patch.status !== printer.status) {
    await recordStatusChange(ctx, "printer", printer.id, printer.status, patch.status, "From printer telemetry");
  }
  if (upd.cameBack) {
    await logAudit(ctx, "printer.connected", { type: "printer", id: printer.id }, `${printer.name} connected`, { source });
  }
  if (upd.wentOffline) {
    await logAudit(ctx, "printer.disconnected", { type: "printer", id: printer.id }, `${printer.name} went offline`, { error: report.error });
    await notify(admin, printer.organization_id, ctx.settings.notifications, {
      type: "printer_offline",
      severity: "warning",
      title: `${printer.name} is offline`,
      body: report.error ?? "The printer stopped responding on the local network.",
      link: `/printers/${printer.id}`,
      entity: { type: "printer", id: printer.id },
    });
  }
  const errorEvent = upd.events.find((e) => e.type === "error" || e.type === "print_failed");
  if (errorEvent) {
    await notify(admin, printer.organization_id, ctx.settings.notifications, {
      type: "printer_error",
      severity: "error",
      title: `${printer.name}: ${errorEvent.message}`,
      body: report.error ?? null,
      link: `/printers/${printer.id}`,
      entity: { type: "printer", id: printer.id },
    });
  }
}

async function recordPrinterEvents(ctx: Ctx, printer: Printer, events: PrinterEventDraft[], jobId: string | null, source: "telemetry" | "command" | "system" = "telemetry") {
  if (!events.length) return;
  const { error } = await ctx.admin.from("printer_events").insert(
    events.map((e) => ({
      organization_id: printer.organization_id,
      printer_id: printer.id,
      production_job_id: jobId,
      type: e.type,
      from_status: e.from,
      to_status: e.to,
      message: e.message,
      data: e.data ?? {},
      source,
    })),
  );
  if (error) console.error("[printer_events] insert failed", error);
}

const TRANSITION_AUDIT: Record<string, AuditEvent> = {
  started: "production_job.started",
  paused: "production_job.paused",
  resumed: "production_job.resumed",
  completed: "production_job.completed",
  stopped_at_printer: "production_job.failed",
  not_started: "production_job.failed",
};

export async function applyJobUpdate(ctx: Ctx, job: ProductionJob, ju: JobUpdate, printer: Pick<Printer, "id" | "name" | "organization_id">) {
  const patch: Partial<ProductionJob> = { ...ju.patch };
  if (ju.attention) Object.assign(patch, { needs_attention: true, attention_code: ju.attention.code, attention_reason: ju.attention.reason });
  else if (ju.clearAttention) Object.assign(patch, { needs_attention: false, attention_code: null, attention_reason: null });
  if (!Object.keys(patch).length) return;
  const { error } = await ctx.admin.from("production_jobs").update(patch).eq("id", job.id);
  if (error) {
    console.error("[production_jobs] telemetry update failed", job.id, error);
    return;
  }
  const label = `${jobLabel(job)} ${job.product_name} × ${job.quantity}`;
  if (ju.transition && patch.status && patch.status !== job.status) {
    const note = ju.attention?.reason ?? `Reported by ${printer.name}`;
    await recordStatusChange(ctx, "production_job", job.id, job.status, patch.status, note);
    await logAudit(ctx, TRANSITION_AUDIT[ju.transition], { type: "production_job", id: job.id }, `${label}: ${job.status} → ${patch.status} (from ${printer.name})`, {
      order_id: job.order_id,
      printer_id: printer.id,
      automatic: true,
    });
    if (job.order_id) await syncOrderWithJobs(ctx, job.order_id);
  }
  if (ju.transition === "completed") {
    await notify(ctx.admin, printer.organization_id, ctx.settings.notifications, {
      type: "print_completed",
      severity: "success",
      title: `${jobLabel(job)} printed on ${printer.name}`,
      body: `${job.product_name} × ${job.quantity}. Clear the plate, then review the print and record filament used.`,
      link: `/production/${job.id}`,
      entity: { type: "production_job", id: job.id },
    });
  }
  if (ju.attention) {
    await notify(ctx.admin, printer.organization_id, ctx.settings.notifications, {
      type: ju.transition === "stopped_at_printer" ? "print_stopped" : ju.transition === "not_started" ? "dispatch_failed" : "print_failed",
      severity: ju.attention.code === "printer_offline" ? "warning" : "error",
      title: `${jobLabel(job)} needs attention`,
      body: ju.attention.reason,
      link: `/production/${job.id}`,
      entity: { type: "production_job", id: job.id },
    });
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Codes that prove the printer did not receive/start the file. */
const DEFINITE_START_FAILURES: AgentErrorCode[] = [
  "NOT_SUPPORTED",
  "NOT_CONFIGURED",
  "MISSING_CHECK_CODE",
  "AUTH_FAILED",
  "BUSY",
  "INVALID_STATE",
  "JOB_MISMATCH",
  "FILE_NOT_FOUND",
  "CHECKSUM_MISMATCH",
  "DOWNLOAD_FAILED",
  "LIBRARY_UNAVAILABLE",
];

export async function applyCommandResult(agent: AuthenticatedAgent, commandId: string, body: CommandResultRequest) {
  const ctx = await orgContext(agent.organization_id);
  const { admin } = ctx;
  const now = new Date();
  const { data: cmd } = await admin.from("printer_commands").select("*").eq("id", commandId).eq("agent_id", agent.id).maybeSingle();
  if (!cmd) return { found: false };
  const command = cmd as PrinterCommand;
  if (command.status !== "sent") return { found: true, ignored: true }; // already recorded (retry) or cancelled

  const { data: updated } = await admin
    .from("printer_commands")
    .update({
      status: body.status,
      completed_at: now.toISOString(),
      result: body.result ?? null,
      error_code: body.errorCode ?? null,
      error: body.error?.slice(0, 1000) ?? null,
    })
    .eq("id", command.id)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();
  if (!updated) return { found: true, ignored: true };

  const { data: printerRow } = await admin.from("printers").select("*").eq("id", command.printer_id).single();
  const printer = printerRow as Printer;
  assertAgentOwnsPrinter(printer, agent);
  const ok = body.status === "succeeded";

  const label =
    command.type === "start_print" ? "Start print" : command.type === "test_connection" ? "Connection test" : command.type.replace("_", " ");
  await logAudit(
    ctx,
    ok ? "printer.command_completed" : "printer.command_failed",
    { type: "printer", id: printer.id },
    `${printer.name}: ${label} ${ok ? "succeeded" : `failed — ${body.error ?? body.errorCode ?? "unknown error"}`}`,
    { command_id: command.id, type: command.type, error_code: body.errorCode ?? null, production_job_id: command.production_job_id },
  );
  if (!ok) {
    await recordPrinterEvents(
      ctx,
      printer,
      [{ type: "command_failed", from: null, to: null, message: `${label} failed: ${body.error ?? body.errorCode ?? "unknown error"}`, data: { command_id: command.id, type: command.type, error_code: body.errorCode } }],
      command.production_job_id,
      "command",
    );
  }

  // Checklist observations from commands.
  const obs =
    ok && command.type === "test_connection"
      ? { capabilities: true, connected: true }
      : ok && command.type === "start_print" && !command.production_job_id
        ? { testPrintAccepted: true }
        : null;
  if (obs) {
    const next = applyObservations(printer.live_checklist ?? {}, obs, agent.driver === "mock" ? "mock" : "flashforge_lan", now.toISOString());
    if (next) await admin.from("printers").update({ live_checklist: next }).eq("id", printer.id);
  }

  if (command.type === "start_print") {
    if (ok) await admin.from("printers").update({ bed_clear: false }).eq("id", printer.id);
    if (command.production_job_id) await settleStartJob(ctx, command, printer, body, now);
  }
  if (command.type === "stop" && ok && command.production_job_id) {
    const { data: job } = await admin.from("production_jobs").select("*").eq("id", command.production_job_id).maybeSingle();
    if (job && ["sent", "printing", "paused"].includes((job as ProductionJob).status)) {
      const j = job as ProductionJob;
      await applyJobUpdate(
        ctx,
        j,
        {
          patch: { status: "failed", failed_at: now.toISOString(), last_resumed_at: null, failure_reason: "Stopped from PrintFlow", remaining_seconds: null },
          transition: "stopped_at_printer",
          attention: { code: "print_failed", reason: "Stopped from PrintFlow. Retry, reassign or mark it failed." },
          clearAttention: false,
        },
        printer,
      );
    }
  }

  // Fresh telemetry that came with the result.
  if (body.telemetry) {
    const { data: fresh } = await admin.from("printers").select("*").eq("id", printer.id).single();
    await applyReport(
      ctx,
      fresh as Printer,
      { printerId: printer.id, reachable: true, latencyMs: null, errorCode: null, error: null, telemetry: body.telemetry },
      agent.driver === "mock" ? "mock" : "flashforge_lan",
      now,
    );
  }
  return { found: true, ignored: false };
}

async function settleStartJob(ctx: Ctx, command: PrinterCommand, printer: Printer, body: CommandResultRequest, now: Date) {
  const { data } = await ctx.admin.from("production_jobs").select("*").eq("id", command.production_job_id!).maybeSingle();
  const job = data as ProductionJob | null;
  if (!job || job.status !== "sending") return;
  if (body.status === "succeeded") {
    await ctx.admin.from("production_jobs").update({ status: "sent", sent_at: now.toISOString() }).eq("id", job.id).eq("status", "sending");
    await recordStatusChange(ctx, "production_job", job.id, "sending", "sent", `Accepted by ${printer.name}`);
    return;
  }
  const definite = body.errorCode && DEFINITE_START_FAILURES.includes(body.errorCode);
  if (definite) {
    await failDispatch(ctx, job, printer, `${printer.name} didn't start the print: ${body.error ?? body.errorCode}`);
  } else {
    // The printer may or may not have the file (e.g. a timeout mid-upload).
    // Treat it as sent: telemetry will show it printing, or the job fails
    // after the command timeout with a prompt to check the printer.
    await ctx.admin.from("production_jobs").update({ status: "sent", sent_at: now.toISOString() }).eq("id", job.id).eq("status", "sending");
    await recordStatusChange(ctx, "production_job", job.id, "sending", "sent", `Outcome unclear (${body.error ?? body.errorCode}); waiting for printer status`);
  }
}

async function failDispatch(ctx: Ctx, job: ProductionJob, printer: Pick<Printer, "id" | "name" | "organization_id">, reason: string) {
  const code: AttentionCode = "dispatch_failed";
  await ctx.admin
    .from("production_jobs")
    .update({ status: "queued", sent_at: null, printer_file_name: null, needs_attention: true, attention_code: code, attention_reason: reason })
    .eq("id", job.id)
    .eq("status", "sending");
  await recordStatusChange(ctx, "production_job", job.id, "sending", "queued", reason);
  await logAudit(ctx, "production_job.dispatch_failed", { type: "production_job", id: job.id }, `${jobLabel(job)} not sent: ${reason}`, {
    order_id: job.order_id,
    printer_id: printer.id,
  });
  await notify(ctx.admin, printer.organization_id, ctx.settings.notifications, {
    type: "dispatch_failed",
    severity: "error",
    title: `${jobLabel(job)} wasn't sent to ${printer.name}`,
    body: reason,
    link: `/production/${job.id}`,
    entity: { type: "production_job", id: job.id },
  });
}

export async function expireCommands(ctx: Ctx, now = new Date()) {
  const { admin } = ctx;
  const { data: expired } = await admin
    .from("printer_commands")
    .update({ status: "expired", completed_at: now.toISOString(), error: "The Printer Agent didn't pick this up in time." })
    .eq("organization_id", ctx.orgId)
    .eq("status", "pending")
    .lt("expires_at", now.toISOString())
    .select("*");
  const giveUpBefore = new Date(now.getTime() - SENT_COMMAND_GIVE_UP_MS).toISOString();
  const { data: abandoned } = await admin
    .from("printer_commands")
    .update({ status: "failed", completed_at: now.toISOString(), error_code: "TIMEOUT", error: "No result from the Printer Agent." })
    .eq("organization_id", ctx.orgId)
    .eq("status", "sent")
    .lt("sent_at", giveUpBefore)
    .select("*");
  for (const c of [...((expired ?? []) as PrinterCommand[]), ...((abandoned ?? []) as PrinterCommand[])]) {
    if (c.type !== "start_print" || !c.production_job_id) continue;
    const { data: job } = await admin.from("production_jobs").select("*").eq("id", c.production_job_id).maybeSingle();
    const { data: printer } = await admin.from("printers").select("id, name, organization_id").eq("id", c.printer_id).maybeSingle();
    if (!job || !printer || (job as ProductionJob).status !== "sending") continue;
    if (c.status === "expired") {
      await failDispatch(ctx, job as ProductionJob, printer as Printer, "The Printer Agent didn't pick up the print in time. Is it running?");
    } else {
      await admin.from("production_jobs").update({ status: "sent", sent_at: now.toISOString() }).eq("id", c.production_job_id).eq("status", "sending");
    }
  }
}

/** Printers whose agent has gone quiet are offline; their active jobs need a person to check. */
export async function sweepStalePrinters(ctx: AppContext | Ctx, now = new Date()) {
  const admin = "admin" in ctx ? ctx.admin : createAdminClient();
  const threshold = ctx.settings.printer_offline_after_seconds;
  const { data } = await admin
    .from("printers")
    .select("id, name, organization_id, status, connection_state, last_heartbeat_at, last_seen_at")
    .eq("organization_id", ctx.orgId)
    .eq("connection_mode", "agent_lan")
    .not("agent_id", "is", null)
    .not("last_heartbeat_at", "is", null)
    .neq("connection_state", "offline")
    .is("archived_at", null);
  const stale = ((data ?? []) as Printer[]).filter((p) => agentSilent(p.last_heartbeat_at, now, threshold) && agentSilent(p.last_seen_at, now, threshold));
  if (!stale.length) return;
  const sys = "admin" in ctx ? ctx : await orgContext(ctx.orgId);
  for (const p of stale) {
    const { data: moved } = await admin
      .from("printers")
      .update({ connection_state: "offline", status: "offline", status_updated_at: now.toISOString(), last_error: "The Printer Agent stopped reporting." })
      .eq("id", p.id)
      .neq("connection_state", "offline")
      .select("id")
      .maybeSingle();
    if (!moved) continue;
    await recordPrinterEvents(sys, p, [{ type: "disconnected", from: p.connection_state, to: "offline", message: "The Printer Agent stopped reporting" }], null, "system");
    await recordStatusChange(sys, "printer", p.id, p.status, "offline", "Printer Agent stopped reporting");
    await logAudit(sys, "printer.disconnected", { type: "printer", id: p.id }, `${p.name} went offline (agent silent)`);
    await notify(admin, p.organization_id, sys.settings.notifications, {
      type: "printer_offline",
      severity: "warning",
      title: `${p.name} is offline`,
      body: "The Printer Agent stopped reporting. Check the computer running it.",
      link: `/printers/${p.id}`,
      entity: { type: "printer", id: p.id },
    });
    const { data: jobs } = await admin.from("production_jobs").select("*").eq("printer_id", p.id).in("status", ["sent", "printing", "paused"]);
    for (const j of (jobs ?? []) as ProductionJob[]) {
      await applyJobUpdate(
        sys,
        j,
        {
          patch: { printer_status: "offline" },
          transition: null,
          attention: { code: "printer_offline", reason: "The printer went offline. PrintFlow can't see this print; check the printer." },
          clearAttention: false,
        },
        p,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Automatic print queue (off by default)
// ---------------------------------------------------------------------------

async function tryAutoDispatch(ctx: Ctx, printerId: string, now: Date) {
  const { admin } = ctx;
  const { data: p } = await admin.from("printers").select("*").eq("id", printerId).single();
  const printer = p as Printer;
  if (!printer || printer.raw_status !== "ready" || !printer.bed_clear || !printer.live_verified_at) return;

  const [{ data: agent }, { count: busyJobs }, { count: pendingStarts }, { data: queued }] = await Promise.all([
    admin.from("printer_agents").select("status").eq("id", printer.agent_id!).maybeSingle(),
    admin.from("production_jobs").select("id", { count: "exact", head: true }).eq("printer_id", printer.id).in("status", ACTIVE_JOB),
    admin.from("printer_commands").select("id", { count: "exact", head: true }).eq("printer_id", printer.id).eq("type", "start_print").in("status", ["pending", "sent"]),
    admin.from("production_jobs").select("*").eq("organization_id", ctx.orgId).eq("printer_id", printer.id).eq("status", "queued"),
  ]);
  if ((busyJobs ?? 0) > 0 || (pendingStarts ?? 0) > 0) return;
  const next = ((queued ?? []) as ProductionJob[]).sort(compareQueue)[0];
  if (!next) return;

  const [{ data: order }, file] = await Promise.all([
    next.order_id ? admin.from("orders").select("status, payment_status").eq("id", next.order_id).maybeSingle() : Promise.resolve({ data: null }),
    resolveJobFile(admin, next, printer),
  ]);
  const verdict = autoDispatchEligibility({
    printer,
    agentActive: agent?.status === "active",
    job: next,
    order: order as Pick<Order, "status" | "payment_status"> | null,
    file,
    printerBusy: false,
    materialMappings: [],
    now,
    offlineAfterSeconds: ctx.settings.printer_offline_after_seconds,
    autoPrintEnabled: ctx.settings.auto_print_enabled,
    jobAssignedPrinterId: next.printer_id,
    attempts: next.attempts,
    needsAttention: next.needs_attention,
  });
  if (!verdict.eligible || !file) return;
  try {
    await createStartCommand(admin, {
      orgId: ctx.orgId,
      settings: ctx.settings,
      printer,
      job: next,
      file,
      options: DEFAULT_PRINT_OPTIONS,
      mappings: [],
      automatic: true,
      requestedBy: null,
    });
    await recordStatusChange(ctx, "production_job", next.id, "queued", "sending", "Automatic print queue");
    await logAudit(ctx, "production_job.sent_to_printer", { type: "production_job", id: next.id }, `${jobLabel(next)} sent to ${printer.name} automatically`, {
      order_id: next.order_id,
      printer_id: printer.id,
      print_file_id: file.id,
      automatic: true,
    });
  } catch (error) {
    console.error("[auto-dispatch]", error);
  }
}

/** The job's chosen file, else the product's default file for this printer model. */
export async function resolveJobFile(admin: AdminClient, job: Pick<ProductionJob, "print_file_id" | "product_id" | "variant_id">, printer: Pick<Printer, "model">) {
  if (job.print_file_id) {
    const { data } = await admin.from("print_files").select("*").eq("id", job.print_file_id).maybeSingle();
    return (data as PrintFile | null) ?? null;
  }
  if (!job.product_id) return null;
  const { data } = await admin
    .from("print_files")
    .select("*")
    .eq("product_id", job.product_id)
    .eq("is_default", true)
    .is("archived_at", null);
  const model = detectModel(printer.model);
  const files = ((data ?? []) as PrintFile[]).filter((f) => f.compatible_models.some((m) => detectModel(m) === model));
  return files.find((f) => f.variant_id === job.variant_id) ?? files.find((f) => !f.variant_id) ?? null;
}

// ---------------------------------------------------------------------------
// Files for the agent
// ---------------------------------------------------------------------------

export async function fileTicketForCommand(agent: AuthenticatedAgent, commandId: string): Promise<FileTicket | null> {
  const admin = createAdminClient();
  const { data: cmd } = await admin
    .from("printer_commands")
    .select("id, type, status, payload, print_file_id, organization_id")
    .eq("id", commandId)
    .eq("agent_id", agent.id)
    .maybeSingle();
  // Only for a start-print command this agent has claimed and not finished.
  if (!cmd || cmd.type !== "start_print" || cmd.status !== "sent" || !cmd.print_file_id) return null;
  const { data: file } = await admin
    .from("print_files")
    .select("storage_path, sha256, size_bytes")
    .eq("id", cmd.print_file_id)
    .eq("organization_id", agent.organization_id)
    .maybeSingle();
  if (!file) return null;
  const expiresIn = 10 * 60;
  const { data: signed, error } = await admin.storage.from("print-files").createSignedUrl(file.storage_path, expiresIn);
  if (error || !signed) {
    console.error("[agent] could not sign print file URL", error);
    return null;
  }
  return {
    url: signed.signedUrl,
    sha256: file.sha256,
    sizeBytes: file.size_bytes,
    fileName: (cmd.payload as StartPrintPayload).fileName,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export type { Settings };
