import type { PrinterReport, PrinterTelemetry } from "../../../agent/src/protocol";
import type { AttentionCode, Printer, PrinterEventType, PrinterStatus, ProductionJob } from "@/types/db";
import { estimateRemainingSeconds, fileKey, mapFlashforgeStatus, rawPhase, rawStatusLabel, secondsSince, type RawPhase } from "./status";

/**
 * Pure rules that turn an agent's report into printer and job changes.
 * The service layer applies the returned patches; nothing here touches the DB.
 */

/** Failed status requests in a row before a printer can be marked offline (with the time threshold). */
export const OFFLINE_AFTER_FAILURES = 3;

export interface PrinterEventDraft {
  type: PrinterEventType;
  from: string | null;
  to: string | null;
  message: string;
  data?: Record<string, unknown>;
}

type PrevPrinter = Pick<
  Printer,
  "status" | "connection_state" | "consecutive_failures" | "last_seen_at" | "firmware_version" | "raw_status" | "current_external_job_id"
>;

export interface PrinterUpdate {
  patch: Partial<Printer>;
  events: PrinterEventDraft[];
  wentOffline: boolean;
  cameBack: boolean;
}

export function evaluatePrinterReport(prev: PrevPrinter, report: PrinterReport, now: Date, offlineAfterSeconds: number): PrinterUpdate {
  const nowIso = now.toISOString();
  const events: PrinterEventDraft[] = [];

  if (report.reachable && report.telemetry) {
    const t = report.telemetry;
    const status = mapFlashforgeStatus(t.status, Boolean(t.jobId));
    const patch: Partial<Printer> = {
      status,
      status_source: "integration",
      connection_state: "connected",
      consecutive_failures: 0,
      last_seen_at: nowIso,
      latency_ms: report.latencyMs,
      telemetry: t,
      telemetry_at: nowIso,
      raw_status: t.status,
      current_external_job_id: t.jobId,
      last_error: null,
    };
    if (t.firmwareVersion) patch.firmware_version = t.firmwareVersion;
    if (status !== prev.status) patch.status_updated_at = nowIso;
    // A new print occupies the plate until someone confirms it's clear again.
    const cameBack = prev.connection_state !== "connected";
    if (cameBack) events.push({ type: "connected", from: prev.connection_state, to: "connected", message: "Printer connected" });
    if (status !== prev.status) {
      events.push({ type: "status_changed", from: prev.status, to: status, message: `${rawStatusLabel(prev.raw_status)} → ${rawStatusLabel(t.status)}` });
    }
    if (prev.firmware_version && t.firmwareVersion && prev.firmware_version !== t.firmwareVersion) {
      events.push({
        type: "firmware_changed",
        from: prev.firmware_version,
        to: t.firmwareVersion,
        message: `Firmware changed from ${prev.firmware_version} to ${t.firmwareVersion}. Re-check printing before relying on automation.`,
      });
    }
    events.push(...phaseEvents(rawPhase(prev.raw_status), rawPhase(t.status), t, prev.raw_status));
    return { patch, events, wentOffline: false, cameBack };
  }

  const failures = prev.consecutive_failures + 1;
  const patch: Partial<Printer> = {
    consecutive_failures: failures,
    last_error: report.error ?? "No response",
    last_error_at: nowIso,
    latency_ms: null,
  };
  let wentOffline = false;
  switch (report.errorCode) {
    case "AUTH_FAILED":
      patch.connection_state = "auth_failed";
      patch.status = "unknown";
      if (prev.connection_state !== "auth_failed") {
        events.push({ type: "error", from: prev.connection_state, to: "auth_failed", message: report.error ?? "Check code rejected" });
      }
      break;
    case "MISSING_CHECK_CODE":
    case "NOT_CONFIGURED":
    case "NOT_SUPPORTED":
    case "LIBRARY_UNAVAILABLE":
      patch.connection_state = "not_configured";
      patch.status = "unknown";
      break;
    default: {
      // Don't declare a printer offline on one failed request: wait for
      // several failures AND the configured time without a good status.
      const silentFor = secondsSince(prev.last_seen_at, now);
      if (failures >= OFFLINE_AFTER_FAILURES && silentFor > offlineAfterSeconds) {
        patch.connection_state = "offline";
        patch.status = "offline";
        if (prev.connection_state !== "offline") {
          wentOffline = true;
          events.push({ type: "disconnected", from: prev.connection_state, to: "offline", message: report.error ?? "Printer stopped responding" });
        }
      } else if (prev.connection_state !== "offline") {
        patch.connection_state = "unreachable";
      }
    }
  }
  if (patch.status && patch.status !== prev.status) patch.status_updated_at = nowIso;
  return { patch, events, wentOffline, cameBack: false };
}

function phaseEvents(from: RawPhase, to: RawPhase, t: PrinterTelemetry, prevRaw: string | null): PrinterEventDraft[] {
  if (from === to) return [];
  const data = { jobId: t.jobId, file: t.printFileName };
  const file = t.printFileName ?? "a file";
  switch (to) {
    case "printing":
      return from === "paused"
        ? [{ type: "print_resumed", from: prevRaw, to: t.status, message: `Resumed ${file}`, data }]
        : [{ type: "print_started", from: prevRaw, to: t.status, message: `Printing ${file}`, data }];
    case "paused":
      return [{ type: "print_paused", from: prevRaw, to: t.status, message: `Paused ${file}`, data }];
    case "stopping":
      return [{ type: "print_stopped", from: prevRaw, to: t.status, message: `Stopped ${file}`, data }];
    case "completed":
      return [{ type: "print_completed", from: prevRaw, to: t.status, message: `Finished ${file}`, data }];
    case "error":
      return [
        {
          type: from === "printing" || from === "paused" ? "print_failed" : "error",
          from: prevRaw,
          to: t.status,
          message: `Printer error${t.errorCode ? ` ${t.errorCode}` : ""}`,
          data: { ...data, errorCode: t.errorCode },
        },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Job reconciliation
// ---------------------------------------------------------------------------

export type JobTransition = "started" | "paused" | "resumed" | "completed" | "stopped_at_printer" | "not_started";

export interface JobUpdate {
  patch: Partial<ProductionJob>;
  transition: JobTransition | null;
  attention: { code: AttentionCode; reason: string } | null;
  clearAttention: boolean;
}

type JobSnap = Pick<
  ProductionJob,
  | "status"
  | "printer_file_name"
  | "external_printer_job_id"
  | "sent_at"
  | "started_at"
  | "accumulated_minutes"
  | "last_resumed_at"
  | "needs_attention"
  | "attention_code"
>;

const AUTO_CLEAR: AttentionCode[] = ["printer_offline", "printer_error"];

/** Is the printer running this job? Matched by the printer's job id, or by the unique file name PrintFlow sent. */
export function telemetryMatchesJob(job: Pick<ProductionJob, "external_printer_job_id" | "printer_file_name">, t: PrinterTelemetry) {
  if (t.jobId && job.external_printer_job_id) return t.jobId === job.external_printer_job_id;
  const a = fileKey(t.printFileName);
  const b = fileKey(job.printer_file_name);
  return Boolean(a && b && a === b);
}

export function reconcileJob(job: JobSnap, t: PrinterTelemetry, now: Date, commandTimeoutSeconds: number): JobUpdate {
  const nowIso = now.toISOString();
  const out: JobUpdate = { patch: {}, transition: null, attention: null, clearAttention: false };
  const phase = rawPhase(t.status);
  const matches = telemetryMatchesJob(job, t);

  if (matches) {
    const fraction = t.printProgress;
    Object.assign(out.patch, {
      printer_status: t.status,
      last_telemetry_at: nowIso,
      progress: fraction == null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 10000) / 100,
      current_layer: t.printLayer,
      total_layers: t.targetPrintLayer,
      printer_elapsed_seconds: t.printDuration == null ? null : Math.round(t.printDuration),
      remaining_seconds: estimateRemainingSeconds(fraction, t.printDuration),
    } satisfies Partial<ProductionJob>);
    if (t.jobId && t.jobId !== job.external_printer_job_id) out.patch.external_printer_job_id = t.jobId;
    if (job.needs_attention && job.attention_code && AUTO_CLEAR.includes(job.attention_code) && phase !== "error") {
      out.clearAttention = true;
    }
  }

  const running = job.status === "printing" || job.status === "paused";
  const waiting = job.status === "sent" || job.status === "sending";
  if (!running && !waiting) return out;

  if (matches) {
    switch (phase) {
      case "printing":
        if (waiting) {
          out.transition = "started";
          Object.assign(out.patch, { status: "printing", started_at: job.started_at ?? nowIso, last_resumed_at: nowIso });
        } else if (job.status === "paused") {
          out.transition = "resumed";
          Object.assign(out.patch, { status: "printing", last_resumed_at: nowIso });
        }
        break;
      case "paused":
        if (job.status !== "paused") {
          out.transition = "paused";
          Object.assign(out.patch, {
            status: "paused",
            started_at: job.started_at ?? nowIso,
            accumulated_minutes: accumulated(job, now),
            last_resumed_at: null,
          });
        }
        break;
      case "completed": {
        out.transition = "completed";
        const minutes = t.printDuration && t.printDuration > 0 ? Math.max(1, Math.round(t.printDuration / 60)) : accumulated(job, now);
        Object.assign(out.patch, {
          status: "printed",
          started_at: job.started_at ?? nowIso,
          completed_at: nowIso,
          actual_minutes: minutes,
          accumulated_minutes: minutes,
          last_resumed_at: null,
          progress: 100,
          remaining_seconds: 0,
          filament_recorded: false,
        });
        break;
      }
      case "stopping":
        out.transition = "stopped_at_printer";
        Object.assign(out.patch, {
          status: "failed",
          failed_at: nowIso,
          accumulated_minutes: accumulated(job, now),
          last_resumed_at: null,
          failure_reason: "Stopped on the printer",
          remaining_seconds: null,
        });
        out.attention = { code: "stopped_at_printer", reason: "The print was stopped on the printer. Retry, reassign or mark it failed." };
        break;
      case "error":
        if (job.attention_code !== "printer_error") {
          out.attention = {
            code: "printer_error",
            reason: `The printer reported an error${t.errorCode ? ` (${t.errorCode})` : ""}. Check it before continuing.`,
          };
        }
        break;
      default:
        // preparing: heating, levelling or busy — the job stays where it is.
        break;
    }
    return out;
  }

  // The printer is not running this job.
  if (waiting) {
    // Only judge once the command has had time to take effect.
    if (job.status === "sent" && secondsSince(job.sent_at, now) > commandTimeoutSeconds) {
      out.transition = "not_started";
      Object.assign(out.patch, { status: "failed", failed_at: nowIso, failure_reason: "The printer did not start this file", last_resumed_at: null });
      out.attention = {
        code: "not_started",
        reason:
          phase === "idle"
            ? "The printer accepted the file but did not start printing it."
            : `The printer is ${rawStatusLabel(t.status).toLowerCase()} with a different file.`,
      };
    }
    return out;
  }

  if (phase === "idle" || phase === "completed") {
    if (job.attention_code !== "missed_completion") {
      out.attention = {
        code: "missed_completion",
        reason: "The printer is no longer running this print and PrintFlow didn't see it finish. Check the plate, then mark it complete or failed.",
      };
    }
  } else if (phase !== "unknown" && job.attention_code !== "other_job") {
    out.attention = { code: "other_job", reason: "The printer is running a different file from this job." };
  }
  return out;
}

function accumulated(job: Pick<ProductionJob, "accumulated_minutes" | "last_resumed_at" | "status">, now: Date) {
  let minutes = job.accumulated_minutes ?? 0;
  if (job.status === "printing" && job.last_resumed_at) minutes += Math.max(0, (now.getTime() - new Date(job.last_resumed_at).getTime()) / 60000);
  return Math.round(minutes);
}

/** Has an agent gone quiet long enough that its printers count as offline? */
export function agentSilent(lastHeartbeatAt: string | null, now: Date, offlineAfterSeconds: number) {
  return secondsSince(lastHeartbeatAt, now) > offlineAfterSeconds;
}

export type { PrinterStatus };
