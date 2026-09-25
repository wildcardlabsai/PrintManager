import { describe, expect, it } from "vitest";
import { autoDispatchEligibility, checkDispatch, suggestMappings, type DispatchFile, type DispatchInput } from "@/lib/printers/dispatch";
import { NOW, iso, printer, telemetry } from "./fixtures";

const file = (over: Partial<DispatchFile> = {}): DispatchFile => ({
  id: "f1",
  name: "Dragon AD5X",
  compatible_models: ["AD5X"],
  multi_colour: false,
  ifs_required: false,
  colour_channels: 1,
  material: "PLA",
  colour: "#FFFFFF",
  verified_at: iso(86400),
  archived_at: null,
  filament_assignments: [],
  ...over,
});

const input = (over: Partial<DispatchInput> = {}): DispatchInput => ({
  printer: printer(),
  agentActive: true,
  job: { status: "queued", colour: "#FFFFFF", material: "PLA" },
  order: { status: "awaiting_print", payment_status: "paid" },
  file: file(),
  printerBusy: false,
  materialMappings: [],
  now: NOW,
  offlineAfterSeconds: 90,
  ...over,
});

const station = telemetry({
  hasMaterialStation: true,
  materialStation: {
    slotCount: 4,
    currentSlot: 1,
    currentLoadSlot: 1,
    stateAction: 0,
    slots: [
      { slotId: 1, hasFilament: true, material: "PLA", colour: "#FFFFFF" },
      { slotId: 2, hasFilament: true, material: "PLA", colour: "#000000" },
      { slotId: 3, hasFilament: true, material: "PLA", colour: "#FF0000" },
      { slotId: 4, hasFilament: false, material: null, colour: null },
    ],
  },
});

describe("checkDispatch", () => {
  it("passes a clean single-colour send", () => {
    expect(checkDispatch(input())).toEqual({ blockers: [], warnings: [] });
  });
  it("refuses manual printers and unsupported models", () => {
    expect(checkDispatch(input({ printer: printer({ connection_mode: "manual" }) })).blockers[0]).toMatch(/isn't connected/);
    expect(checkDispatch(input({ printer: printer({ model: "Creator 4" }) })).blockers.join()).toMatch(/AD5X or Adventurer 5M/);
  });
  it("requires the live checklist for production (not for the test print)", () => {
    const unverified = input({ printer: printer({ live_verified_at: null }) });
    expect(checkDispatch(unverified).blockers.join()).toMatch(/checklist/);
    expect(checkDispatch({ ...unverified, testPrint: true, job: null, order: null }).blockers).toEqual([]);
  });
  it("refuses offline, busy, unready or uncleared printers", () => {
    expect(checkDispatch(input({ printer: printer({ last_heartbeat_at: iso(500), last_seen_at: iso(500) }) })).blockers.join()).toMatch(/offline/i);
    expect(checkDispatch(input({ printer: printer({ raw_status: "printing" }) })).blockers.join()).toMatch(/printing, not ready/);
    expect(checkDispatch(input({ printer: printer({ raw_status: "completed" }) })).blockers.join()).toMatch(/finished print/);
    expect(checkDispatch(input({ printer: printer({ bed_clear: false }) })).blockers.join()).toMatch(/build plate/);
    expect(checkDispatch(input({ printerBusy: true })).blockers.join()).toMatch(/already has a print/);
    expect(checkDispatch(input({ agentActive: false })).blockers.join()).toMatch(/Printer Agent/);
  });
  it("refuses jobs that aren't waiting and orders on hold", () => {
    expect(checkDispatch(input({ job: { status: "printing", colour: null, material: null } })).blockers.join()).toMatch(/awaiting print/);
    expect(checkDispatch(input({ order: { status: "on_hold", payment_status: "paid" } })).blockers.join()).toMatch(/on hold/);
  });
  it("needs a file sliced for this printer model", () => {
    expect(checkDispatch(input({ file: null })).blockers.join()).toMatch(/Choose a sliced print file/);
    expect(checkDispatch(input({ file: file({ compatible_models: ["Adventurer 5M"] }) })).blockers.join()).toMatch(/isn't marked as sliced for the Flashforge AD5X/);
  });
  it("won't send multi-colour files to the Adventurer 5M", () => {
    const r = checkDispatch(input({ printer: printer({ model: "Adventurer 5M" }), file: file({ compatible_models: ["Adventurer 5M"], multi_colour: true, colour_channels: 2 }) }));
    expect(r.blockers.join()).toMatch(/can't print multi-colour/);
  });
  it("requires a complete IFS mapping to loaded slots", () => {
    const ifs = file({ multi_colour: true, ifs_required: true, colour_channels: 2 });
    const p = printer({ telemetry: station });
    expect(checkDispatch(input({ printer: p, file: ifs })).blockers.join()).toMatch(/Map all 2 colours/);
    const empty = [
      { toolId: 0, slotId: 1, materialName: "PLA", toolMaterialColor: "#FFFFFF", slotMaterialColor: "#FFFFFF" },
      { toolId: 1, slotId: 4, materialName: "PLA", toolMaterialColor: "#000000", slotMaterialColor: "" },
    ];
    expect(checkDispatch(input({ printer: p, file: ifs, materialMappings: empty })).blockers.join()).toMatch(/slot 4 is empty/);
    const good = [empty[0], { ...empty[1], slotId: 2 }];
    expect(checkDispatch(input({ printer: p, file: ifs, materialMappings: good })).blockers).toEqual([]);
  });
  it("warns (never silently passes) on filament mismatches and unproven files", () => {
    const r = checkDispatch(input({ printer: printer({ telemetry: telemetry({ directFeed: { material: "PETG", colour: "#000000", stateAction: 0 } }) }), file: file({ verified_at: null }) }));
    expect(r.blockers).toEqual([]);
    expect(r.warnings.join("\n")).toMatch(/expects PLA but the printer reports PETG/);
    expect(r.warnings.join("\n")).toMatch(/colour/);
    expect(r.warnings.join("\n")).toMatch(/hasn't been printed successfully/);
    expect(checkDispatch(input({ printer: printer({ telemetry_source: "mock" }) })).warnings.join()).toMatch(/simulated/);
  });
});

describe("firmware warnings", () => {
  it("warns when firmware is unknown or changed since verification", () => {
    expect(checkDispatch(input({ printer: printer({ firmware_version: null }) })).warnings.join()).toMatch(/hasn't reported its firmware/);
    const verified = { firmware: { at: iso(1000), by: null, source: "flashforge_lan" as const, note: "1.1.6" } };
    expect(checkDispatch(input({ printer: printer({ live_checklist: verified }) })).warnings.join()).toMatch(/Firmware changed from 1.1.6/);
    expect(checkDispatch(input({ printer: printer({ live_checklist: { ...verified, firmware: { ...verified.firmware, note: "1.1.7" } } }) })).warnings).toEqual([]);
  });
});

describe("suggestMappings", () => {
  it("maps only when every colour has exactly one loaded match", () => {
    const f = { colour_channels: 2, filament_assignments: [
      { channel: 1, material: "PLA", colour: "#ff0000" },
      { channel: 2, material: "PLA", colour: "#FFFFFF" },
    ] };
    expect(suggestMappings(f, station)).toEqual([
      { toolId: 0, slotId: 3, materialName: "PLA", toolMaterialColor: "#ff0000", slotMaterialColor: "#FF0000" },
      { toolId: 1, slotId: 1, materialName: "PLA", toolMaterialColor: "#FFFFFF", slotMaterialColor: "#FFFFFF" },
    ]);
    expect(suggestMappings({ ...f, filament_assignments: [f.filament_assignments[0], { channel: 2, material: "PLA", colour: "#00FF00" }] }, station)).toBeNull();
  });
});

describe("autoDispatchEligibility", () => {
  const auto = (over: Partial<Parameters<typeof autoDispatchEligibility>[0]> = {}) =>
    autoDispatchEligibility({ ...input(), autoPrintEnabled: true, jobAssignedPrinterId: "p1", attempts: 1, needsAttention: false, ...over });

  it("is eligible only when everything lines up", () => {
    expect(auto()).toEqual({ eligible: true, reasons: [] });
  });
  it("is off by default and strict about every condition", () => {
    expect(auto({ autoPrintEnabled: false }).eligible).toBe(false);
    expect(auto({ jobAssignedPrinterId: null }).reasons.join()).toMatch(/assigned to this printer by a person/);
    expect(auto({ file: file({ verified_at: null }) }).reasons.join()).toMatch(/proven/);
    expect(auto({ file: file({ multi_colour: true, colour_channels: 2 }) }).reasons.join()).toMatch(/Multi-colour/);
    expect(auto({ order: { status: "awaiting_print", payment_status: "pending" } }).reasons.join()).toMatch(/paid/);
    expect(auto({ attempts: 2 }).reasons.join()).toMatch(/Retries/);
    expect(auto({ needsAttention: true }).eligible).toBe(false);
    expect(auto({ printer: printer({ telemetry_source: "mock" }) }).eligible).toBe(false);
    expect(auto({ printer: printer({ bed_clear: false }) }).eligible).toBe(false);
    expect(auto({ printer: printer({ telemetry: telemetry({ directFeed: null, rightFilamentType: null }) }) }).reasons.join()).toMatch(/Loaded filament must match/);
  });
});
