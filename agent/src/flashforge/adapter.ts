import {
  fail,
  notSupported,
  ok,
  type ConnectInfo,
  type CurrentJob,
  type PrinterErrorInfo,
  type PrinterIntegration,
  type Progress,
  type Result,
  type SendPrintOptions,
} from "../integration.js";
import { MODEL_CAPABILITIES, type Capability, type PrinterModelKey, type PrinterTelemetry } from "../protocol.js";
import { fnetErrorCode, fnetErrorMessage, type FlashforgeTransport, type FnetResult, type LanTarget } from "./transport.js";

/** Timeouts Flashforge's own slicer uses for LAN calls (ComTimeoutLanA / ComTimeoutLanB). */
export const LAN_TIMEOUT_MS = 5000;
export const LAN_SEND_TIMEOUT_MS = 15000;

function toResult<T>(r: FnetResult<T>): Result<T> {
  if (r.code === 0) return ok(r.value as T);
  return fail(fnetErrorCode(r.code), fnetErrorMessage(r.code));
}

/**
 * Flashforge printer over the official LAN interface. Shared by the AD5X and
 * Adventurer 5M adapters, which differ in what they can physically do.
 */
export abstract class FlashforgeLanIntegration implements PrinterIntegration {
  abstract readonly model: PrinterModelKey;

  constructor(
    protected readonly transport: FlashforgeTransport,
    protected readonly target: LanTarget,
  ) {}

  getCapabilities(): Capability[] {
    return MODEL_CAPABILITIES[this.model];
  }

  /** "Connecting" over LAN means the printer answers and accepts the serial/check code. */
  async connect(): Promise<Result<ConnectInfo>> {
    const started = Date.now();
    const product = toResult(await this.transport.getProduct(this.target, LAN_TIMEOUT_MS));
    if (!product.ok) return product;
    const detail = await this.getTelemetry();
    if (!detail.ok) return detail;
    return ok({
      name: detail.value.name,
      firmwareVersion: detail.value.firmwareVersion,
      pid: detail.value.pid,
      latencyMs: Date.now() - started,
    });
  }

  /** LAN calls are stateless request/response; there is no session to close. */
  async disconnect(): Promise<Result<void>> {
    return ok(undefined);
  }

  async getTelemetry(): Promise<Result<PrinterTelemetry>> {
    const r = toResult(await this.transport.getDetail(this.target, LAN_TIMEOUT_MS));
    if (!r.ok) return r;
    return ok(this.filterTelemetry(r.value));
  }

  async getStatus(): Promise<Result<string>> {
    const t = await this.getTelemetry();
    if (!t.ok) return t;
    if (!t.value.status) return fail("ERROR", "The printer did not report a status.");
    return ok(t.value.status);
  }

  async getCurrentJob(): Promise<Result<CurrentJob>> {
    const t = await this.getTelemetry();
    if (!t.ok) return t;
    return ok({ jobId: t.value.jobId, fileName: t.value.printFileName, status: t.value.status });
  }

  async getProgress(): Promise<Result<Progress>> {
    const t = await this.getTelemetry();
    if (!t.ok) return t;
    return ok({
      fraction: t.value.printProgress,
      layer: t.value.printLayer,
      totalLayers: t.value.targetPrintLayer,
      elapsedSeconds: t.value.printDuration,
    });
  }

  async getErrors(): Promise<Result<PrinterErrorInfo[]>> {
    const t = await this.getTelemetry();
    if (!t.ok) return t;
    const code = t.value.errorCode?.trim();
    return ok(code && code !== "0" ? [{ code }] : []);
  }

  async sendPrintJob(options: SendPrintOptions): Promise<Result<void>> {
    const check = this.checkSendOptions(options);
    if (!check.ok) return check;
    // Only start on an idle printer: never on top of a running or finished-but-uncleared print.
    const status = await this.getStatus();
    if (!status.ok) return status;
    if (status.value !== "ready") {
      return fail(
        "INVALID_STATE",
        status.value === "completed"
          ? "The printer is showing a finished print. Clear the build plate and confirm it on the printer (or in PrintFlow) first."
          : `The printer is ${status.value}, not ready.`,
      );
    }
    return toResult(
      await this.transport.sendGcode(
        this.target,
        {
          filePath: options.filePath,
          dstName: options.fileName,
          printNow: true,
          levelingBeforePrint: options.levelingBeforePrint,
          flowCalibration: options.flowCalibration,
          firstLayerInspection: options.firstLayerInspection,
          timeLapseVideo: options.timeLapseVideo,
          useMatlStation: options.useMaterialStation,
          materialMappings: options.useMaterialStation ? options.materialMappings : [],
        },
        LAN_SEND_TIMEOUT_MS,
      ),
    );
  }

  pausePrint(jobId: string) {
    return this.controlJob(jobId, "pause", ["printing", "heating"]);
  }

  resumePrint(jobId: string) {
    return this.controlJob(jobId, "continue", ["pause"]);
  }

  stopPrint(jobId: string) {
    return this.controlJob(jobId, "cancel", ["printing", "heating", "pause", "pausing", "calibrate_doing", "busy"]);
  }

  async clearPlatform(): Promise<Result<void>> {
    return toResult(await this.transport.ctrlState(this.target, "setClearPlatform", LAN_TIMEOUT_MS));
  }

  async switchColour(): Promise<Result<void>> {
    return notSupported("Remote colour switching");
  }

  async getActualFilamentUsage(): Promise<Result<number>> {
    return notSupported("Reading actual filament used");
  }

  async updateFirmware(): Promise<Result<void>> {
    return notSupported("Firmware updates");
  }

  /** Model-specific validation of a print request. */
  protected abstract checkSendOptions(options: SendPrintOptions): Result<void>;

  /** Drop fields a model can't physically have, so they show as "Not available". */
  protected filterTelemetry(t: PrinterTelemetry): PrinterTelemetry {
    return t;
  }

  private async controlJob(jobId: string, action: "pause" | "continue" | "cancel", allowed: string[]): Promise<Result<void>> {
    if (!jobId) return fail("INVALID_STATE", "No printer job id to control.");
    const current = await this.getCurrentJob();
    if (!current.ok) return current;
    if (current.value.jobId !== jobId) {
      return fail("JOB_MISMATCH", "The printer is not running the job PrintFlow expected, so nothing was changed.");
    }
    if (!current.value.status || !allowed.includes(current.value.status)) {
      return fail("INVALID_STATE", `Can't ${action === "continue" ? "resume" : action} while the printer is ${current.value.status ?? "in an unknown state"}.`);
    }
    return toResult(await this.transport.ctrlJob(this.target, jobId, action, LAN_TIMEOUT_MS));
  }
}

export class FlashforgeAd5xIntegration extends FlashforgeLanIntegration {
  readonly model = "AD5X" as const;

  protected checkSendOptions(o: SendPrintOptions): Result<void> {
    if (!o.useMaterialStation) return ok(undefined);
    if (!o.materialMappings.length) return fail("INVALID_STATE", "An IFS print needs each file colour mapped to an IFS slot.");
    for (const m of o.materialMappings) {
      if (m.slotId < 1 || m.slotId > 4) return fail("INVALID_STATE", `IFS slot ${m.slotId} does not exist (AD5X has slots 1–4).`);
    }
    return ok(undefined);
  }
}

export class FlashforgeAdventurer5mIntegration extends FlashforgeLanIntegration {
  readonly model = "ADVENTURER_5M" as const;

  protected checkSendOptions(o: SendPrintOptions): Result<void> {
    if (o.useMaterialStation || o.materialMappings.length) {
      return fail("NOT_SUPPORTED", "The Adventurer 5M has no material station; multi-colour files can't be printed on it.");
    }
    return ok(undefined);
  }

  protected filterTelemetry(t: PrinterTelemetry): PrinterTelemetry {
    return { ...t, materialStation: null, hasMaterialStation: t.hasMaterialStation ?? null };
  }
}

export function createFlashforgeIntegration(model: PrinterModelKey, transport: FlashforgeTransport, target: LanTarget): PrinterIntegration {
  return model === "AD5X" ? new FlashforgeAd5xIntegration(transport, target) : new FlashforgeAdventurer5mIntegration(transport, target);
}
