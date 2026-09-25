import fs from "node:fs";
import type { MaterialSlot, PrinterModelKey, PrinterTelemetry } from "../protocol.js";
import {
  FNET_CONN_SEND_ERROR,
  FNET_DIVICE_IS_BUSY,
  FNET_ERROR,
  FNET_VERIFY_LAN_DEV_FAILED,
  type DiscoveredPrinter,
  type FlashforgeTransport,
  type FnetResult,
  type LanTarget,
  type ProductInfo,
  type SendGcodeRequest,
} from "./transport.js";

/**
 * A simulated Flashforge printer for development and automated tests.
 *
 * It follows the state names the real library reports, but it is not a
 * printer: everything it produces is labelled "mock" all the way to the UI.
 */
export interface MockPrinterSpec {
  serialNumber: string;
  checkCode: string;
  model: PrinterModelKey;
  name?: string;
  ip?: string;
  port?: number;
  firmwareVersion?: string;
}

type Phase = "ready" | "heating" | "printing" | "pausing" | "pause" | "canceling" | "cancel" | "completed" | "error";

export interface MockPrinterState {
  spec: Required<MockPrinterSpec>;
  phase: Phase;
  online: boolean;
  jobId: string | null;
  fileName: string | null;
  progress: number;
  elapsed: number;
  layers: number;
  errorCode: string | null;
  failNextSend: boolean;
  slots: MaterialSlot[];
  lastSend: SendGcodeRequest | null;
  jobCounter: number;
}

export interface MockTiming {
  /** Simulated seconds of printing per real second. */
  speed: number;
  /** Simulated print length in seconds. */
  printSeconds: number;
  heatingSeconds: number;
}

export class MockPrinterFleet {
  readonly printers = new Map<string, MockPrinterState>();
  private lastTick = Date.now();

  constructor(
    specs: MockPrinterSpec[] = [],
    readonly timing: MockTiming = { speed: 1, printSeconds: 60, heatingSeconds: 3 },
  ) {
    for (const s of specs) this.add(s);
  }

  add(spec: MockPrinterSpec) {
    if (this.printers.has(spec.serialNumber)) return this.printers.get(spec.serialNumber)!;
    const full: Required<MockPrinterSpec> = {
      name: spec.model === "AD5X" ? "AD5X (simulated)" : "Adventurer 5M (simulated)",
      ip: "127.0.0.1",
      port: 0,
      firmwareVersion: "mock-1.0.0",
      ...spec,
    };
    const state: MockPrinterState = {
      spec: full,
      phase: "ready",
      online: true,
      jobId: null,
      fileName: null,
      progress: 0,
      elapsed: 0,
      layers: 100,
      errorCode: null,
      failNextSend: false,
      slots:
        spec.model === "AD5X"
          ? [
              { slotId: 1, hasFilament: true, material: "PLA", colour: "#FFFFFF" },
              { slotId: 2, hasFilament: true, material: "PLA", colour: "#000000" },
              { slotId: 3, hasFilament: true, material: "PLA", colour: "#FF0000" },
              { slotId: 4, hasFilament: false, material: null, colour: null },
            ]
          : [],
      lastSend: null,
      jobCounter: 0,
    };
    this.printers.set(spec.serialNumber, state);
    return state;
  }

  /** Advances every simulated printer to the current time. */
  tick(now = Date.now()) {
    const dt = ((now - this.lastTick) / 1000) * this.timing.speed;
    this.lastTick = now;
    for (const p of this.printers.values()) {
      if (p.phase === "heating") {
        p.elapsed += dt;
        if (p.elapsed >= this.timing.heatingSeconds) p.phase = "printing";
      } else if (p.phase === "printing") {
        p.elapsed += dt;
        p.progress = Math.min(1, p.progress + dt / this.timing.printSeconds);
        if (p.progress >= 1) p.phase = "completed";
      } else if (p.phase === "pausing") {
        p.phase = "pause";
      } else if (p.phase === "canceling") {
        p.phase = "cancel";
      } else if (p.phase === "cancel") {
        Object.assign(p, { phase: "ready", jobId: null, fileName: null, progress: 0, elapsed: 0 });
      }
    }
  }

  // Test / demo controls ------------------------------------------------------

  control(serial: string, action: string): boolean {
    const p = this.printers.get(serial);
    if (!p) return false;
    switch (action) {
      case "offline":
        p.online = false;
        break;
      case "online":
        p.online = true;
        break;
      case "error":
        p.phase = "error";
        p.errorCode = "E0001";
        break;
      case "clear_error":
        p.phase = p.jobId ? "pause" : "ready";
        p.errorCode = null;
        break;
      case "finish":
        if (p.jobId) {
          p.progress = 1;
          p.phase = "completed";
        }
        break;
      case "cancel_at_printer":
        if (p.jobId) p.phase = "canceling";
        break;
      case "fail_next_send":
        p.failNextSend = true;
        break;
      case "reset":
        Object.assign(p, { phase: "ready", jobId: null, fileName: null, progress: 0, elapsed: 0, errorCode: null, online: true });
        break;
      default:
        return false;
    }
    return true;
  }

  snapshot(serial: string) {
    return this.printers.get(serial);
  }
}

export class MockTransport implements FlashforgeTransport {
  readonly kind = "mock" as const;

  constructor(readonly fleet: MockPrinterFleet) {}

  libraryVersion() {
    return "mock";
  }

  private find(t: LanTarget): { code: number; printer?: MockPrinterState } {
    this.fleet.tick();
    const p = this.fleet.printers.get(t.serialNumber);
    if (!p || !p.online) return { code: FNET_ERROR };
    if (p.spec.checkCode !== t.checkCode) return { code: FNET_VERIFY_LAN_DEV_FAILED };
    return { code: 0, printer: p };
  }

  async discover(): Promise<DiscoveredPrinter[]> {
    return [...this.fleet.printers.values()]
      .filter((p) => p.online)
      .map((p) => ({ serialNumber: p.spec.serialNumber, name: p.spec.name, ip: p.spec.ip, port: p.spec.port, pid: 0, connectMode: 0 }));
  }

  async getProduct(t: LanTarget): Promise<FnetResult<ProductInfo>> {
    const f = this.find(t);
    if (!f.printer) return { code: f.code };
    return { code: 0, value: { nozzleTempControl: true, platformTempControl: true, chamberTempControl: false, lightControl: true } };
  }

  async getDetail(t: LanTarget): Promise<FnetResult<PrinterTelemetry>> {
    const f = this.find(t);
    if (!f.printer) return { code: f.code };
    const p = f.printer;
    const active = p.phase !== "ready";
    const printing = ["heating", "printing", "pausing", "pause"].includes(p.phase);
    return {
      code: 0,
      value: {
        status: p.phase,
        name: p.spec.name,
        pid: 0,
        firmwareVersion: p.spec.firmwareVersion,
        macAddress: null,
        ipAddress: p.spec.ip,
        nozzleCount: 1,
        nozzleModel: "0.4mm",
        camera: 2,
        cameraStreamUrl: null,
        jobId: active ? p.jobId : null,
        printFileName: active ? p.fileName : null,
        printProgress: active ? Math.round(p.progress * 1000) / 1000 : 0,
        printLayer: active ? Math.floor(p.progress * p.layers) : 0,
        targetPrintLayer: active ? p.layers : 0,
        printDuration: active ? Math.round(p.elapsed) : 0,
        estimatedTime: active ? this.fleet.timing.printSeconds : 0,
        nozzleTemp: printing ? 220 : 25,
        nozzleTargetTemp: printing ? 220 : 0,
        bedTemp: printing ? 60 : 24,
        bedTargetTemp: printing ? 60 : 0,
        chamberTemp: null,
        chamberTargetTemp: null,
        rightFilamentType: p.spec.model === "AD5X" ? null : "PLA",
        leftFilamentType: null,
        hasRightFilament: true,
        hasLeftFilament: null,
        estimatedRightWeight: null,
        estimatedLeftWeight: null,
        hasMaterialStation: p.spec.model === "AD5X",
        materialStation:
          p.spec.model === "AD5X"
            ? { slotCount: 4, currentSlot: 1, currentLoadSlot: 1, stateAction: printing ? 4 : 0, slots: p.slots.map((s) => ({ ...s })) }
            : null,
        directFeed: p.spec.model === "AD5X" ? { material: "PLA", colour: "#FFFFFF", stateAction: printing ? 4 : 0 } : null,
        doorStatus: null,
        lightStatus: "open",
        remainingDiskSpaceGb: 5.2,
        cumulativePrintMinutes: null,
        cumulativeFilamentMm: null,
        errorCode: p.errorCode,
      },
    };
  }

  async sendGcode(t: LanTarget, req: SendGcodeRequest): Promise<FnetResult<void>> {
    const f = this.find(t);
    if (!f.printer) return { code: f.code };
    const p = f.printer;
    if (p.failNextSend) {
      p.failNextSend = false;
      return { code: FNET_CONN_SEND_ERROR };
    }
    if (p.phase !== "ready") return { code: FNET_DIVICE_IS_BUSY };
    if (!fs.existsSync(req.filePath)) return { code: FNET_ERROR };
    p.lastSend = req;
    p.jobCounter += 1;
    p.jobId = `mock-${p.spec.serialNumber}-${p.jobCounter}`;
    p.fileName = req.dstName;
    p.progress = 0;
    p.elapsed = 0;
    p.phase = req.printNow ? "heating" : "ready";
    return { code: 0, value: undefined };
  }

  async ctrlJob(t: LanTarget, jobId: string, action: "pause" | "continue" | "cancel"): Promise<FnetResult<void>> {
    const f = this.find(t);
    if (!f.printer) return { code: f.code };
    const p = f.printer;
    if (p.jobId !== jobId) return { code: FNET_ERROR };
    if (action === "pause") p.phase = "pausing";
    else if (action === "continue") p.phase = "printing";
    else p.phase = "canceling";
    return { code: 0, value: undefined };
  }

  async ctrlState(t: LanTarget): Promise<FnetResult<void>> {
    const f = this.find(t);
    if (!f.printer) return { code: f.code };
    const p = f.printer;
    if (p.phase === "completed" || p.phase === "cancel") {
      Object.assign(p, { phase: "ready", jobId: null, fileName: null, progress: 0, elapsed: 0 });
    }
    return { code: 0, value: undefined };
  }

  close() {}
}
