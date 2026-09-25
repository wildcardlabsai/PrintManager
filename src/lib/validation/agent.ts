import { z } from "zod";
import { AGENT_PROTOCOL_VERSION } from "../../../agent/src/protocol";

/**
 * Validation for everything a Printer Agent sends. The agent runs on a
 * customer's computer, so its input is treated as untrusted: strict shapes,
 * bounded sizes, and unknown keys stripped.
 */
const str = (max = 200) => z.string().max(max).nullable();
const num = z.number().finite().nullable();
const bool = z.boolean().nullable();

const slot = z.object({ slotId: z.number().int().min(0).max(64), hasFilament: z.boolean(), material: str(60), colour: str(40) });

export const telemetrySchema = z.object({
  status: str(40),
  name: str(),
  pid: num,
  firmwareVersion: str(80),
  macAddress: str(40),
  ipAddress: str(64),
  nozzleCount: num,
  nozzleModel: str(60),
  camera: num,
  cameraStreamUrl: z
    .string()
    .max(500)
    .regex(/^(https?|rtsp):\/\//i)
    .nullable()
    .catch(null),
  jobId: str(200),
  printFileName: str(300),
  printProgress: z.number().finite().min(0).max(1).nullable().catch(null),
  printLayer: num,
  targetPrintLayer: num,
  printDuration: num,
  estimatedTime: num,
  nozzleTemp: num,
  nozzleTargetTemp: num,
  bedTemp: num,
  bedTargetTemp: num,
  chamberTemp: num,
  chamberTargetTemp: num,
  rightFilamentType: str(60),
  leftFilamentType: str(60),
  hasRightFilament: bool,
  hasLeftFilament: bool,
  estimatedRightWeight: num,
  estimatedLeftWeight: num,
  hasMaterialStation: bool,
  materialStation: z
    .object({
      slotCount: z.number().int().min(0).max(64),
      currentSlot: num,
      currentLoadSlot: num,
      stateAction: num,
      slots: z.array(slot).max(64),
    })
    .nullable(),
  directFeed: z.object({ material: str(60), colour: str(40), stateAction: num }).nullable(),
  doorStatus: str(20),
  lightStatus: str(20),
  remainingDiskSpaceGb: num,
  cumulativePrintMinutes: num,
  cumulativeFilamentMm: num,
  errorCode: str(80),
});

const errorCode = z
  .enum([
    "NOT_SUPPORTED",
    "NOT_CONFIGURED",
    "MISSING_CHECK_CODE",
    "AUTH_FAILED",
    "UNREACHABLE",
    "TIMEOUT",
    "BUSY",
    "INVALID_STATE",
    "JOB_MISMATCH",
    "FILE_NOT_FOUND",
    "CHECKSUM_MISMATCH",
    "DOWNLOAD_FAILED",
    "LIBRARY_UNAVAILABLE",
    "ERROR",
  ])
  .catch("ERROR");

export const heartbeatSchema = z.object({
  protocol: z.literal(AGENT_PROTOCOL_VERSION),
  agent: z.object({
    version: z.string().max(40),
    platform: z.string().max(60),
    driver: z.enum(["flashforge_lan", "mock"]),
    libraryVersion: z.string().max(60).nullable(),
  }),
  printers: z
    .array(
      z.object({
        printerId: z.uuid(),
        reachable: z.boolean(),
        latencyMs: z.number().int().min(0).max(600000).nullable(),
        errorCode: errorCode.nullable(),
        error: z.string().max(1000).nullable(),
        telemetry: telemetrySchema.nullable(),
      }),
    )
    .max(50),
});

export const pairSchema = z.object({
  code: z.string().min(8).max(20),
  name: z.string().trim().min(1).max(120).optional(),
  version: z.string().max(40),
  platform: z.string().max(60),
  driver: z.enum(["flashforge_lan", "mock"]),
});

export const commandResultSchema = z.object({
  status: z.enum(["succeeded", "failed"]),
  errorCode: errorCode.nullish(),
  error: z.string().max(1000).nullish(),
  telemetry: telemetrySchema.nullish(),
  result: z.record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])).optional(),
});
