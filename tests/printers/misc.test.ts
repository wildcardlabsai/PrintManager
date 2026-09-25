import { describe, expect, it } from "vitest";
import { suggestPrinters } from "@/lib/printers/assignment";
import { applyObservations, checklistComplete, checklistFromRealPrinter, dropSimulated, LIVE_CHECKLIST } from "@/lib/printers/checklist";
import { can, ROLE_PERMISSIONS } from "@/lib/printers/permissions";
import { computePrinterStats, offlineDuration } from "@/lib/printers/stats";
import { NOW, iso, job, printer, telemetry } from "./fixtures";

describe("permissions", () => {
  it("viewer monitors only", () => {
    expect(can("viewer", "view")).toBe(true);
    expect(can("viewer", "operate_printers")).toBe(false);
    expect(can("viewer", "manage_production")).toBe(false);
  });
  it("operator runs production but can't configure", () => {
    expect(can("staff", "operate_printers")).toBe(true);
    expect(can("staff", "configure_printers")).toBe(false);
    expect(can("staff", "manage_agents")).toBe(false);
  });
  it("admin configures; only the owner manages the team", () => {
    expect(can("admin", "configure_printers")).toBe(true);
    expect(can("admin", "manage_agents")).toBe(true);
    expect(can("admin", "manage_team")).toBe(false);
    expect(ROLE_PERMISSIONS.owner).toContain("manage_team");
    expect(can(null, "view")).toBe(false);
  });
});

describe("live checklist", () => {
  it("ticks observed steps and never the confirm-only ones", () => {
    const c = applyObservations({}, { connected: true, status: true, firmware: "1.1.7", capabilities: true, printing: true }, "flashforge_lan", NOW.toISOString())!;
    expect(Object.keys(c).sort()).toEqual(["capabilities", "connect", "firmware", "read_status"]);
    expect(c.firmware?.note).toBe("1.1.7");
    // printing before any test print doesn't count
    expect(c.status_during_print).toBeUndefined();
  });
  it("counts print observations after a test print", () => {
    const c = applyObservations({ test_print: { at: iso(60), by: null, source: "flashforge_lan" } }, { printing: true, progress: true, completed: true }, "flashforge_lan", NOW.toISOString())!;
    expect(c.status_during_print && c.progress && c.completion).toBeTruthy();
  });
  it("replaces simulated ticks with real ones and can drop them", () => {
    const sim = applyObservations({}, { connected: true }, "mock", iso(10))!;
    expect(sim.connect?.source).toBe("mock");
    expect(applyObservations(sim, { connected: true }, "mock", NOW.toISOString())).toBeNull();
    expect(applyObservations(sim, { connected: true }, "flashforge_lan", NOW.toISOString())!.connect?.source).toBe("flashforge_lan");
    expect(dropSimulated(sim)).toEqual({});
  });
  it("is complete only with every step, and 'real' only without simulated ones", () => {
    const all = Object.fromEntries(LIVE_CHECKLIST.map((s) => [s.key, { at: iso(1), by: null, source: "user" as const }]));
    expect(checklistComplete(all)).toBe(true);
    expect(checklistFromRealPrinter(all)).toBe(true);
    expect(checklistFromRealPrinter({ ...all, connect: { at: iso(1), by: null, source: "mock" } })).toBe(false);
    expect(checklistComplete({ ...all, job_update: undefined })).toBe(false);
  });
});

describe("printer suggestions", () => {
  const files = [
    { id: "f1", compatible_models: ["AD5X"], multi_colour: false, ifs_required: false, material: "PLA", colour: "#FFFFFF", verified_at: iso(1000), archived_at: null },
  ];
  const base = { status: "idle", queued: 0, busy: false };
  it("prefers an idle, compatible printer with the right filament and never picks for you", () => {
    const res = suggestPrinters(job(), files, [
      { ...printer({ id: "ad5x", name: "AD5X" }), ...base },
      { ...printer({ id: "m5", name: "5M", model: "Adventurer 5M" }), ...base },
    ], { now: NOW, offlineAfterSeconds: 90 });
    expect(res[0]).toMatchObject({ printerId: "ad5x", compatible: true });
    expect(res[0].reasons).toEqual(expect.arrayContaining(["Idle now", "PLA loaded", "Colour matches"]));
    expect(res[1]).toMatchObject({ printerId: "m5", compatible: false });
  });
  it("marks multi-colour jobs incompatible with single-extruder printers and explains busy printers", () => {
    const res = suggestPrinters(job({ multi_colour: true }), [], [
      { ...printer({ id: "m5", name: "5M", model: "Adventurer 5M" }), ...base },
      { ...printer({ id: "ad5x", raw_status: "printing" }), ...base, busy: true, queued: 2 },
    ], { now: NOW, offlineAfterSeconds: 90 });
    expect(res.find((s) => s.printerId === "m5")?.compatible).toBe(false);
    const ad = res.find((s) => s.printerId === "ad5x")!;
    expect(ad.compatible).toBe(true);
    expect(ad.concerns.join()).toMatch(/Busy.*2 jobs already waiting/);
  });
  it("uses filament reported by the printer", () => {
    const res = suggestPrinters(job({ material: "PETG" }), files, [{ ...printer({ telemetry: telemetry() }), ...base }], { now: NOW, offlineAfterSeconds: 90 });
    expect(res[0].concerns.join()).toMatch(/PLA loaded, job needs PETG/);
  });
});

describe("printer statistics", () => {
  const range = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-11T00:00:00Z") };
  const jobs = [
    { id: "a", printer_id: "p1", status: "printed" as const, started_at: null, completed_at: "2026-09-02T10:00:00Z", failed_at: null, actual_minutes: 120, accumulated_minutes: 120 },
    { id: "b", printer_id: "p1", status: "printed" as const, started_at: null, completed_at: "2026-09-03T10:00:00Z", failed_at: null, actual_minutes: 60, accumulated_minutes: 60 },
    { id: "c", printer_id: "p1", status: "failed" as const, started_at: null, completed_at: null, failed_at: "2026-09-04T10:00:00Z", actual_minutes: null, accumulated_minutes: 30 },
    { id: "d", printer_id: "p1", status: "printed" as const, started_at: null, completed_at: "2026-10-04T10:00:00Z", failed_at: null, actual_minutes: 999, accumulated_minutes: 999 },
    { id: "e", printer_id: "p2", status: "printed" as const, started_at: null, completed_at: "2026-09-04T10:00:00Z", failed_at: null, actual_minutes: 50, accumulated_minutes: 50 },
  ];
  it("computes utilisation, success rate, filament and averages from recorded jobs", () => {
    const s = computePrinterStats("p1", jobs, new Map([["a", 40], ["c", 5]]), null, range, { connected: false, connectedSince: null });
    expect(s).toMatchObject({ completed: 2, failed: 1, printHours: 3.5, filamentGrams: 45, averageMinutes: 90, idleHours: null, offlineHours: null });
    expect(s.successRate).toBeCloseTo(2 / 3);
    expect(s.utilisation).toBeCloseTo(3.5 / 240);
  });
  it("only derives idle/offline time when connection history covers the range", () => {
    const events = [
      { printer_id: "p1", type: "connected" as const, created_at: "2026-08-20T00:00:00Z" },
      { printer_id: "p1", type: "disconnected" as const, created_at: "2026-09-05T00:00:00Z" },
      { printer_id: "p1", type: "connected" as const, created_at: "2026-09-05T12:00:00Z" },
    ];
    const s = computePrinterStats("p1", jobs, new Map(), events, range, { connected: true, connectedSince: new Date("2026-08-20T00:00:00Z") });
    expect(s.offlineHours).toBe(12);
    expect(s.idleHours).toBe(240 - 3.5 - 12);
    const partial = computePrinterStats("p1", jobs, new Map(), events, range, { connected: true, connectedSince: new Date("2026-09-03T00:00:00Z") });
    expect(partial.idleHours).toBeNull();
  });
  it("counts an ongoing outage to the end of the range and one that began earlier from the start", () => {
    expect(offlineDuration([{ printer_id: "p1", type: "disconnected", created_at: "2026-09-10T00:00:00Z" }], range)).toBe(86400000);
    expect(offlineDuration([{ printer_id: "p1", type: "disconnected", created_at: "2026-08-30T00:00:00Z" }, { printer_id: "p1", type: "connected", created_at: "2026-09-01T06:00:00Z" }], range)).toBe(6 * 3600000);
  });
});
