import { detectModel, MODEL_LABELS, type MaterialMapping, type PrinterModelKey, type PrinterTelemetry } from "../../../agent/src/protocol";
import type { Order, PrintFile, Printer, ProductionJob } from "@/types/db";
import { connectionView, rawStatusLabel } from "./status";

/**
 * Pre-flight checks before PrintFlow tells a printer to start a file.
 * Blockers stop the send. Warnings need a person to read them and confirm,
 * and any warning at all rules out automatic dispatch.
 */

export interface DispatchCheck {
  blockers: string[];
  warnings: string[];
}

export type DispatchPrinter = Pick<
  Printer,
  | "id"
  | "name"
  | "model"
  | "connection_mode"
  | "connection_state"
  | "agent_id"
  | "serial_number"
  | "last_seen_at"
  | "last_heartbeat_at"
  | "last_error"
  | "telemetry_source"
  | "telemetry"
  | "raw_status"
  | "live_verified_at"
  | "bed_clear"
  | "archived_at"
  | "firmware_version"
  | "live_checklist"
>;

export type DispatchFile = Pick<
  PrintFile,
  "id" | "name" | "compatible_models" | "multi_colour" | "ifs_required" | "colour_channels" | "material" | "colour" | "verified_at" | "archived_at" | "filament_assignments"
>;

export interface DispatchInput {
  printer: DispatchPrinter;
  agentActive: boolean;
  job: Pick<ProductionJob, "status" | "colour" | "material"> | null;
  order: Pick<Order, "status" | "payment_status"> | null;
  file: DispatchFile | null;
  printerBusy: boolean;
  materialMappings: MaterialMapping[];
  /** Test prints from the live checklist may run before the printer is verified. */
  testPrint?: boolean;
  now: Date;
  offlineAfterSeconds: number;
}

export function normaliseColour(c: string | null | undefined) {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  if (/^#?[0-9a-f]{6}([0-9a-f]{2})?$/.test(s)) return `#${s.replace("#", "").slice(0, 6)}`;
  return s;
}

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

/** What filament the printer reports for a single-colour (non-IFS) print. */
export function loadedFilament(t: PrinterTelemetry | null): { material: string | null; colour: string | null } {
  if (!t) return { material: null, colour: null };
  return {
    material: t.directFeed?.material ?? t.rightFilamentType ?? null,
    colour: t.directFeed?.colour ?? null,
  };
}

export function fileSupportsModel(file: Pick<PrintFile, "compatible_models">, model: PrinterModelKey | null) {
  if (!model) return false;
  return file.compatible_models.some((m) => detectModel(m) === model);
}

export function checkDispatch(input: DispatchInput): DispatchCheck {
  const { printer, file, job, order, now } = input;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const model = detectModel(printer.model);

  if (printer.archived_at) blockers.push("This printer is archived.");
  if (printer.connection_mode !== "agent_lan") {
    blockers.push(`${printer.name} isn't connected to PrintFlow. Start the print at the printer and record it manually.`);
    return { blockers, warnings };
  }
  if (!model) blockers.push(`PrintFlow can only send files to a Flashforge AD5X or Adventurer 5M (this printer's model is "${printer.model}").`);
  if (!printer.agent_id || !input.agentActive) blockers.push("No active Printer Agent is assigned to this printer.");
  if (!input.testPrint && !printer.live_verified_at) {
    blockers.push("Finish this printer's live test checklist (including a supervised test print) before sending production jobs.");
  }

  const conn = connectionView(printer, now, input.offlineAfterSeconds);
  if (!conn.live) blockers.push(`${printer.name}: ${conn.label.toLowerCase()} — ${conn.detail}`);
  else if (printer.raw_status !== "ready") {
    blockers.push(
      printer.raw_status === "completed"
        ? `${printer.name} is showing a finished print. Remove it and confirm the plate is clear.`
        : `${printer.name} is ${rawStatusLabel(printer.raw_status).toLowerCase()}, not ready.`,
    );
  }
  if (!printer.bed_clear) blockers.push(`Confirm the build plate on ${printer.name} is clear before starting another print.`);
  if (input.printerBusy) blockers.push(`${printer.name} already has a print being sent or in progress.`);

  if (job) {
    if (job.status !== "queued") blockers.push("Only jobs that are awaiting print can be sent.");
  }
  if (order) {
    if (order.status === "on_hold") blockers.push("The order is on hold.");
    if (order.status === "cancelled") blockers.push("The order is cancelled.");
  }

  if (!file) {
    blockers.push("Choose a sliced print file for this printer.");
    return { blockers, warnings };
  }
  if (file.archived_at) blockers.push("That print file is archived.");
  if (model && !fileSupportsModel(file, model)) {
    blockers.push(`"${file.name}" isn't marked as sliced for the ${MODEL_LABELS[model]}. Slice it for this printer (or update the file's compatible printers).`);
  }

  const t = printer.telemetry;
  if (file.multi_colour || file.ifs_required) {
    if (model === "ADVENTURER_5M") blockers.push("The Adventurer 5M can't print multi-colour files.");
    if (file.ifs_required) {
      if (t && t.hasMaterialStation === false) blockers.push("The printer doesn't report an IFS material station.");
      blockers.push(...checkMappings(file, input.materialMappings, t));
    }
  }

  // Filament: compare with what the printer reports, never assume.
  if (!file.ifs_required) {
    const loaded = loadedFilament(t);
    if (file.material && loaded.material && !sameText(file.material, loaded.material)) {
      warnings.push(`The file expects ${file.material} but the printer reports ${loaded.material} loaded.`);
    }
    if (file.material && !loaded.material) warnings.push("The printer didn't report which filament is loaded.");
    if (file.colour && loaded.colour && normaliseColour(file.colour) !== normaliseColour(loaded.colour)) {
      warnings.push(`The file's colour (${file.colour}) differs from the loaded filament (${loaded.colour}).`);
    }
  }
  if (job?.colour && file.colour && !file.multi_colour && normaliseColour(job.colour) !== normaliseColour(file.colour)) {
    warnings.push(`The job is for ${job.colour} but the file is set up for ${file.colour}.`);
  }
  if (job?.material && file.material && !sameText(job.material, file.material)) {
    warnings.push(`The job is for ${job.material} but the file is set up for ${file.material}.`);
  }
  if (!file.verified_at) warnings.push("This file hasn't been printed successfully in PrintFlow yet.");
  warnings.push(...firmwareWarnings(printer));
  if (printer.telemetry_source === "mock") warnings.push("This printer is simulated by a mock agent: nothing will physically print.");
  return { blockers, warnings };
}

function checkMappings(file: DispatchFile, mappings: MaterialMapping[], t: PrinterTelemetry | null): string[] {
  const out: string[] = [];
  const channels = Math.max(1, file.colour_channels);
  if (mappings.length !== channels) {
    out.push(`Map all ${channels} colours in the file to IFS slots.`);
    return out;
  }
  const slots = t?.materialStation?.slots ?? [];
  const tools = new Set<number>();
  for (const m of mappings) {
    if (m.toolId < 0 || m.toolId >= channels || tools.has(m.toolId)) {
      out.push("Each file colour must be mapped exactly once.");
      break;
    }
    tools.add(m.toolId);
    const slot = slots.find((s) => s.slotId === m.slotId);
    if (!slot) out.push(`IFS slot ${m.slotId} isn't reported by the printer.`);
    else if (!slot.hasFilament) out.push(`IFS slot ${m.slotId} is empty.`);
  }
  return out;
}

/**
 * Suggest an IFS mapping from colours/materials only when every channel has
 * an unambiguous match. Otherwise the person maps them.
 */
export function suggestMappings(file: Pick<PrintFile, "filament_assignments" | "colour_channels">, t: PrinterTelemetry | null): MaterialMapping[] | null {
  const slots = (t?.materialStation?.slots ?? []).filter((s) => s.hasFilament);
  const channels = Math.max(1, file.colour_channels);
  const out: MaterialMapping[] = [];
  for (let tool = 0; tool < channels; tool++) {
    const a = file.filament_assignments.find((x) => x.channel === tool + 1);
    if (!a?.colour) return null;
    const matches = slots.filter(
      (s) => normaliseColour(s.colour) === normaliseColour(a.colour) && (!a.material || !s.material || sameText(a.material, s.material)),
    );
    if (matches.length !== 1) return null;
    const s = matches[0];
    out.push({ toolId: tool, slotId: s.slotId, materialName: a.material ?? s.material ?? "", toolMaterialColor: a.colour, slotMaterialColor: s.colour ?? a.colour });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Automatic print queue
// ---------------------------------------------------------------------------

export interface AutoDispatchInput extends DispatchInput {
  autoPrintEnabled: boolean;
  jobAssignedPrinterId: string | null;
  attempts: number;
  needsAttention: boolean;
}

/**
 * Automatic dispatch is deliberately narrow: every check must pass with no
 * warnings, on a verified printer, a proven single-colour file, a job a person
 * assigned to this printer, for a paid order, on the first attempt.
 */
export function autoDispatchEligibility(input: AutoDispatchInput): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.autoPrintEnabled) reasons.push("Automatic print queue is off.");
  const check = checkDispatch(input);
  reasons.push(...check.blockers, ...check.warnings);
  if (input.jobAssignedPrinterId !== input.printer.id) reasons.push("The job must be assigned to this printer by a person.");
  if (input.file && !input.file.verified_at) reasons.push("Only proven print files are sent automatically.");
  if (input.file && (input.file.multi_colour || input.file.ifs_required)) reasons.push("Multi-colour prints are always started by a person.");
  if (input.order && input.order.payment_status !== "paid") reasons.push("The order isn't marked paid.");
  if (input.attempts > 1) reasons.push("Retries are always started by a person.");
  if (input.needsAttention) reasons.push("The job needs attention.");
  if (input.printer.telemetry_source !== "flashforge_lan") reasons.push("Only live printers are used automatically.");
  const loaded = loadedFilament(input.printer.telemetry);
  if (input.file?.material && !sameText(input.file.material, loaded.material)) reasons.push("Loaded filament must match the file.");
  if (input.file?.colour && normaliseColour(input.file.colour) !== normaliseColour(loaded.colour)) {
    reasons.push("Loaded filament colour must match the file.");
  }
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/**
 * Flashforge publishes no minimum-firmware list PrintFlow could check against,
 * so compatibility is established by the live checklist. Warn when that no
 * longer holds: the version is unknown, or it changed after verification.
 */
export function firmwareWarnings(printer: Pick<Printer, "firmware_version" | "live_checklist" | "live_verified_at">): string[] {
  if (!printer.firmware_version) return ["The printer hasn't reported its firmware version, so PrintFlow can't confirm it supports LAN printing."];
  const verifiedOn = printer.live_checklist?.firmware?.note;
  if (printer.live_verified_at && verifiedOn && verifiedOn !== printer.firmware_version) {
    return [`Firmware changed from ${verifiedOn} (when this printer was verified) to ${printer.firmware_version}. Re-run the live test checklist if anything behaves differently.`];
  }
  return [];
}
