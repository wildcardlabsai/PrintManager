import "server-only";
import { computePrinterStats, type PrinterStats } from "@/lib/printers/stats";
import type { Printer, PrinterEvent, ProductionJob } from "@/types/db";
import type { AppContext } from "../context";
import { check } from "../errors";

export interface PrinterStatsRow extends PrinterStats {
  printer: Pick<Printer, "id" | "name" | "model" | "connection_mode">;
}

export async function getPrinterStats(ctx: AppContext, range: { from: Date; to: Date }): Promise<PrinterStatsRow[]> {
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  const [printersRes, jobsRes, eventsRes, firstEventsRes] = await Promise.all([
    ctx.supabase.from("printers").select("id, name, model, connection_mode, created_at").eq("organization_id", ctx.orgId).is("archived_at", null).order("name"),
    ctx.supabase
      .from("production_jobs")
      .select("id, printer_id, status, started_at, completed_at, failed_at, actual_minutes, accumulated_minutes")
      .eq("organization_id", ctx.orgId)
      .in("status", ["printed", "failed"])
      .or(`and(completed_at.gte.${fromIso},completed_at.lte.${toIso}),and(failed_at.gte.${fromIso},failed_at.lte.${toIso})`)
      .limit(5000),
    ctx.supabase
      .from("printer_events")
      .select("printer_id, type, created_at")
      .eq("organization_id", ctx.orgId)
      .in("type", ["connected", "disconnected"])
      .lte("created_at", toIso)
      .order("created_at")
      .limit(10000),
    ctx.supabase.from("printer_events").select("printer_id, created_at").eq("organization_id", ctx.orgId).eq("type", "connected").order("created_at").limit(1000),
  ]);
  const printers = check(printersRes) as Pick<Printer, "id" | "name" | "model" | "connection_mode" | "created_at">[];
  const jobs = check(jobsRes) as Pick<ProductionJob, "id" | "printer_id" | "status" | "started_at" | "completed_at" | "failed_at" | "actual_minutes" | "accumulated_minutes">[];
  const events = check(eventsRes) as Pick<PrinterEvent, "printer_id" | "type" | "created_at">[];
  const firstConnected = new Map<string, Date>();
  for (const e of check(firstEventsRes) as Pick<PrinterEvent, "printer_id" | "created_at">[]) {
    if (!firstConnected.has(e.printer_id)) firstConnected.set(e.printer_id, new Date(e.created_at));
  }

  const filamentByJob = new Map<string, number>();
  const ids = jobs.map((j) => j.id);
  for (let i = 0; i < ids.length; i += 200) {
    const usage = check(
      await ctx.supabase.from("filament_usage").select("production_job_id, grams").in("production_job_id", ids.slice(i, i + 200)),
    ) as { production_job_id: string; grams: number }[];
    for (const u of usage) filamentByJob.set(u.production_job_id, (filamentByJob.get(u.production_job_id) ?? 0) + Number(u.grams));
  }

  return printers.map((p) => ({
    printer: { id: p.id, name: p.name, model: p.model, connection_mode: p.connection_mode },
    ...computePrinterStats(p.id, jobs, filamentByJob, events, range, {
      connected: p.connection_mode === "agent_lan",
      connectedSince: firstConnected.get(p.id) ?? null,
    }),
  }));
}
