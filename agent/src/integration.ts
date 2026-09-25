import type {
  AgentErrorCode,
  Capability,
  MaterialMapping,
  PrinterModelKey,
  PrinterTelemetry,
} from "./protocol.js";

/**
 * The adapter contract every printer integration implements. Methods a model
 * or connection cannot do return NOT_SUPPORTED — never a fake success.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; code: AgentErrorCode; message: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(code: AgentErrorCode, message: string): Result<T> => ({ ok: false, code, message });
export const notSupported = <T = never>(what: string): Result<T> => fail("NOT_SUPPORTED", `${what} is not supported by this printer integration.`);

export interface ConnectInfo {
  name: string | null;
  firmwareVersion: string | null;
  pid: number | null;
  latencyMs: number;
}

export interface CurrentJob {
  jobId: string | null;
  fileName: string | null;
  status: string | null;
}

export interface Progress {
  /** 0..1 */
  fraction: number | null;
  layer: number | null;
  totalLayers: number | null;
  elapsedSeconds: number | null;
}

export interface PrinterErrorInfo {
  code: string;
}

export interface SendPrintOptions {
  /** Local path of the verified, sliced file. */
  filePath: string;
  /** Name to store the file under on the printer. */
  fileName: string;
  levelingBeforePrint: boolean;
  flowCalibration: boolean;
  firstLayerInspection: boolean;
  timeLapseVideo: boolean;
  useMaterialStation: boolean;
  materialMappings: MaterialMapping[];
}

export interface PrinterIntegration {
  readonly model: PrinterModelKey;
  getCapabilities(): Capability[];
  connect(): Promise<Result<ConnectInfo>>;
  disconnect(): Promise<Result<void>>;
  getStatus(): Promise<Result<string>>;
  getTelemetry(): Promise<Result<PrinterTelemetry>>;
  getCurrentJob(): Promise<Result<CurrentJob>>;
  getProgress(): Promise<Result<Progress>>;
  getErrors(): Promise<Result<PrinterErrorInfo[]>>;
  sendPrintJob(options: SendPrintOptions): Promise<Result<void>>;
  pausePrint(jobId: string): Promise<Result<void>>;
  resumePrint(jobId: string): Promise<Result<void>>;
  stopPrint(jobId: string): Promise<Result<void>>;
  /** Tells the printer the build plate has been cleared after a finished print. */
  clearPlatform(): Promise<Result<void>>;
  /** Anything the official interface doesn't offer. Always NOT_SUPPORTED. */
  switchColour(): Promise<Result<void>>;
  getActualFilamentUsage(): Promise<Result<number>>;
  updateFirmware(): Promise<Result<void>>;
}
