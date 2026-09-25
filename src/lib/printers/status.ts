import type { BadgeTone } from "@/components/ui/badge";
import type { JobStatus, Printer, PrinterStatus, ProductionJob } from "@/types/db";

/**
 * Printer state as Flashforge's LAN interface reports it, and how PrintFlow
 * presents it. Only the states the printer actually reports are used.
 */
export const FLASHFORGE_STATES = [
  "ready",
  "busy",
  "calibrate_doing",
  "error",
  "heating",
  "printing",
  "pausing",
  "pause",
  "canceling",
  "cancel",
  "completed",
] as const;

export type RawPhase = "idle" | "preparing" | "printing" | "paused" | "stopping" | "completed" | "error" | "unknown";

export function rawPhase(raw: string | null | undefined): RawPhase {
  switch (raw) {
    case "ready":
      return "idle";
    case "busy":
    case "calibrate_doing":
    case "heating":
      return "preparing";
    case "printing":
      return "printing";
    case "pausing":
    case "pause":
      return "paused";
    case "canceling":
    case "cancel":
      return "stopping";
    case "completed":
      return "completed";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

/** Printer status column value for a raw Flashforge state. */
export function mapFlashforgeStatus(raw: string | null | undefined, hasJob = false): PrinterStatus {
  switch (rawPhase(raw)) {
    case "idle":
    case "completed":
      return "idle";
    case "preparing":
      return hasJob ? "printing" : "online";
    case "printing":
      return "printing";
    case "paused":
      return "paused";
    case "stopping":
      return "online";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

const RAW_LABELS: Record<string, string> = {
  ready: "Ready",
  busy: "Busy",
  calibrate_doing: "Calibrating",
  error: "Error",
  heating: "Heating",
  printing: "Printing",
  pausing: "Pausing",
  pause: "Paused",
  canceling: "Stopping",
  cancel: "Stopped",
  completed: "Print complete — clear the plate",
};

export function rawStatusLabel(raw: string | null | undefined) {
  if (!raw) return "Not available";
  return RAW_LABELS[raw] ?? raw;
}

// ---------------------------------------------------------------------------
// Connection freshness
// ---------------------------------------------------------------------------

export interface ConnectionView {
  key: "manual" | "not_configured" | "waiting" | "live" | "stale" | "offline" | "auth_failed" | "unreachable" | "error";
  label: string;
  tone: BadgeTone;
  detail: string;
  /** True when the telemetry shown is current enough to act on. */
  live: boolean;
}

type ConnPrinter = Pick<
  Printer,
  "connection_mode" | "connection_state" | "agent_id" | "serial_number" | "last_seen_at" | "last_heartbeat_at" | "last_error" | "telemetry_source"
>;

export function secondsSince(iso: string | null | undefined, now: Date) {
  if (!iso) return Infinity;
  return (now.getTime() - new Date(iso).getTime()) / 1000;
}

export function connectionView(p: ConnPrinter, now: Date, offlineAfterSeconds: number): ConnectionView {
  if (p.connection_mode === "manual") {
    return { key: "manual", label: "Manual", tone: "outline", detail: "Status is set by hand; no live connection.", live: false };
  }
  if (!p.agent_id || !p.serial_number) {
    return {
      key: "not_configured",
      label: "Not configured",
      tone: "amber",
      detail: !p.agent_id ? "Choose the Printer Agent that can reach this printer." : "Add the printer's serial number.",
      live: false,
    };
  }
  const heartbeatAge = secondsSince(p.last_heartbeat_at, now);
  const seenAge = secondsSince(p.last_seen_at, now);
  if (!p.last_heartbeat_at && !p.last_seen_at) {
    return { key: "waiting", label: "Waiting for agent", tone: "amber", detail: "The Printer Agent hasn't reported this printer yet.", live: false };
  }
  if (heartbeatAge > offlineAfterSeconds) {
    return { key: "offline", label: "Agent offline", tone: "neutral", detail: "The Printer Agent has stopped reporting.", live: false };
  }
  switch (p.connection_state) {
    case "auth_failed":
      return { key: "auth_failed", label: "Check code rejected", tone: "red", detail: p.last_error ?? "The printer rejected the serial number or check code.", live: false };
    case "not_configured":
      return { key: "not_configured", label: "Setup needed", tone: "amber", detail: p.last_error ?? "The agent can't reach this printer yet.", live: false };
    case "offline":
      return { key: "offline", label: "Offline", tone: "neutral", detail: p.last_error ?? "The printer isn't answering on the local network.", live: false };
    case "unreachable":
      return {
        key: "unreachable",
        label: "Not responding",
        tone: "amber",
        detail: `${p.last_error ?? "The last status requests failed."} PrintFlow will mark it offline if this continues.`,
        live: false,
      };
    case "error":
      return { key: "error", label: "Connection error", tone: "red", detail: p.last_error ?? "The agent reported an error.", live: false };
  }
  if (seenAge > offlineAfterSeconds) {
    return { key: "stale", label: "No recent status", tone: "amber", detail: "The last successful status is older than the offline threshold.", live: false };
  }
  return {
    key: "live",
    label: p.telemetry_source === "mock" ? "Live (simulated)" : "Live",
    tone: p.telemetry_source === "mock" ? "cyan" : "green",
    detail: p.telemetry_source === "mock" ? "Status comes from a simulated printer (mock agent)." : "Status comes from the printer.",
    live: true,
  };
}

/** The status to display: connected printers go "offline" once their data is stale. */
export function effectivePrinterStatus(p: ConnPrinter & Pick<Printer, "status">, now: Date, offlineAfterSeconds: number): PrinterStatus {
  if (p.connection_mode === "manual") return p.status;
  const view = connectionView(p, now, offlineAfterSeconds);
  if (view.live) return p.status;
  if (view.key === "offline" || view.key === "stale") return "offline";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Job stages (the production pipeline as users see it)
// ---------------------------------------------------------------------------

export type JobStage =
  | "AWAITING_PRINT"
  | "ASSIGNED"
  | "READY"
  | "SENDING"
  | "QUEUED"
  | "PRINTING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export const JOB_STAGE_META: Record<JobStage, { label: string; tone: BadgeTone; help: string }> = {
  AWAITING_PRINT: { label: "Awaiting print", tone: "amber", help: "No printer assigned yet." },
  ASSIGNED: { label: "Assigned", tone: "blue", help: "Printer assigned; choose a print file to send it." },
  READY: { label: "Ready to send", tone: "blue", help: "Printer and print file chosen." },
  SENDING: { label: "Sending", tone: "cyan", help: "Waiting for the Printer Agent to upload the file." },
  QUEUED: { label: "Queued on printer", tone: "cyan", help: "The printer has the file and is preparing (heating/levelling)." },
  PRINTING: { label: "Printing", tone: "violet", help: "The printer is printing." },
  PAUSED: { label: "Paused", tone: "slate", help: "Paused on the printer." },
  COMPLETED: { label: "Completed", tone: "green", help: "Printed." },
  FAILED: { label: "Failed", tone: "red", help: "The print failed or was stopped." },
  CANCELLED: { label: "Cancelled", tone: "outline", help: "Cancelled." },
};

export function jobStage(job: Pick<ProductionJob, "status" | "printer_id" | "print_file_id">): JobStage {
  const map: Partial<Record<JobStatus, JobStage>> = {
    sending: "SENDING",
    sent: "QUEUED",
    printing: "PRINTING",
    paused: "PAUSED",
    printed: "COMPLETED",
    failed: "FAILED",
    cancelled: "CANCELLED",
  };
  if (job.status !== "queued") return map[job.status]!;
  if (!job.printer_id) return "AWAITING_PRINT";
  return job.print_file_id ? "READY" : "ASSIGNED";
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Remaining print time derived from the printer's own progress and elapsed
 * time. Null until there's enough progress for the estimate to mean anything.
 */
export function estimateRemainingSeconds(fraction: number | null | undefined, elapsedSeconds: number | null | undefined): number | null {
  if (fraction == null || elapsedSeconds == null) return null;
  if (fraction >= 1) return 0;
  if (fraction < 0.02 || elapsedSeconds <= 0) return null;
  return Math.max(0, Math.round((elapsedSeconds * (1 - fraction)) / fraction));
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "Not available";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Comparable key for a file name as it may appear on the printer (path and extension stripped). */
export function fileKey(name: string | null | undefined) {
  if (!name) return null;
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.(gcode|gx|3mf|g)$/i, "").replace(/\.gcode$/i, "").toLowerCase();
}
