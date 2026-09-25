import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { MaterialStation, PrinterTelemetry } from "../protocol.js";
import type { DiscoveredPrinter, FlashforgeTransport, FnetResult, LanTarget, ProductInfo, SendGcodeRequest } from "./transport.js";

/**
 * Binding to Flashforge's FlashNetwork library through koffi (FFI).
 *
 * The library is Flashforge's own networking component, distributed with
 * their Orca-Flashforge slicer (FlashNetwork.dll / libFlashNetwork.dylib /
 * libFlashNetwork.so). PrintFlow does not ship it: the agent loads the copy
 * from the user's Orca-Flashforge installation. Struct layouts and function
 * signatures below mirror FlashNetwork.h (#pragma pack(push, 8), i.e. natural
 * alignment on 64-bit platforms). Only LAN functions are bound.
 */

type Koffi = typeof import("koffi");
type KoffiFn = ((...args: unknown[]) => unknown) & { async: (...args: unknown[]) => void };

export interface FlashNetworkOptions {
  libraryPath: string;
  /** FLASHNETWORK7.DAT from the same installation (Orca-Flashforge passes it to fnet_initlize). */
  serverSettingsPath: string;
  logDir?: string | null;
}

/** Default install locations of Orca-Flashforge. */
export function defaultFlashNetworkPaths(platform = process.platform): { libraryPath: string; serverSettingsPath: string } | null {
  if (platform === "win32") {
    const base = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Orca-Flashforge");
    return { libraryPath: path.join(base, "FlashNetwork.dll"), serverSettingsPath: path.join(base, "resources", "data", "FLASHNETWORK7.DAT") };
  }
  if (platform === "darwin") {
    const base = "/Applications/Orca-Flashforge.app/Contents/MacOS";
    return { libraryPath: path.join(base, "libFlashNetwork.dylib"), serverSettingsPath: path.join(base, "..", "Resources", "data", "FLASHNETWORK7.DAT") };
  }
  return null; // Linux AppImage: extract it and point the agent at the files.
}

export class FlashNetworkUnavailableError extends Error {}

export class FlashNetworkTransport implements FlashforgeTransport {
  readonly kind = "flashforge_lan" as const;
  private readonly koffi: Koffi;
  private readonly fn: Record<string, KoffiFn> = {};
  private readonly types: Record<string, unknown> = {};
  private version: string | null = null;

  constructor(opts: FlashNetworkOptions) {
    if (!fs.existsSync(opts.libraryPath)) {
      throw new FlashNetworkUnavailableError(`FlashNetwork library not found at ${opts.libraryPath}. Install Orca-Flashforge or set flashNetwork.libraryPath.`);
    }
    if (!fs.existsSync(opts.serverSettingsPath)) {
      throw new FlashNetworkUnavailableError(`FLASHNETWORK7.DAT not found at ${opts.serverSettingsPath}. Set flashNetwork.serverSettingsPath.`);
    }
    try {
      this.koffi = createRequire(import.meta.url)("koffi") as Koffi;
    } catch {
      throw new FlashNetworkUnavailableError("The koffi package is not installed (npm install in the agent folder).");
    }
    const k = this.koffi;
    const lib = k.load(opts.libraryPath);

    // --- types (FlashNetwork.h) ---
    const t = this.types;
    t.log = k.struct("fnet_log_settings_t", { fileDir: "const char *", expireHours: "int", level: "int" });
    t.lanDevInfo = k.struct("fnet_lan_dev_info_t", {
      serialNumber: k.array("char", 128, "String"),
      name: k.array("char", 128, "String"),
      ip: k.array("char", 16, "String"),
      port: "uint16_t",
      vid: "uint16_t",
      pid: "uint16_t",
      connectMode: "uint16_t",
      bindStatus: "uint16_t",
      bindType: "uint16_t",
    });
    t.product = k.struct("fnet_dev_product_t", {
      nozzleTempCtrlState: "int",
      chamberTempCtrlState: "int",
      platformTempCtrlState: "int",
      lightCtrlState: "int",
      internalFanCtrlState: "int",
      externalFanCtrlState: "int",
    });
    t.slot = k.struct("fnet_matl_slot_info_t", { slotId: "int", hasFilament: "int", materialName: "const char *", materialColor: "const char *" });
    t.station = k.struct("fnet_matl_station_info_t", {
      slotCnt: "int",
      currentSlot: "int",
      currentLoadSlot: "int",
      stateAction: "int",
      stateStep: "int",
      slotInfos: "void *",
    });
    t.indep = k.struct("fnet_indep_matl_info_t", { stateAction: "int", stateStep: "int", materialName: "const char *", materialColor: "const char *" });
    t.detail = k.struct("fnet_dev_detail_t", {
      devId: "const char *",
      pid: "int",
      nozzleCnt: "int",
      nozzleStyle: "int",
      measure: "const char *",
      nozzleModel: "const char *",
      firmwareVersion: "const char *",
      macAddr: "const char *",
      ipAddr: "const char *",
      name: "const char *",
      lidar: "int",
      camera: "int",
      moveCtrl: "int",
      extrudeCtrl: "int",
      location: "const char *",
      status: "const char *",
      coordinate: k.array("double", 3, "Array"),
      jobId: "const char *",
      printFileName: "const char *",
      printFileThumbUrl: "const char *",
      printLayer: "int",
      targetPrintLayer: "int",
      printProgress: "double",
      rightTemp: "double",
      rightTargetTemp: "double",
      leftTemp: "double",
      leftTargetTemp: "double",
      nozzleTemps: "void *",
      nozzleTargetTemps: "void *",
      platTemp: "double",
      platTargetTemp: "double",
      chamberTemp: "double",
      chamberTargetTemp: "double",
      fillAmount: "double",
      zAxisCompensation: "double",
      rightFilamentType: "const char *",
      leftFilamentType: "const char *",
      currentPrintSpeed: "double",
      printSpeedAdjust: "double",
      printDuration: "double",
      estimatedTime: "double",
      estimatedRightLen: "double",
      estimatedLeftLen: "double",
      estimatedRightWeight: "double",
      estimatedLeftWeight: "double",
      coolingFanSpeed: "double",
      coolingFanLeftSpeed: "double",
      chamberFanSpeed: "double",
      hasRightFilament: "int",
      hasLeftFilament: "int",
      hasMatlStation: "int",
      matlStationInfo: t.station as never,
      indepMatlInfo: t.indep as never,
      internalFanStatus: "const char *",
      externalFanStatus: "const char *",
      clearFanStatus: "const char *",
      doorStatus: "const char *",
      lightStatus: "const char *",
      autoShutdown: "const char *",
      autoShutdownTime: "double",
      tvoc: "double",
      remainingDiskSpace: "double",
      cumulativePrintTime: "double",
      cumulativeFilament: "double",
      cameraStreamUrl: "const char *",
      polarRegisterCode: "const char *",
      flashRegisterCode: "const char *",
      errorCode: "const char *",
    });
    t.mapping = k.struct("fnet_material_mapping_t", {
      toolId: "int",
      slotId: "int",
      materialName: "const char *",
      toolMaterialColor: "const char *",
      slotMaterialColor: "const char *",
    });
    t.sendGcode = k.struct("fnet_send_gcode_data_t", {
      gcodeFilePath: "const char *",
      thumbFilePath: "const char *",
      gcodeDstName: "const char *",
      printNow: "int",
      levelingBeforePrint: "int",
      flowCalibration: "int",
      firstLayerInspection: "int",
      timeLapseVideo: "int",
      useMatlStation: "int",
      gcodeToolCnt: "int",
      materialMappings: k.pointer(t.mapping as never),
      callback: "void *",
      callbackData: "void *",
    });
    t.jobCtrl = k.struct("fnet_job_ctrl_t", { jobId: "const char *", action: "const char *" });
    t.stateCtrl = k.struct("fnet_state_ctrl_t", { action: "const char *" });

    // --- functions (LAN only) ---
    const f = (proto: string) => lib.func(proto) as unknown as KoffiFn;
    this.fn.initlize = f("int fnet_initlize(const char *serverSettingsPath, const fnet_log_settings_t *logSettings)");
    this.fn.uninitlize = f("void fnet_uninitlize()");
    this.fn.getVersion = f("const char *fnet_getVersion()");
    this.fn.getLanDevList = f("int fnet_getLanDevList(_Out_ void **infos, _Out_ int *devCnt, int msWaitTime)");
    this.fn.freeLanDevInfos = f("void fnet_freeLanDevInfos(void *infos)");
    this.fn.getLanDevProduct = f(
      "int fnet_getLanDevProduct(const char *ip, uint16_t port, const char *serialNumber, const char *checkCode, _Out_ void **product, int msTimeout)",
    );
    this.fn.freeDevProduct = f("void fnet_freeDevProduct(void *product)");
    this.fn.getLanDevDetail = f(
      "int fnet_getLanDevDetail(const char *ip, uint16_t port, const char *serialNumber, const char *checkCode, _Out_ void **detail, int msTimeout)",
    );
    this.fn.freeDevDetail = f("void fnet_freeDevDetail(void *detail)");
    this.fn.lanDevSendGcode = f(
      "int fnet_lanDevSendGcode(const char *ip, uint16_t port, const char *serialNumber, const char *checkCode, const fnet_send_gcode_data_t *sendGcodeData, int msConnectTimeout)",
    );
    this.fn.ctrlLanDevJob = f(
      "int fnet_ctrlLanDevJob(const char *ip, uint16_t port, const char *serialNumber, const char *checkCode, const fnet_job_ctrl_t *jobCtrl, int msTimeout)",
    );
    this.fn.ctrlLanDevState = f(
      "int fnet_ctrlLanDevState(const char *ip, uint16_t port, const char *serialNumber, const char *checkCode, const fnet_state_ctrl_t *stateCtrl, int msTimeout)",
    );

    const logDir = opts.logDir ?? null;
    const rc = this.fn.initlize(opts.serverSettingsPath, logDir ? { fileDir: logDir, expireHours: 72, level: 2 } : null) as number;
    if (rc !== 0) throw new FlashNetworkUnavailableError(`fnet_initlize failed with code ${rc}.`);
    this.version = (this.fn.getVersion() as string | null) ?? null;
  }

  libraryVersion() {
    return this.version;
  }

  /** Runs a library call on a worker thread, with a JS-side deadline as a backstop. */
  private call<T>(name: string, args: unknown[], deadlineMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${name} did not return within ${deadlineMs} ms`)), deadlineMs);
      this.fn[name].async(...args, (err: unknown, res: T) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(res);
      });
    });
  }

  async discover(waitMs: number): Promise<DiscoveredPrinter[]> {
    const out: unknown[] = [null];
    const cnt: number[] = [0];
    const rc = await this.call<number>("getLanDevList", [out, cnt, waitMs], waitMs + 5000);
    if (rc !== 0 || !out[0]) return [];
    try {
      const infos = this.koffi.decode(out[0], this.types.lanDevInfo as never, cnt[0]) as {
        serialNumber: string;
        name: string;
        ip: string;
        port: number;
        pid: number;
        connectMode: number;
      }[];
      return infos.map((i) => ({ serialNumber: i.serialNumber, name: i.name, ip: i.ip, port: i.port, pid: i.pid, connectMode: i.connectMode }));
    } finally {
      this.fn.freeLanDevInfos(out[0]);
    }
  }

  async getProduct(t: LanTarget, timeoutMs: number): Promise<FnetResult<ProductInfo>> {
    const out: unknown[] = [null];
    const rc = await this.call<number>("getLanDevProduct", [t.ip, t.port, t.serialNumber, t.checkCode, out, timeoutMs], timeoutMs + 5000);
    if (rc !== 0 || !out[0]) return { code: rc || -1 };
    try {
      const p = this.koffi.decode(out[0], this.types.product as never) as Record<string, number>;
      return {
        code: 0,
        value: {
          nozzleTempControl: p.nozzleTempCtrlState === 1,
          platformTempControl: p.platformTempCtrlState === 1,
          chamberTempControl: p.chamberTempCtrlState === 1,
          lightControl: p.lightCtrlState === 1,
        },
      };
    } finally {
      this.fn.freeDevProduct(out[0]);
    }
  }

  async getDetail(t: LanTarget, timeoutMs: number): Promise<FnetResult<PrinterTelemetry>> {
    const out: unknown[] = [null];
    const rc = await this.call<number>("getLanDevDetail", [t.ip, t.port, t.serialNumber, t.checkCode, out, timeoutMs], timeoutMs + 5000);
    if (rc !== 0 || !out[0]) return { code: rc || -1 };
    try {
      const d = this.koffi.decode(out[0], this.types.detail as never) as RawDetail;
      let slots: RawSlot[] = [];
      const st = d.matlStationInfo;
      if (d.hasMatlStation === 1 && st && st.slotInfos && st.slotCnt > 0 && st.slotCnt <= 16) {
        slots = this.koffi.decode(st.slotInfos, this.types.slot as never, st.slotCnt) as RawSlot[];
      }
      return { code: 0, value: normaliseDetail(d, slots) };
    } finally {
      this.fn.freeDevDetail(out[0]);
    }
  }

  async sendGcode(t: LanTarget, r: SendGcodeRequest, connectTimeoutMs: number): Promise<FnetResult<void>> {
    const data = {
      gcodeFilePath: r.filePath,
      thumbFilePath: null,
      gcodeDstName: r.dstName,
      printNow: r.printNow ? 1 : 0,
      levelingBeforePrint: r.levelingBeforePrint ? 1 : 0,
      flowCalibration: r.flowCalibration ? 1 : 0,
      firstLayerInspection: r.firstLayerInspection ? 1 : 0,
      timeLapseVideo: r.timeLapseVideo ? 1 : 0,
      useMatlStation: r.useMatlStation ? 1 : 0,
      gcodeToolCnt: r.materialMappings.length,
      materialMappings: r.materialMappings.length ? r.materialMappings : null,
      callback: null,
      callbackData: null,
    };
    // Uploads can be large; the library's timeout covers connecting, so allow generous transfer time.
    const rc = await this.call<number>("lanDevSendGcode", [t.ip, t.port, t.serialNumber, t.checkCode, data, connectTimeoutMs], 30 * 60 * 1000);
    return rc === 0 ? { code: 0, value: undefined } : { code: rc };
  }

  async ctrlJob(t: LanTarget, jobId: string, action: "pause" | "continue" | "cancel", timeoutMs: number): Promise<FnetResult<void>> {
    const rc = await this.call<number>("ctrlLanDevJob", [t.ip, t.port, t.serialNumber, t.checkCode, { jobId, action }, timeoutMs], timeoutMs + 5000);
    return rc === 0 ? { code: 0, value: undefined } : { code: rc };
  }

  async ctrlState(t: LanTarget, action: "setClearPlatform", timeoutMs: number): Promise<FnetResult<void>> {
    const rc = await this.call<number>("ctrlLanDevState", [t.ip, t.port, t.serialNumber, t.checkCode, { action }, timeoutMs], timeoutMs + 5000);
    return rc === 0 ? { code: 0, value: undefined } : { code: rc };
  }

  close() {
    this.fn.uninitlize();
  }
}

interface RawSlot {
  slotId: number;
  hasFilament: number;
  materialName: string | null;
  materialColor: string | null;
}

export interface RawDetail {
  pid: number;
  nozzleCnt: number;
  nozzleModel: string | null;
  firmwareVersion: string | null;
  macAddr: string | null;
  ipAddr: string | null;
  name: string | null;
  camera: number;
  status: string | null;
  jobId: string | null;
  printFileName: string | null;
  printLayer: number;
  targetPrintLayer: number;
  printProgress: number;
  rightTemp: number;
  rightTargetTemp: number;
  platTemp: number;
  platTargetTemp: number;
  chamberTemp: number;
  chamberTargetTemp: number;
  rightFilamentType: string | null;
  leftFilamentType: string | null;
  printDuration: number;
  estimatedTime: number;
  estimatedRightWeight: number;
  estimatedLeftWeight: number;
  hasRightFilament: number;
  hasLeftFilament: number;
  hasMatlStation: number;
  matlStationInfo: { slotCnt: number; currentSlot: number; currentLoadSlot: number; stateAction: number; stateStep: number; slotInfos: unknown } | null;
  indepMatlInfo: { stateAction: number; stateStep: number; materialName: string | null; materialColor: string | null } | null;
  doorStatus: string | null;
  lightStatus: string | null;
  remainingDiskSpace: number;
  cumulativePrintTime: number;
  cumulativeFilament: number;
  cameraStreamUrl: string | null;
  errorCode: string | null;
}

const str = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Converts the library's struct into PrintFlow's telemetry. Empty strings become null; nothing is invented. */
export function normaliseDetail(d: RawDetail, slots: RawSlot[]): PrinterTelemetry {
  const st = d.matlStationInfo;
  const station: MaterialStation | null =
    d.hasMatlStation === 1 && st
      ? {
          slotCount: st.slotCnt,
          currentSlot: num(st.currentSlot),
          currentLoadSlot: num(st.currentLoadSlot),
          stateAction: num(st.stateAction),
          slots: slots.map((s) => ({ slotId: s.slotId, hasFilament: s.hasFilament === 1, material: str(s.materialName), colour: str(s.materialColor) })),
        }
      : null;
  const indep = d.indepMatlInfo;
  const chamberReported = (d.chamberTemp ?? 0) !== 0 || (d.chamberTargetTemp ?? 0) !== 0;
  return {
    status: str(d.status),
    name: str(d.name),
    pid: num(d.pid),
    firmwareVersion: str(d.firmwareVersion),
    macAddress: str(d.macAddr),
    ipAddress: str(d.ipAddr),
    nozzleCount: num(d.nozzleCnt),
    nozzleModel: str(d.nozzleModel),
    camera: num(d.camera),
    cameraStreamUrl: str(d.cameraStreamUrl),
    jobId: str(d.jobId),
    printFileName: str(d.printFileName),
    printProgress: num(d.printProgress),
    printLayer: num(d.printLayer),
    targetPrintLayer: num(d.targetPrintLayer),
    printDuration: num(d.printDuration),
    estimatedTime: num(d.estimatedTime),
    nozzleTemp: num(d.rightTemp),
    nozzleTargetTemp: num(d.rightTargetTemp),
    bedTemp: num(d.platTemp),
    bedTargetTemp: num(d.platTargetTemp),
    chamberTemp: chamberReported ? num(d.chamberTemp) : null,
    chamberTargetTemp: chamberReported ? num(d.chamberTargetTemp) : null,
    rightFilamentType: str(d.rightFilamentType),
    leftFilamentType: str(d.leftFilamentType),
    hasRightFilament: d.hasRightFilament === 1,
    hasLeftFilament: d.nozzleCnt > 1 ? d.hasLeftFilament === 1 : null,
    estimatedRightWeight: num(d.estimatedRightWeight),
    estimatedLeftWeight: d.nozzleCnt > 1 ? num(d.estimatedLeftWeight) : null,
    hasMaterialStation: d.hasMatlStation === 1,
    materialStation: station,
    directFeed: indep && (str(indep.materialName) || str(indep.materialColor))
      ? { material: str(indep.materialName), colour: str(indep.materialColor), stateAction: num(indep.stateAction) }
      : null,
    doorStatus: str(d.doorStatus),
    lightStatus: str(d.lightStatus),
    remainingDiskSpaceGb: num(d.remainingDiskSpace),
    cumulativePrintMinutes: num(d.cumulativePrintTime),
    cumulativeFilamentMm: num(d.cumulativeFilament),
    errorCode: str(d.errorCode),
  };
}
