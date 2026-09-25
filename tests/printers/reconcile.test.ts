import { describe, expect, it } from "vitest";
import { OFFLINE_AFTER_FAILURES, evaluatePrinterReport, reconcileJob, telemetryMatchesJob } from "@/lib/printers/reconcile";
import { NOW, iso, job, printer, telemetry } from "./fixtures";

const ok = (t = telemetry()) => ({ printerId: "p1", reachable: true, latencyMs: 30, errorCode: null, error: null, telemetry: t });
const fail = (code: "UNREACHABLE" | "AUTH_FAILED" | "MISSING_CHECK_CODE" = "UNREACHABLE") => ({
  printerId: "p1",
  reachable: false,
  latencyMs: null,
  errorCode: code,
  error: "boom",
  telemetry: null,
});

describe("evaluatePrinterReport", () => {
  it("records a connection and stores telemetry", () => {
    const u = evaluatePrinterReport(printer({ connection_state: "waiting", status: "unknown" }), ok(), NOW, 90);
    expect(u.patch).toMatchObject({ connection_state: "connected", status: "idle", status_source: "integration", consecutive_failures: 0, raw_status: "ready" });
    expect(u.cameBack).toBe(true);
    expect(u.events.map((e) => e.type)).toEqual(["connected", "status_changed"]);
  });
  it("emits print lifecycle events from real state transitions only", () => {
    const start = evaluatePrinterReport(printer({ raw_status: "heating" }), ok(telemetry({ status: "printing", jobId: "7", printFileName: "a.gcode" })), NOW, 90);
    expect(start.events.map((e) => e.type)).toContain("print_started");
    const pause = evaluatePrinterReport(printer({ raw_status: "printing", status: "printing" }), ok(telemetry({ status: "pause", jobId: "7" })), NOW, 90);
    expect(pause.events.map((e) => e.type)).toContain("print_paused");
    const resume = evaluatePrinterReport(printer({ raw_status: "pause", status: "paused" }), ok(telemetry({ status: "printing", jobId: "7" })), NOW, 90);
    expect(resume.events.map((e) => e.type)).toContain("print_resumed");
    const done = evaluatePrinterReport(printer({ raw_status: "printing", status: "printing" }), ok(telemetry({ status: "completed", jobId: "7" })), NOW, 90);
    expect(done.events.map((e) => e.type)).toContain("print_completed");
    const stop = evaluatePrinterReport(printer({ raw_status: "printing", status: "printing" }), ok(telemetry({ status: "cancel" })), NOW, 90);
    expect(stop.events.map((e) => e.type)).toContain("print_stopped");
    const err = evaluatePrinterReport(printer({ raw_status: "printing", status: "printing" }), ok(telemetry({ status: "error", errorCode: "E7" })), NOW, 90);
    expect(err.events.find((e) => e.type === "print_failed")?.data).toMatchObject({ errorCode: "E7" });
    const same = evaluatePrinterReport(printer({ raw_status: "printing", status: "printing" }), ok(telemetry({ status: "printing" })), NOW, 90);
    expect(same.events).toEqual([]);
  });
  it("flags firmware changes but never acts on them", () => {
    const u = evaluatePrinterReport(printer({ firmware_version: "1.1.6" }), ok(), NOW, 90);
    expect(u.events.find((e) => e.type === "firmware_changed")).toMatchObject({ from: "1.1.6", to: "1.1.7" });
    expect(u.patch.firmware_version).toBe("1.1.7");
  });
  it("does not mark a printer offline after one failed request", () => {
    const u = evaluatePrinterReport(printer({ last_seen_at: iso(500) }), fail(), NOW, 90);
    expect(u.patch.connection_state).toBe("unreachable");
    expect(u.patch.status).toBeUndefined();
    expect(u.wentOffline).toBe(false);
  });
  it("does not mark it offline while the last good status is recent, even after many failures", () => {
    const u = evaluatePrinterReport(printer({ consecutive_failures: 10, last_seen_at: iso(30) }), fail(), NOW, 90);
    expect(u.wentOffline).toBe(false);
  });
  it("marks offline after repeated failures AND the time threshold", () => {
    const u = evaluatePrinterReport(printer({ consecutive_failures: OFFLINE_AFTER_FAILURES - 1, last_seen_at: iso(120) }), fail(), NOW, 90);
    expect(u.patch).toMatchObject({ connection_state: "offline", status: "offline" });
    expect(u.wentOffline).toBe(true);
    expect(u.events[0].type).toBe("disconnected");
    const again = evaluatePrinterReport(printer({ connection_state: "offline", status: "offline", consecutive_failures: 5, last_seen_at: iso(300) }), fail(), NOW, 90);
    expect(again.events).toEqual([]);
  });
  it("treats a rejected check code as a configuration problem, not offline", () => {
    const u = evaluatePrinterReport(printer(), fail("AUTH_FAILED"), NOW, 90);
    expect(u.patch).toMatchObject({ connection_state: "auth_failed", status: "unknown" });
    expect(u.events[0].type).toBe("error");
    expect(evaluatePrinterReport(printer(), fail("MISSING_CHECK_CODE"), NOW, 90).patch.connection_state).toBe("not_configured");
  });
});

describe("reconcileJob", () => {
  const printing = (over = {}) => telemetry({ status: "printing", jobId: "ff-9", printFileName: "PF-JOB-0042-Dragon.gcode", printProgress: 0.25, printDuration: 600, printLayer: 10, targetPrintLayer: 40, ...over });

  it("matches by the unique file name PrintFlow sent, then by printer job id", () => {
    expect(telemetryMatchesJob(job(), printing())).toBe(true);
    expect(telemetryMatchesJob(job({ external_printer_job_id: "ff-9" }), printing({ printFileName: "renamed.gcode" }))).toBe(true);
    expect(telemetryMatchesJob(job({ external_printer_job_id: "ff-1" }), printing())).toBe(false);
    expect(telemetryMatchesJob(job(), printing({ printFileName: "someone-else.gcode" }))).toBe(false);
  });

  it("moves a sent job to printing and records progress", () => {
    const u = reconcileJob(job({ status: "sent", sent_at: iso(30) }), printing(), NOW, 120);
    expect(u.transition).toBe("started");
    expect(u.patch).toMatchObject({ status: "printing", progress: 25, current_layer: 10, total_layers: 40, printer_elapsed_seconds: 600, remaining_seconds: 1800, external_printer_job_id: "ff-9" });
  });
  it("keeps a sent job queued while the printer heats up", () => {
    const u = reconcileJob(job({ status: "sent", sent_at: iso(30) }), printing({ status: "heating", printProgress: 0 }), NOW, 120);
    expect(u.transition).toBeNull();
    expect(u.patch.status).toBeUndefined();
    expect(u.patch.printer_status).toBe("heating");
  });
  it("follows pause and resume from the printer", () => {
    const paused = reconcileJob(job({ status: "printing", started_at: iso(600), last_resumed_at: iso(600) }), printing({ status: "pause" }), NOW, 120);
    expect(paused.transition).toBe("paused");
    expect(paused.patch).toMatchObject({ status: "paused", accumulated_minutes: 10, last_resumed_at: null });
    const resumed = reconcileJob(job({ status: "paused", started_at: iso(600) }), printing(), NOW, 120);
    expect(resumed.transition).toBe("resumed");
  });
  it("completes with the printer's own print time and asks for filament review", () => {
    const u = reconcileJob(job({ status: "printing", started_at: iso(4000) }), printing({ status: "completed", printProgress: 1, printDuration: 3720 }), NOW, 120);
    expect(u.transition).toBe("completed");
    expect(u.patch).toMatchObject({ status: "printed", actual_minutes: 62, progress: 100, remaining_seconds: 0, filament_recorded: false });
  });
  it("a print stopped at the printer fails the job and asks for a decision", () => {
    const u = reconcileJob(job({ status: "printing" }), printing({ status: "cancel" }), NOW, 120);
    expect(u.transition).toBe("stopped_at_printer");
    expect(u.patch.status).toBe("failed");
    expect(u.attention?.code).toBe("stopped_at_printer");
  });
  it("a printer error needs attention but doesn't fail the job", () => {
    const u = reconcileJob(job({ status: "printing" }), printing({ status: "error", errorCode: "E1" }), NOW, 120);
    expect(u.patch.status).toBeUndefined();
    expect(u.attention).toMatchObject({ code: "printer_error" });
    expect(reconcileJob(job({ status: "printing", attention_code: "printer_error", needs_attention: true }), printing({ status: "error" }), NOW, 120).attention).toBeNull();
  });
  it("clears an offline alert once the printer reports the print again", () => {
    const u = reconcileJob(job({ status: "printing", needs_attention: true, attention_code: "printer_offline" }), printing(), NOW, 120);
    expect(u.clearAttention).toBe(true);
    const keep = reconcileJob(job({ status: "failed", needs_attention: true, attention_code: "stopped_at_printer" }), printing(), NOW, 120);
    expect(keep.clearAttention).toBe(false);
  });
  it("fails a sent job the printer never started, but only after the timeout", () => {
    const idle = telemetry({ status: "ready" });
    expect(reconcileJob(job({ status: "sent", sent_at: iso(60) }), idle, NOW, 120).transition).toBeNull();
    const u = reconcileJob(job({ status: "sent", sent_at: iso(200) }), idle, NOW, 120);
    expect(u.transition).toBe("not_started");
    expect(u.attention?.code).toBe("not_started");
  });
  it("never auto-completes when it missed the finish", () => {
    const u = reconcileJob(job({ status: "printing" }), telemetry({ status: "ready" }), NOW, 120);
    expect(u.patch.status).toBeUndefined();
    expect(u.attention?.code).toBe("missed_completion");
  });
  it("flags a different file on the printer", () => {
    const u = reconcileJob(job({ status: "printing" }), printing({ printFileName: "other.gcode", jobId: "x" }), NOW, 120);
    expect(u.attention?.code).toBe("other_job");
    expect(u.patch.status).toBeUndefined();
  });
  it("ignores finished jobs", () => {
    const u = reconcileJob(job({ status: "printed" }), printing({ printFileName: "other.gcode" }), NOW, 120);
    expect(u.transition).toBeNull();
    expect(u.attention).toBeNull();
  });
});
