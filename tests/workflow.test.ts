import { describe, expect, it } from "vitest";
import { allowedOrderTransitions, canTransitionOrder, nextOrderActions, orderStatusSideEffects } from "@/lib/domain/order-workflow";
import {
  allowedJobActions,
  compareQueue,
  deriveProductionStatus,
  elapsedPrintMinutes,
  orderStatusAfterJobChange,
} from "@/lib/domain/production";
import { formatOrderNumber } from "@/lib/domain/order-number";
import { matchSku } from "@/lib/domain/sku-matching";

describe("order workflow", () => {
  it("closes completed and cancelled orders", () => {
    expect(allowedOrderTransitions("completed")).toEqual([]);
    expect(allowedOrderTransitions("cancelled")).toEqual([]);
    expect(canTransitionOrder("new", "cancelled")).toBe(true);
    expect(canTransitionOrder("on_hold", "on_hold")).toBe(false);
  });

  it("suggests only actions that make sense", () => {
    expect(nextOrderActions({ status: "new", jobs: [{ status: "queued" }], hasTracking: false })).toEqual(["confirm", "start_production"]);
    expect(nextOrderActions({ status: "printing", jobs: [{ status: "printing" }], hasTracking: false })).toEqual([]);
    expect(nextOrderActions({ status: "printed", jobs: [{ status: "printed" }], hasTracking: false })).toEqual(["pack"]);
    expect(nextOrderActions({ status: "ready_to_ship", jobs: [], hasTracking: true })).toEqual(["mark_shipped"]);
    expect(nextOrderActions({ status: "ready_to_ship", jobs: [], hasTracking: false })).toEqual(["mark_shipped", "add_tracking"]);
  });

  it("applies packing and shipping side effects", () => {
    expect(orderStatusSideEffects("ready_to_ship")).toEqual({ packing_status: "packed", shipping_status: "ready" });
    expect(orderStatusSideEffects("shipped").setShippedAt).toBe(true);
  });
});

describe("production", () => {
  it("limits job actions by status", () => {
    expect(allowedJobActions("queued")).toEqual(["start", "cancel"]);
    expect(allowedJobActions("printed")).toEqual([]);
    expect(allowedJobActions("failed")).toContain("requeue");
  });

  it("derives order production status from jobs", () => {
    expect(deriveProductionStatus([])).toBe("not_started");
    expect(deriveProductionStatus([{ status: "printed" }, { status: "cancelled" }])).toBe("completed");
    expect(deriveProductionStatus([{ status: "printed" }, { status: "queued" }])).toBe("in_progress");
    expect(deriveProductionStatus([{ status: "failed" }, { status: "queued" }])).toBe("failed");
  });

  it("moves orders forward automatically but never backwards", () => {
    expect(orderStatusAfterJobChange("awaiting_print", [{ status: "printing" }, { status: "queued" }])).toBe("printing");
    expect(orderStatusAfterJobChange("printing", [{ status: "printed" }, { status: "printed" }])).toBe("printed");
    expect(orderStatusAfterJobChange("packing", [{ status: "printed" }])).toBeNull();
    expect(orderStatusAfterJobChange("on_hold", [{ status: "printing" }])).toBeNull();
  });

  it("tracks elapsed time excluding pauses", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(elapsedPrintMinutes({ status: "printing", accumulated_minutes: 30, last_resumed_at: "2026-01-01T11:00:00Z" }, now)).toBe(90);
    expect(elapsedPrintMinutes({ status: "paused", accumulated_minutes: 30, last_resumed_at: null }, now)).toBe(30);
  });

  it("orders the queue by priority, then position", () => {
    const jobs = [
      { id: "a", priority: "normal" as const, queue_position: 1, created_at: "1" },
      { id: "b", priority: "urgent" as const, queue_position: 5, created_at: "2" },
      { id: "c", priority: "normal" as const, queue_position: 0, created_at: "3" },
    ];
    expect(jobs.sort(compareQueue).map((j) => j.id)).toEqual(["b", "c", "a"]);
  });
});

describe("order numbers", () => {
  it("formats tokens like the database function", () => {
    expect(formatOrderNumber("{PREFIX}-{YYYY}-{SEQ}", "PF", 42, 4, new Date("2026-03-05"))).toBe("PF-2026-0042");
    expect(formatOrderNumber("{PREFIX}{YY}{MM}-{SEQ}", "TP", 7, 3, new Date("2026-03-05"))).toBe("TP2603-007");
  });
});

describe("SKU matching", () => {
  const catalog = [
    { productId: "p1", variantId: null, sku: "PKM-STAND-3" },
    { productId: "p1", variantId: "v1", sku: "PKM-STAND-3-RED" },
  ];
  it("prefers exact variant SKUs", () => {
    expect(matchSku("PKM-STAND-3-RED", catalog)).toMatchObject({ matched: true, variantId: "v1", exact: true });
  });
  it("falls back to case-insensitive matching", () => {
    expect(matchSku(" pkm-stand-3 ", catalog)).toMatchObject({ matched: true, productId: "p1", exact: false });
  });
  it("never guesses unknown SKUs", () => {
    expect(matchSku("NOPE", catalog)).toEqual({ matched: false, reason: "unknown_sku" });
    expect(matchSku(null, catalog)).toEqual({ matched: false, reason: "missing_sku" });
  });
});
