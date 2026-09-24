import { describe, expect, it } from "vitest";
import { dayKey, eachDayKey, resolveReportRange, todayRange } from "@/lib/domain/dates";

describe("timezone-aware ranges", () => {
  it("uses the business timezone for 'today' (BST)", () => {
    // 23:30 UTC on 1 July is 00:30 on 2 July in London.
    const now = new Date("2026-07-01T23:30:00Z");
    const r = todayRange("Europe/London", now);
    expect(r.from.toISOString()).toBe("2026-07-01T23:00:00.000Z");
    expect(dayKey(now, "Europe/London")).toBe("2026-07-02");
  });

  it("builds last month and day keys", () => {
    const now = new Date("2026-03-15T12:00:00Z");
    const r = resolveReportRange("last_month", "Europe/London", undefined, now);
    expect(eachDayKey(r, "Europe/London")).toHaveLength(28);
    const seven = resolveReportRange("7d", "Europe/London", undefined, now);
    expect(eachDayKey(seven, "Europe/London")).toHaveLength(7);
  });

  it("falls back when a custom range is invalid", () => {
    const now = new Date("2026-03-15T12:00:00Z");
    const r = resolveReportRange("custom", "Europe/London", { from: "2026-03-10", to: "2026-03-01" }, now);
    expect(eachDayKey(r, "Europe/London")).toHaveLength(30);
  });
});
