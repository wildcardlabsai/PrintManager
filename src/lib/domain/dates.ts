import { TZDate } from "@date-fns/tz";
import {
  addDays,
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";

export interface DateRange {
  from: Date;
  to: Date;
}

export const REPORT_RANGES = ["today", "7d", "30d", "this_month", "last_month", "custom"] as const;
export type ReportRangeKey = (typeof REPORT_RANGES)[number];

export const REPORT_RANGE_LABELS: Record<ReportRangeKey, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  custom: "Custom range",
};

/** "Now" expressed in the business's timezone, so day boundaries match local days. */
export function zonedNow(timeZone: string, now: Date = new Date()) {
  return new TZDate(now.getTime(), timeZone);
}

/** Plain UTC Date instances (TZDate serialises with an offset). */
const plain = (r: DateRange): DateRange => ({ from: new Date(r.from.getTime()), to: new Date(r.to.getTime()) });

export function todayRange(timeZone: string, now?: Date): DateRange {
  const z = zonedNow(timeZone, now);
  return plain({ from: startOfDay(z), to: endOfDay(z) });
}

export function weekRange(timeZone: string, now?: Date): DateRange {
  const z = zonedNow(timeZone, now);
  return plain({ from: startOfWeek(z, { weekStartsOn: 1 }), to: endOfDay(z) });
}

export function monthRange(timeZone: string, now?: Date): DateRange {
  const z = zonedNow(timeZone, now);
  return plain({ from: startOfMonth(z), to: endOfDay(z) });
}

/** Parse a yyyy-mm-dd string as a local date in the given timezone. */
export function parseLocalDate(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), timeZone);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveReportRange(
  key: ReportRangeKey,
  timeZone: string,
  custom?: { from?: string; to?: string },
  now?: Date,
): DateRange {
  return plain(resolveZonedRange(key, timeZone, custom, now));
}

function resolveZonedRange(
  key: ReportRangeKey,
  timeZone: string,
  custom?: { from?: string; to?: string },
  now?: Date,
): DateRange {
  const z = zonedNow(timeZone, now);
  switch (key) {
    case "today":
      return { from: startOfDay(z), to: endOfDay(z) };
    case "7d":
      return { from: startOfDay(subDays(z, 6)), to: endOfDay(z) };
    case "30d":
      return { from: startOfDay(subDays(z, 29)), to: endOfDay(z) };
    case "this_month":
      return { from: startOfMonth(z), to: endOfDay(z) };
    case "last_month": {
      const last = subMonths(z, 1);
      return { from: startOfMonth(last), to: endOfMonth(last) };
    }
    case "custom": {
      const from = custom?.from ? parseLocalDate(custom.from, timeZone) : null;
      const to = custom?.to ? parseLocalDate(custom.to, timeZone) : null;
      if (!from || !to || from > to || to.getTime() - from.getTime() > 400 * 86400000) return { from: startOfDay(subDays(z, 29)), to: endOfDay(z) };
      return { from: startOfDay(from), to: endOfDay(to) };
    }
  }
}

/** Every local calendar day in a range, as yyyy-MM-dd keys. */
export function eachDayKey(range: DateRange, timeZone: string): string[] {
  const keys: string[] = [];
  let cursor = startOfDay(new TZDate(range.from.getTime(), timeZone));
  const end = range.to.getTime();
  let guard = 0;
  while (cursor.getTime() <= end && guard < 400) {
    keys.push(format(cursor, "yyyy-MM-dd"));
    cursor = addDays(cursor, 1);
    guard++;
  }
  return keys;
}

export function dayKey(date: string | Date, timeZone: string): string {
  return format(new TZDate(new Date(date).getTime(), timeZone), "yyyy-MM-dd");
}

export function formatDate(date: string | Date | null | undefined, timeZone = "Europe/London") {
  if (!date) return "—";
  return format(new TZDate(new Date(date).getTime(), timeZone), "d MMM yyyy");
}

export function formatDateTime(date: string | Date | null | undefined, timeZone = "Europe/London") {
  if (!date) return "—";
  return format(new TZDate(new Date(date).getTime(), timeZone), "d MMM yyyy, HH:mm");
}

export function formatShortDateTime(date: string | Date | null | undefined, timeZone = "Europe/London") {
  if (!date) return "—";
  const d = new TZDate(new Date(date).getTime(), timeZone);
  const today = zonedNow(timeZone);
  if (format(d, "yyyy-MM-dd") === format(today, "yyyy-MM-dd")) return `Today ${format(d, "HH:mm")}`;
  return format(d, "d MMM, HH:mm");
}

export function formatDuration(minutes: number | null | undefined) {
  if (minutes == null) return "—";
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

export function formatGrams(grams: number | null | undefined) {
  if (grams == null) return "—";
  const g = Number(grams);
  if (g >= 1000) return `${(g / 1000).toFixed(2)} kg`;
  return `${Math.round(g * 10) / 10} g`;
}
