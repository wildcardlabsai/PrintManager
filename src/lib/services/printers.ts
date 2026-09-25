import "server-only";
import type { PrinterConnectionInput, PrinterInput } from "@/lib/validation/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PrintFile, Printer, PrinterAgent, PrinterCommand, PrinterEvent, PrinterStatus, ProductionJob } from "@/types/db";
import { logAudit, recordStatusChange } from "./audit";
import { requirePermission, type AppContext } from "./context";
import { AppError, check, checkFound } from "./errors";
import { AGENT_COLUMNS } from "./printers/agents";

export type PrinterCurrentJob = Pick<
  ProductionJob,
  | "id"
  | "job_number"
  | "product_name"
  | "quantity"
  | "status"
  | "started_at"
  | "estimated_minutes"
  | "accumulated_minutes"
  | "last_resumed_at"
  | "order_id"
  | "progress"
  | "remaining_seconds"
  | "printer_elapsed_seconds"
  | "current_layer"
  | "total_layers"
  | "printer_status"
  | "external_printer_job_id"
  | "printer_file_name"
  | "needs_attention"
  | "attention_reason"
  | "print_file_id"
>;

export interface PrinterWithJob extends Printer {
  current_job: PrinterCurrentJob | null;
  queued_count: number;
  agent: Pick<PrinterAgent, "id" | "name" | "status" | "last_seen_at" | "driver" | "version"> | null;
}

const CURRENT_JOB_COLUMNS =
  "id, job_number, product_name, quantity, status, started_at, estimated_minutes, accumulated_minutes, last_resumed_at, order_id, printer_id, progress, remaining_seconds, printer_elapsed_seconds, current_layer, total_layers, printer_status, external_printer_job_id, printer_file_name, needs_attention, attention_reason, print_file_id";

export async function listPrinters(ctx: AppContext, opts: { includeArchived?: boolean } = {}): Promise<PrinterWithJob[]> {
  let q = ctx.supabase.from("printers").select("*").eq("organization_id", ctx.orgId).order("name");
  if (!opts.includeArchived) q = q.is("archived_at", null);
  const printers = check(await q) as Printer[];
  if (!printers.length) return [];

  const [jobsRes, agentsRes] = await Promise.all([
    ctx.supabase
      .from("production_jobs")
      .select(CURRENT_JOB_COLUMNS)
      .eq("organization_id", ctx.orgId)
      .in("status", ["printing", "paused", "queued", "sending", "sent"])
      .not("printer_id", "is", null),
    ctx.supabase.from("printer_agents").select("id, name, status, last_seen_at, driver, version").eq("organization_id", ctx.orgId),
  ]);
  const jobs = check(jobsRes) as unknown as (PrinterCurrentJob & { printer_id: string })[];
  const agents = check(agentsRes) as PrinterWithJob["agent"][];

  return printers.map((p) => {
    const mine = jobs.filter((j) => j.printer_id === p.id);
    const current =
      mine.find((j) => j.status === "printing") ??
      mine.find((j) => j.status === "paused") ??
      mine.find((j) => j.status === "sent") ??
      mine.find((j) => j.status === "sending") ??
      null;
    return {
      ...p,
      current_job: current,
      queued_count: mine.filter((j) => j.status === "queued").length,
      agent: agents.find((a) => a!.id === p.agent_id) ?? null,
    };
  });
}

export async function createPrinter(ctx: AppContext, input: PrinterInput) {
  const printer = check(
    await ctx.supabase.from("printers").insert({ ...input, organization_id: ctx.orgId }).select("*").single(),
  ) as Printer;
  await logAudit(ctx, "printer.created", { type: "printer", id: printer.id }, `Printer ${printer.name} added`);
  return printer;
}

export async function updatePrinter(ctx: AppContext, id: string, input: PrinterInput) {
  const before = checkFound(
    await ctx.supabase.from("printers").select("*").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle(),
    "Printer",
  ) as Printer;
  // Connected printers take their status from telemetry.
  // Connection details (IP etc.) are edited in the connection settings.
  input = { ...input, ip_address: before.ip_address };
  if (before.connection_mode === "agent_lan") input = { ...input, status: before.status };
  const statusChanged = before.status !== input.status;
  const printer = check(
    await ctx.supabase
      .from("printers")
      .update({
        ...input,
        ...(statusChanged ? { status_source: "manual", status_updated_at: new Date().toISOString() } : {}),
      })
      .eq("id", id)
      .select("*")
      .single(),
  ) as Printer;
  if (statusChanged) await recordStatusChange(ctx, "printer", id, before.status, input.status);
  await logAudit(ctx, "printer.updated", { type: "printer", id }, `Printer ${printer.name} updated`, {
    status: statusChanged ? { from: before.status, to: input.status } : undefined,
  });
  return printer;
}

export async function setPrinterStatusManual(ctx: AppContext, id: string, status: PrinterStatus) {
  const before = checkFound(
    await ctx.supabase.from("printers").select("id, name, status, connection_mode").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle(),
    "Printer",
  ) as Pick<Printer, "id" | "name" | "status" | "connection_mode">;
  if (before.connection_mode === "agent_lan") {
    throw new AppError(`${before.name}'s status comes from the printer and can't be set by hand.`, "validation");
  }
  if (before.status === status) return;
  check(
    await ctx.supabase
      .from("printers")
      .update({ status, status_source: "manual", status_updated_at: new Date().toISOString() })
      .eq("id", id),
  );
  await recordStatusChange(ctx, "printer", id, before.status, status);
  await logAudit(ctx, "printer.status_changed", { type: "printer", id }, `${before.name}: ${before.status} → ${status}`, {
    from: before.status,
    to: status,
    source: "manual",
  });
}

export async function setPrinterArchived(ctx: AppContext, id: string, archived: boolean) {
  const printer = checkFound(
    await ctx.supabase
      .from("printers")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("organization_id", ctx.orgId)
      .select("id, name")
      .maybeSingle(),
    "Printer",
  ) as Pick<Printer, "id" | "name">;
  await logAudit(ctx, "printer.updated", { type: "printer", id }, `Printer ${printer.name} ${archived ? "archived" : "restored"}`);
}

// ---------------------------------------------------------------------------
// Phase 3: connection settings and detail
// ---------------------------------------------------------------------------

/**
 * Connection settings (admins only). Changing what identifies the printer —
 * agent, serial number, address — resets its live verification: PrintFlow
 * must prove again that it is talking to the right machine.
 */
export async function configurePrinterConnection(ctx: AppContext, id: string, input: PrinterConnectionInput) {
  requirePermission(ctx, "configure_printers");
  const before = checkFound(
    await ctx.supabase.from("printers").select("*").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle(),
    "Printer",
  ) as Printer;
  const admin = createAdminClient();
  if (input.agent_id) {
    const { data: agent } = await admin.from("printer_agents").select("id, organization_id, status").eq("id", input.agent_id).maybeSingle();
    if (!agent || agent.organization_id !== ctx.orgId) throw new AppError("That Printer Agent was not found.", "validation", { agent_id: "Not found" });
    if (agent.status === "revoked") throw new AppError("That Printer Agent has been revoked.", "validation", { agent_id: "Revoked" });
  }
  if (input.connection_mode === "agent_lan") {
    if (!input.agent_id) throw new AppError("Choose the Printer Agent that can reach this printer.", "validation", { agent_id: "Required" });
    if (!input.serial_number) throw new AppError("Enter the printer's serial number.", "validation", { serial_number: "Required" });
  }
  const identityChanged =
    before.connection_mode !== input.connection_mode ||
    before.agent_id !== input.agent_id ||
    before.serial_number !== input.serial_number ||
    before.ip_address !== input.ip_address ||
    before.lan_port !== input.lan_port;
  const patch: Partial<Printer> = {
    connection_mode: input.connection_mode,
    agent_id: input.connection_mode === "agent_lan" ? input.agent_id : null,
    serial_number: input.serial_number,
    ip_address: input.ip_address,
    lan_port: input.lan_port,
    multi_colour: input.multi_colour,
    colour_channels: input.colour_channels,
    camera: input.camera,
  };
  if (identityChanged) {
    Object.assign(patch, {
      connection_state: input.connection_mode === "agent_lan" ? "waiting" : "not_configured",
      consecutive_failures: 0,
      telemetry: null,
      telemetry_at: null,
      telemetry_source: null,
      raw_status: null,
      last_seen_at: null,
      last_heartbeat_at: null,
      last_error: null,
      current_external_job_id: null,
      current_job_id: null,
      live_checklist: {},
      live_verified_at: null,
      live_verified_by: null,
      status: input.connection_mode === "agent_lan" ? "unknown" : before.status === "unknown" ? "idle" : before.status,
      status_source: input.connection_mode === "agent_lan" ? "integration" : "manual",
      status_updated_at: new Date().toISOString(),
    } satisfies Partial<Printer>);
  }
  const { error } = await admin.from("printers").update(patch).eq("id", id).eq("organization_id", ctx.orgId);
  if (error?.code === "23505") throw new AppError("Another printer already uses that serial number.", "conflict", { serial_number: "Already used" });
  if (error) throw new AppError("Could not save the connection settings.");
  await logAudit(ctx, "printer.connection_configured", { type: "printer", id }, `${before.name}: connection ${input.connection_mode === "agent_lan" ? "set to Printer Agent (LAN)" : "set to manual"}`, {
    connection_mode: input.connection_mode,
    agent_id: patch.agent_id,
    serial_number: input.serial_number,
    ip_address: input.ip_address,
    lan_port: input.lan_port,
    verification_reset: identityChanged,
  });
}

export interface PrinterDetail {
  printer: PrinterWithJob;
  events: PrinterEvent[];
  commands: PrinterCommand[];
  agents: Pick<PrinterAgent, "id" | "name" | "status">[];
  agent: PrinterAgent | null;
  testFiles: Pick<PrintFile, "id" | "name" | "compatible_models" | "verified_at" | "multi_colour" | "ifs_required">[];
}

export async function getPrinterDetail(ctx: AppContext, id: string): Promise<PrinterDetail> {
  const printers = await listPrinters(ctx, { includeArchived: true });
  const printer = printers.find((p) => p.id === id);
  if (!printer) throw new AppError("Printer not found.", "not_found");
  const [events, commands, agents, files] = await Promise.all([
    ctx.supabase.from("printer_events").select("*").eq("printer_id", id).order("created_at", { ascending: false }).limit(50),
    ctx.supabase.from("printer_commands").select("*").eq("printer_id", id).order("created_at", { ascending: false }).limit(20),
    ctx.supabase.from("printer_agents").select(AGENT_COLUMNS).eq("organization_id", ctx.orgId).order("created_at"),
    ctx.supabase
      .from("print_files")
      .select("id, name, compatible_models, verified_at, multi_colour, ifs_required")
      .eq("organization_id", ctx.orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const agentRows = check(agents) as unknown as PrinterAgent[];
  return {
    printer,
    events: check(events) as PrinterEvent[],
    commands: check(commands) as PrinterCommand[],
    agents: agentRows.map((a) => ({ id: a.id, name: a.name, status: a.status })),
    agent: agentRows.find((a) => a.id === printer.agent_id) ?? null,
    testFiles: check(files) as PrinterDetail["testFiles"],
  };
}
