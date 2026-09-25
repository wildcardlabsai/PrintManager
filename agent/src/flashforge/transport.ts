import type { AgentDriver, AgentErrorCode, MaterialMapping, PrinterTelemetry } from "../protocol.js";

/**
 * The calls PrintFlow makes against Flashforge's official network library
 * (FlashNetwork, shipped with Flashforge's Orca-Flashforge slicer). LAN only:
 * every call is addressed by IP, port, serial number and the printer's check
 * code, exactly as the library's LAN functions take them.
 */
export interface LanTarget {
  ip: string;
  port: number;
  serialNumber: string;
  checkCode: string;
}

export interface DiscoveredPrinter {
  serialNumber: string;
  name: string;
  ip: string;
  port: number;
  pid: number;
  /** 0 LAN mode, 1 WAN (cloud) mode — PrintFlow needs LAN mode. */
  connectMode: number;
}

export interface ProductInfo {
  nozzleTempControl: boolean;
  platformTempControl: boolean;
  chamberTempControl: boolean;
  lightControl: boolean;
}

export interface SendGcodeRequest {
  filePath: string;
  dstName: string;
  printNow: boolean;
  levelingBeforePrint: boolean;
  flowCalibration: boolean;
  firstLayerInspection: boolean;
  timeLapseVideo: boolean;
  useMatlStation: boolean;
  materialMappings: MaterialMapping[];
}

/** 0 = FNET_OK. Other values are FlashNetwork return codes. */
export type FnetResult<T> = { code: 0; value: T } | { code: number; value?: undefined };

export interface FlashforgeTransport {
  readonly kind: AgentDriver;
  libraryVersion(): string | null;
  discover(waitMs: number): Promise<DiscoveredPrinter[]>;
  getDetail(target: LanTarget, timeoutMs: number): Promise<FnetResult<PrinterTelemetry>>;
  getProduct(target: LanTarget, timeoutMs: number): Promise<FnetResult<ProductInfo>>;
  sendGcode(target: LanTarget, request: SendGcodeRequest, connectTimeoutMs: number): Promise<FnetResult<void>>;
  ctrlJob(target: LanTarget, jobId: string, action: "pause" | "continue" | "cancel", timeoutMs: number): Promise<FnetResult<void>>;
  ctrlState(target: LanTarget, action: "setClearPlatform", timeoutMs: number): Promise<FnetResult<void>>;
  close(): void;
}

// FlashNetwork.h return codes
export const FNET_OK = 0;
export const FNET_ERROR = -1;
export const FNET_ABORTED_BY_CALLBACK = 1;
export const FNET_DIVICE_IS_BUSY = 2;
export const FNET_GCODE_NOT_FOUND = 3;
export const FNET_VERIFY_LAN_DEV_FAILED = 1001;
export const FNET_CONN_SEND_ERROR = 3001;

export function fnetErrorCode(code: number): AgentErrorCode {
  switch (code) {
    case FNET_VERIFY_LAN_DEV_FAILED:
      return "AUTH_FAILED";
    case FNET_DIVICE_IS_BUSY:
      return "BUSY";
    case FNET_GCODE_NOT_FOUND:
      return "FILE_NOT_FOUND";
    case FNET_CONN_SEND_ERROR:
    case FNET_ERROR:
      return "UNREACHABLE";
    default:
      return "ERROR";
  }
}

export function fnetErrorMessage(code: number): string {
  switch (code) {
    case FNET_VERIFY_LAN_DEV_FAILED:
      return "The printer rejected the serial number / check code. Check the Printer ID shown in the printer's network settings.";
    case FNET_DIVICE_IS_BUSY:
      return "The printer is busy.";
    case FNET_GCODE_NOT_FOUND:
      return "The printer could not find the file.";
    case FNET_CONN_SEND_ERROR:
      return "Could not send data to the printer.";
    case FNET_ERROR:
      return "The printer did not respond on the local network (check it is on, in LAN mode and at this IP address).";
    default:
      return `FlashNetwork error ${code}.`;
  }
}
