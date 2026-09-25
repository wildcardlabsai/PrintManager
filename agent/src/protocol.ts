/**
 * Wire protocol between the PrintFlow server and the PrintFlow Printer Agent.
 *
 * Shared by both sides: the agent imports it directly and the Next.js app
 * imports it from `agent/src/protocol`. Types only (plus a few constants),
 * no runtime dependencies.
 *
 * The agent always initiates: it POSTs a heartbeat carrying telemetry and
 * receives its printer configuration and any queued commands in the reply.
 * The server never opens a connection to the agent, and the only commands it
 * can issue are the members of AgentCommandType.
 */

export const AGENT_PROTOCOL_VERSION = 1;

export type PrinterModelKey = "AD5X" | "ADVENTURER_5M";
export type AgentDriver = "flashforge_lan" | "mock";

/** Error codes shared by adapters, the agent and the server. */
export type AgentErrorCode =
  | "NOT_SUPPORTED"
  | "NOT_CONFIGURED"
  | "MISSING_CHECK_CODE"
  | "AUTH_FAILED"
  | "UNREACHABLE"
  | "TIMEOUT"
  | "BUSY"
  | "INVALID_STATE"
  | "JOB_MISMATCH"
  | "FILE_NOT_FOUND"
  | "CHECKSUM_MISMATCH"
  | "DOWNLOAD_FAILED"
  | "LIBRARY_UNAVAILABLE"
  | "ERROR";

// ---------------------------------------------------------------------------
// Telemetry — a normalised subset of Flashforge's fnet_dev_detail_t.
// Every field is null when the printer did not provide it. Nothing is guessed.
// ---------------------------------------------------------------------------

export interface MaterialSlot {
  slotId: number;
  hasFilament: boolean;
  material: string | null;
  colour: string | null;
}

export interface MaterialStation {
  slotCount: number;
  currentSlot: number | null;
  currentLoadSlot: number | null;
  /** 0 idle, 1 load, 2 unload, 3 cancel load/unload, 4 printing, 5 busy, 6 paused */
  stateAction: number | null;
  slots: MaterialSlot[];
}

export interface PrinterTelemetry {
  /** Raw printer state: "ready", "busy", "calibrate_doing", "error", "heating", "printing", "pausing", "pause", "canceling", "cancel", "completed" */
  status: string | null;
  name: string | null;
  pid: number | null;
  firmwareVersion: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  nozzleCount: number | null;
  nozzleModel: string | null;
  /** 1 enabled, 2 disabled, 0 unknown (as reported by the printer) */
  camera: number | null;
  cameraStreamUrl: string | null;
  jobId: string | null;
  printFileName: string | null;
  /** 0..1 */
  printProgress: number | null;
  printLayer: number | null;
  targetPrintLayer: number | null;
  /** seconds */
  printDuration: number | null;
  /** seconds, as reported by the printer */
  estimatedTime: number | null;
  nozzleTemp: number | null;
  nozzleTargetTemp: number | null;
  bedTemp: number | null;
  bedTargetTemp: number | null;
  chamberTemp: number | null;
  chamberTargetTemp: number | null;
  rightFilamentType: string | null;
  leftFilamentType: string | null;
  hasRightFilament: boolean | null;
  hasLeftFilament: boolean | null;
  /** Printer's own per-job filament estimate (unit as reported by the printer). */
  estimatedRightWeight: number | null;
  estimatedLeftWeight: number | null;
  hasMaterialStation: boolean | null;
  materialStation: MaterialStation | null;
  /** Direct-feed (non-IFS) filament on the AD5X. */
  directFeed: { material: string | null; colour: string | null; stateAction: number | null } | null;
  doorStatus: string | null;
  lightStatus: string | null;
  remainingDiskSpaceGb: number | null;
  cumulativePrintMinutes: number | null;
  cumulativeFilamentMm: number | null;
  errorCode: string | null;
}

export interface PrinterReport {
  printerId: string;
  reachable: boolean;
  /** Round-trip time of the status request, when it succeeded. */
  latencyMs: number | null;
  errorCode: AgentErrorCode | null;
  error: string | null;
  telemetry: PrinterTelemetry | null;
}

// ---------------------------------------------------------------------------
// Configuration the server sends to the agent
// ---------------------------------------------------------------------------

export interface AgentPrinterConfig {
  id: string;
  name: string;
  model: PrinterModelKey | null;
  modelLabel: string;
  serialNumber: string | null;
  ipAddress: string | null;
  lanPort: number | null;
}

// ---------------------------------------------------------------------------
// Commands (the complete whitelist)
// ---------------------------------------------------------------------------

export const AGENT_COMMAND_TYPES = ["start_print", "pause", "resume", "stop", "refresh", "test_connection", "clear_platform"] as const;
export type AgentCommandType = (typeof AGENT_COMMAND_TYPES)[number];

export interface MaterialMapping {
  /** 0-based filament index in the sliced file */
  toolId: number;
  /** IFS slot, 1-based */
  slotId: number;
  materialName: string;
  toolMaterialColor: string;
  slotMaterialColor: string;
}

export interface StartPrintPayload {
  printFileId: string;
  /** Name the file is stored under on the printer (unique per job). */
  fileName: string;
  sha256: string;
  sizeBytes: number;
  fileType: "gcode" | "gx" | "3mf";
  levelingBeforePrint: boolean;
  flowCalibration: boolean;
  firstLayerInspection: boolean;
  timeLapseVideo: boolean;
  useMaterialStation: boolean;
  materialMappings: MaterialMapping[];
}

export interface JobControlPayload {
  /** The printer-side job PrintFlow expects to control. The agent refuses if the printer is running something else. */
  expectedJobId: string | null;
  expectedFileName: string | null;
}

export type AgentCommand =
  | { id: string; printerId: string; type: "start_print"; payload: StartPrintPayload; expiresAt: string }
  | { id: string; printerId: string; type: "pause" | "resume" | "stop"; payload: JobControlPayload; expiresAt: string }
  | { id: string; printerId: string; type: "refresh" | "test_connection" | "clear_platform"; payload: Record<string, never>; expiresAt: string };

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** POST /api/agent/pair (no auth; the one-time code is the credential) */
export interface PairRequest {
  code: string;
  name?: string;
  version: string;
  platform: string;
  driver: AgentDriver;
}
export interface PairResponse {
  agentId: string;
  token: string;
  organizationName: string;
}

/** POST /api/agent/heartbeat (Authorization: Bearer <token>) */
export interface HeartbeatRequest {
  protocol: number;
  agent: { version: string; platform: string; driver: AgentDriver; libraryVersion: string | null };
  printers: PrinterReport[];
}
export interface HeartbeatResponse {
  printers: AgentPrinterConfig[];
  commands: AgentCommand[];
  pollIntervalMs: number;
  /** Present when the server rotated the token: store it and use it from the next request. */
  rotatedToken?: string;
}

/** GET /api/agent/commands/:id/file — a short-lived download link for a start_print command. */
export interface FileTicket {
  url: string;
  sha256: string;
  sizeBytes: number;
  fileName: string;
  expiresAt: string;
}

/** POST /api/agent/commands/:id/result */
export interface CommandResultRequest {
  status: "succeeded" | "failed";
  errorCode?: AgentErrorCode | null;
  error?: string | null;
  /** Fresh telemetry read right after the command, if available. */
  telemetry?: PrinterTelemetry | null;
  result?: Record<string, string | number | boolean | null>;
}

// ---------------------------------------------------------------------------
// Model capabilities — what PrintFlow can do with each model over Flashforge's
// official LAN interface. Shown in the UI and enforced by the adapters.
// ---------------------------------------------------------------------------

export type CapabilityKey =
  | "status"
  | "progress"
  | "temperatures"
  | "send_print"
  | "pause"
  | "resume"
  | "stop"
  | "material_station"
  | "camera"
  | "printer_queue"
  | "remote_colour_switch"
  | "actual_filament_usage"
  | "firmware_update";

export type CapabilitySupport = "supported" | "not_supported" | "printer_reported";

export interface Capability {
  key: CapabilityKey;
  label: string;
  support: CapabilitySupport;
  note?: string;
}

const COMMON: Capability[] = [
  { key: "status", label: "Live status", support: "supported" },
  { key: "progress", label: "Progress, layers and elapsed time", support: "supported" },
  { key: "temperatures", label: "Nozzle and bed temperatures", support: "supported" },
  { key: "send_print", label: "Send a sliced file and start printing", support: "supported" },
  { key: "pause", label: "Pause", support: "supported" },
  { key: "resume", label: "Resume", support: "supported" },
  { key: "stop", label: "Stop (cancel) a print", support: "supported" },
  {
    key: "printer_queue",
    label: "Printer-side job queue",
    support: "not_supported",
    note: "The LAN interface starts a file immediately; PrintFlow keeps the queue.",
  },
  {
    key: "remote_colour_switch",
    label: "Remote filament/colour switching",
    support: "not_supported",
    note: "Load and swap filament at the printer.",
  },
  {
    key: "actual_filament_usage",
    label: "Actual filament used per print",
    support: "not_supported",
    note: "The printer reports its own estimate only; record actual usage when reviewing the print.",
  },
  { key: "firmware_update", label: "Firmware updates", support: "not_supported", note: "PrintFlow only displays the version. Update on the printer." },
];

export const MODEL_CAPABILITIES: Record<PrinterModelKey, Capability[]> = {
  AD5X: [
    ...COMMON,
    {
      key: "material_station",
      label: "IFS multi-colour (4 slots)",
      support: "printer_reported",
      note: "Slot contents come from the printer. Each file chooses whether it uses the IFS.",
    },
    {
      key: "camera",
      label: "Camera",
      support: "printer_reported",
      note: "Shown only when the printer reports an enabled camera and a stream URL (local network only).",
    },
  ],
  ADVENTURER_5M: [
    ...COMMON,
    { key: "material_station", label: "Multi-colour", support: "not_supported", note: "Single extruder, single filament." },
    {
      key: "camera",
      label: "Camera",
      support: "printer_reported",
      note: "Optional accessory. Shown only when the printer reports an enabled camera and a stream URL.",
    },
  ],
};

export function detectModel(model: string | null | undefined): PrinterModelKey | null {
  const m = (model ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (m.includes("ad5x")) return "AD5X";
  if (m.includes("adventurer5m") && !m.includes("pro")) return "ADVENTURER_5M";
  if (m === "5m") return "ADVENTURER_5M";
  return null;
}

export const MODEL_LABELS: Record<PrinterModelKey, string> = { AD5X: "Flashforge AD5X", ADVENTURER_5M: "Flashforge Adventurer 5M" };
