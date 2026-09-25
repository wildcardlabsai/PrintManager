import type { PrinterEvent, ProductionJob } from "@/types/db";

/**
 * Printer statistics for a date range. Built only from what PrintFlow
 * recorded; values it can't know are null ("Not available").
 */
export interface PrinterStats {
  printerId: string;
  printHours: number;
  completed: number;
  failed: number;
  /** completed / (completed + failed), null when there were none */
  successRate: number | null;
  filamentGrams: number;
  averageMinutes: number | null;
  /** print hours / hours in range, capped at 1 */
  utilisation: number;
  /** Only for connected printers with event history covering the range. */
  offlineHours: number | null;
  idleHours: number | null;
}

type StatJob = Pick<ProductionJob, "id" | "printer_id" | "status" | "started_at" | "completed_at" | "failed_at" | "actual_minutes" | "accumulated_minutes">;
type StatEvent = Pick<PrinterEvent, "printer_id" | "type" | "created_at">;

export function computePrinterStats(
  printerId: string,
  jobs: StatJob[],
  filamentByJob: Map<string, number>,
  events: StatEvent[] | null,
  range: { from: Date; to: Date },
  opts: { connected: boolean; connectedSince: Date | null },
): PrinterStats {
  const inRange = (iso: string | null) => Boolean(iso && new Date(iso) >= range.from && new Date(iso) <= range.to);
  const mine = jobs.filter((j) => j.printer_id === printerId);
  const completed = mine.filter((j) => j.status === "printed" && inRange(j.completed_at));
  const failed = mine.filter((j) => j.status === "failed" && inRange(j.failed_at));
  const minutes = (j: StatJob) => j.actual_minutes ?? j.accumulated_minutes ?? 0;
  const printMinutes = [...completed, ...failed].reduce((s, j) => s + minutes(j), 0);
  const rangeHours = Math.max(0, (range.to.getTime() - range.from.getTime()) / 3600000);
  const printHours = printMinutes / 60;
  const filamentGrams = [...completed, ...failed].reduce((s, j) => s + (filamentByJob.get(j.id) ?? 0), 0);

  let offlineHours: number | null = null;
  let idleHours: number | null = null;
  if (opts.connected && events && opts.connectedSince && opts.connectedSince <= range.from) {
    offlineHours = offlineDuration(events.filter((e) => e.printer_id === printerId), range) / 3600000;
    idleHours = Math.max(0, rangeHours - printHours - offlineHours);
  }
  return {
    printerId,
    printHours: round(printHours),
    completed: completed.length,
    failed: failed.length,
    successRate: completed.length + failed.length ? completed.length / (completed.length + failed.length) : null,
    filamentGrams: round(filamentGrams),
    averageMinutes: completed.length ? Math.round(completed.reduce((s, j) => s + minutes(j), 0) / completed.length) : null,
    utilisation: rangeHours ? Math.min(1, printHours / rangeHours) : 0,
    offlineHours: offlineHours == null ? null : round(offlineHours),
    idleHours: idleHours == null ? null : round(idleHours),
  };
}

/** Milliseconds between "disconnected" and the next "connected" event, clipped to the range. */
export function offlineDuration(events: StatEvent[], range: { from: Date; to: Date }) {
  const sorted = events.filter((e) => e.type === "connected" || e.type === "disconnected").sort((a, b) => a.created_at.localeCompare(b.created_at));
  let total = 0;
  // State at range start = last event before it.
  let offlineSince: number | null = null;
  for (const e of sorted) {
    const t = new Date(e.created_at).getTime();
    if (t < range.from.getTime()) {
      offlineSince = e.type === "disconnected" ? range.from.getTime() : null;
      continue;
    }
    if (t > range.to.getTime()) break;
    if (e.type === "disconnected" && offlineSince == null) offlineSince = t;
    if (e.type === "connected" && offlineSince != null) {
      total += t - offlineSince;
      offlineSince = null;
    }
  }
  if (offlineSince != null) total += range.to.getTime() - offlineSince;
  return total;
}

const round = (n: number) => Math.round(n * 100) / 100;
