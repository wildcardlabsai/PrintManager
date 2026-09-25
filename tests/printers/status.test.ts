import { describe, expect, it } from "vitest";
import {
  connectionView,
  effectivePrinterStatus,
  estimateRemainingSeconds,
  fileKey,
  jobStage,
  mapFlashforgeStatus,
  rawPhase,
  rawStatusLabel,
} from "@/lib/printers/status";
import { NOW, iso, printer } from "./fixtures";

describe("Flashforge status mapping", () => {
  it("maps every documented printer state", () => {
    expect(mapFlashforgeStatus("ready")).toBe("idle");
    expect(mapFlashforgeStatus("completed")).toBe("idle");
    expect(mapFlashforgeStatus("printing")).toBe("printing");
    expect(mapFlashforgeStatus("heating", true)).toBe("printing");
    expect(mapFlashforgeStatus("heating", false)).toBe("online");
    expect(mapFlashforgeStatus("busy")).toBe("online");
    expect(mapFlashforgeStatus("calibrate_doing")).toBe("online");
    expect(mapFlashforgeStatus("pausing")).toBe("paused");
    expect(mapFlashforgeStatus("pause")).toBe("paused");
    expect(mapFlashforgeStatus("canceling")).toBe("online");
    expect(mapFlashforgeStatus("cancel")).toBe("online");
    expect(mapFlashforgeStatus("error")).toBe("error");
  });
  it("never guesses an unknown state", () => {
    expect(mapFlashforgeStatus("something_new")).toBe("unknown");
    expect(mapFlashforgeStatus(null)).toBe("unknown");
    expect(rawPhase(undefined)).toBe("unknown");
    expect(rawStatusLabel(null)).toBe("Not available");
  });
});

describe("connection freshness", () => {
  it("manual printers are never live", () => {
    expect(connectionView(printer({ connection_mode: "manual" }), NOW, 90).key).toBe("manual");
  });
  it("needs an agent and serial number", () => {
    expect(connectionView(printer({ agent_id: null }), NOW, 90).key).toBe("not_configured");
    expect(connectionView(printer({ serial_number: null }), NOW, 90).key).toBe("not_configured");
  });
  it("waits for the first report", () => {
    expect(connectionView(printer({ last_heartbeat_at: null, last_seen_at: null }), NOW, 90).key).toBe("waiting");
  });
  it("is live with fresh telemetry, labelled when simulated", () => {
    expect(connectionView(printer(), NOW, 90)).toMatchObject({ key: "live", live: true, label: "Live" });
    expect(connectionView(printer({ telemetry_source: "mock" }), NOW, 90)).toMatchObject({ live: true, label: "Live (simulated)" });
  });
  it("goes offline when the agent stops reporting", () => {
    const p = printer({ last_heartbeat_at: iso(200), last_seen_at: iso(200) });
    expect(connectionView(p, NOW, 90).key).toBe("offline");
    expect(effectivePrinterStatus({ ...p, status: "printing" }, NOW, 90)).toBe("offline");
  });
  it("is stale (not live) when the agent reports but the printer hasn't answered", () => {
    const p = printer({ last_heartbeat_at: iso(5), last_seen_at: iso(300) });
    expect(connectionView(p, NOW, 90)).toMatchObject({ key: "stale", live: false });
  });
  it("reports unreachable / auth failures without inventing a status", () => {
    expect(connectionView(printer({ connection_state: "unreachable" }), NOW, 90).live).toBe(false);
    expect(connectionView(printer({ connection_state: "auth_failed" }), NOW, 90).key).toBe("auth_failed");
    expect(effectivePrinterStatus(printer({ connection_state: "auth_failed", status: "idle" }), NOW, 90)).toBe("unknown");
  });
});

describe("remaining time", () => {
  it("derives from printer progress and elapsed time", () => {
    expect(estimateRemainingSeconds(0.5, 1800)).toBe(1800);
    expect(estimateRemainingSeconds(0.25, 600)).toBe(1800);
    expect(estimateRemainingSeconds(1, 3600)).toBe(0);
  });
  it("is not available until there is meaningful progress", () => {
    expect(estimateRemainingSeconds(0.01, 60)).toBeNull();
    expect(estimateRemainingSeconds(null, 60)).toBeNull();
    expect(estimateRemainingSeconds(0.5, null)).toBeNull();
  });
});

describe("job stages", () => {
  it("covers the pipeline", () => {
    expect(jobStage({ status: "queued", printer_id: null, print_file_id: null })).toBe("AWAITING_PRINT");
    expect(jobStage({ status: "queued", printer_id: "p", print_file_id: null })).toBe("ASSIGNED");
    expect(jobStage({ status: "queued", printer_id: "p", print_file_id: "f" })).toBe("READY");
    expect(jobStage({ status: "sending", printer_id: "p", print_file_id: "f" })).toBe("SENDING");
    expect(jobStage({ status: "sent", printer_id: "p", print_file_id: "f" })).toBe("QUEUED");
    expect(jobStage({ status: "printing", printer_id: "p", print_file_id: "f" })).toBe("PRINTING");
    expect(jobStage({ status: "paused", printer_id: "p", print_file_id: "f" })).toBe("PAUSED");
    expect(jobStage({ status: "printed", printer_id: "p", print_file_id: "f" })).toBe("COMPLETED");
    expect(jobStage({ status: "failed", printer_id: "p", print_file_id: "f" })).toBe("FAILED");
    expect(jobStage({ status: "cancelled", printer_id: "p", print_file_id: "f" })).toBe("CANCELLED");
  });
});

describe("file matching key", () => {
  it("ignores paths, case and extensions", () => {
    expect(fileKey("/data/user/PF-JOB-0042-Dragon.gcode")).toBe("pf-job-0042-dragon");
    expect(fileKey("PF-JOB-0042-Dragon.gcode.3mf")).toBe("pf-job-0042-dragon");
    expect(fileKey("PF-JOB-0042-Dragon.3mf")).toBe("pf-job-0042-dragon");
    expect(fileKey(null)).toBeNull();
  });
});
