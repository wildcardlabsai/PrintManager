import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createFlashforgeIntegration } from "../../agent/src/flashforge/adapter";
import { MockPrinterFleet, MockTransport } from "../../agent/src/flashforge/mock";
import type { PrinterIntegration } from "../../agent/src/integration";

/**
 * MockPrinterIntegration: the real Flashforge adapters driven by a simulated
 * printer. Covers the lifecycle required before connecting physical printers.
 */
const SERIAL = "SNMOCK0001";
const CODE = "12345678";
const target = { ip: "127.0.0.1", port: 8899, serialNumber: SERIAL, checkCode: CODE };
const file = path.join(os.tmpdir(), "printflow-mock-test.gcode");
fs.writeFileSync(file, "G28\n");
const send = (over = {}) => ({
  filePath: file,
  fileName: "PF-JOB-0001-Test.gcode",
  levelingBeforePrint: true,
  flowCalibration: false,
  firstLayerInspection: false,
  timeLapseVideo: false,
  useMaterialStation: false,
  materialMappings: [],
  ...over,
});

let fleet: MockPrinterFleet;
let clock: number;
let ad5x: PrinterIntegration;

beforeEach(() => {
  clock = Date.now();
  fleet = new MockPrinterFleet([{ serialNumber: SERIAL, checkCode: CODE, model: "AD5X" }], { speed: 1, printSeconds: 100, heatingSeconds: 3 });
  const transport = new MockTransport(fleet);
  // Drive the simulator's clock by hand.
  const tick = fleet.tick.bind(fleet);
  fleet.tick = () => tick(clock);
  (fleet as unknown as { lastTick: number }).lastTick = clock;
  ad5x = createFlashforgeIntegration("AD5X", transport, target);
});
const advance = (s: number) => (clock += s * 1000);

describe("MockPrinterIntegration", () => {
  it("connects, reports status, disconnects", async () => {
    const c = await ad5x.connect();
    expect(c.ok && c.value.firmwareVersion).toBe("mock-1.0.0");
    expect((await ad5x.getStatus()).ok && (await ad5x.getStatus())).toMatchObject({ value: "ready" });
    expect((await ad5x.disconnect()).ok).toBe(true);
  });

  it("rejects a wrong check code", async () => {
    const bad = createFlashforgeIntegration("AD5X", new MockTransport(fleet), { ...target, checkCode: "nope" });
    const r = await bad.connect();
    expect(r).toMatchObject({ ok: false, code: "AUTH_FAILED" });
  });

  it("sends a job, starts, reports progress and completes", async () => {
    expect((await ad5x.sendPrintJob(send())).ok).toBe(true);
    expect(await ad5x.getCurrentJob()).toMatchObject({ ok: true, value: { status: "heating", fileName: "PF-JOB-0001-Test.gcode" } });
    advance(4);
    expect(await ad5x.getStatus()).toMatchObject({ value: "printing" });
    advance(50);
    const p = await ad5x.getProgress();
    expect(p.ok && p.value.fraction).toBeGreaterThan(0.4);
    advance(100);
    expect(await ad5x.getStatus()).toMatchObject({ value: "completed" });
    // A finished print blocks the next send until the plate is cleared.
    expect(await ad5x.sendPrintJob(send())).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect((await ad5x.clearPlatform()).ok).toBe(true);
    expect(await ad5x.getStatus()).toMatchObject({ value: "ready" });
  });

  it("pauses, resumes and stops only the expected job", async () => {
    await ad5x.sendPrintJob(send());
    advance(5);
    const job = await ad5x.getCurrentJob();
    const jobId = job.ok ? job.value.jobId! : "";
    expect(await ad5x.pausePrint("some-other-job")).toMatchObject({ ok: false, code: "JOB_MISMATCH" });
    expect((await ad5x.pausePrint(jobId)).ok).toBe(true);
    advance(1);
    expect(await ad5x.getStatus()).toMatchObject({ value: "pause" });
    expect(await ad5x.pausePrint(jobId)).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect((await ad5x.resumePrint(jobId)).ok).toBe(true);
    expect(await ad5x.getStatus()).toMatchObject({ value: "printing" });
    expect((await ad5x.stopPrint(jobId)).ok).toBe(true);
    advance(1);
    expect(await ad5x.getStatus()).toMatchObject({ value: "cancel" });
    advance(1);
    expect(await ad5x.getStatus()).toMatchObject({ value: "ready" });
  });

  it("refuses to start on a busy printer", async () => {
    await ad5x.sendPrintJob(send());
    expect(await ad5x.sendPrintJob(send())).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("reports a printer failure through status and errors", async () => {
    await ad5x.sendPrintJob(send());
    fleet.control(SERIAL, "error");
    expect(await ad5x.getStatus()).toMatchObject({ value: "error" });
    expect(await ad5x.getErrors()).toMatchObject({ ok: true, value: [{ code: "E0001" }] });
  });

  it("goes offline and reconnects", async () => {
    fleet.control(SERIAL, "offline");
    expect(await ad5x.getTelemetry()).toMatchObject({ ok: false, code: "UNREACHABLE" });
    fleet.control(SERIAL, "online");
    expect((await ad5x.connect()).ok).toBe(true);
  });

  it("surfaces a failed upload as an error, never success", async () => {
    fleet.control(SERIAL, "fail_next_send");
    expect(await ad5x.sendPrintJob(send())).toMatchObject({ ok: false, code: "UNREACHABLE" });
    expect(await ad5x.getStatus()).toMatchObject({ value: "ready" });
  });

  it("passes IFS mappings only when the file uses the material station", async () => {
    const mappings = [{ toolId: 0, slotId: 3, materialName: "PLA", toolMaterialColor: "#FF0000", slotMaterialColor: "#FF0000" }];
    expect(await ad5x.sendPrintJob(send({ useMaterialStation: true, materialMappings: [] }))).toMatchObject({ ok: false });
    expect(await ad5x.sendPrintJob(send({ useMaterialStation: true, materialMappings: [{ ...mappings[0], slotId: 9 }] }))).toMatchObject({ ok: false });
    expect((await ad5x.sendPrintJob(send({ useMaterialStation: true, materialMappings: mappings }))).ok).toBe(true);
    expect(fleet.snapshot(SERIAL)!.lastSend).toMatchObject({ useMatlStation: true, materialMappings: mappings });
  });

  it("has no printer-side queue: PrintFlow keeps the queue", () => {
    expect(ad5x.getCapabilities().find((c) => c.key === "printer_queue")?.support).toBe("not_supported");
  });

  it("returns NOT_SUPPORTED for what the printer can't do", async () => {
    expect(await ad5x.switchColour()).toMatchObject({ ok: false, code: "NOT_SUPPORTED" });
    expect(await ad5x.getActualFilamentUsage()).toMatchObject({ ok: false, code: "NOT_SUPPORTED" });
    expect(await ad5x.updateFirmware()).toMatchObject({ ok: false, code: "NOT_SUPPORTED" });
    const m5 = createFlashforgeIntegration("ADVENTURER_5M", new MockTransport(fleet), target);
    expect(await m5.sendPrintJob(send({ useMaterialStation: true }))).toMatchObject({ ok: false, code: "NOT_SUPPORTED" });
    expect(m5.getCapabilities().find((c) => c.key === "material_station")?.support).toBe("not_supported");
  });
});
