import "server-only";
import type { PrinterInput } from "@/lib/validation/schemas";
import type { Printer, PrinterStatus, ProductionJob } from "@/types/db";
import { logAudit, recordStatusChange } from "./audit";
import type { AppContext } from "./context";
import { check, checkFound } from "./errors";

export interface PrinterWithJob extends Printer {
  current_job: Pick<
    ProductionJob,
    "id" | "job_number" | "product_name" | "quantity" | "status" | "started_at" | "estimated_minutes" | "accumulated_minutes" | "last_resumed_at" | "order_id"
  > | null;
  queued_count: number;
}

export async function listPrinters(ctx: AppContext, opts: { includeArchived?: boolean } = {}): Promise<PrinterWithJob[]> {
  let q = ctx.supabase.from("printers").select("*").eq("organization_id", ctx.orgId).order("name");
  if (!opts.includeArchived) q = q.is("archived_at", null);
  const printers = check(await q) as Printer[];
  if (!printers.length) return [];

  const jobs = check(
    await ctx.supabase
      .from("production_jobs")
      .select("id, job_number, product_name, quantity, status, started_at, estimated_minutes, accumulated_minutes, last_resumed_at, order_id, printer_id")
      .eq("organization_id", ctx.orgId)
      .in("status", ["printing", "paused", "queued"])
      .not("printer_id", "is", null),
  ) as (PrinterWithJob["current_job"] & { printer_id: string })[];

  return printers.map((p) => {
    const mine = jobs.filter((j) => j!.printer_id === p.id);
    const current = mine.find((j) => j!.status === "printing") ?? mine.find((j) => j!.status === "paused") ?? null;
    return { ...p, current_job: current, queued_count: mine.filter((j) => j!.status === "queued").length };
  });
}

export async function createPrinter(ctx: AppContext, input: PrinterInput) {
  const printer = check(
    await ctx.supabase.from("printers").insert({ ...input, organization_id: ctx.orgId }).select("*").single(),
  ) as Printer;
  await logAudit(ctx, "printer.created", { type: "printer", id: printer.id }, `Printer ${printer.name} added`);
  return printer;
}

export async function updatePrinter(ctx: AppContext, id: string, input: PrinterInput) {
  const before = checkFound(
    await ctx.supabase.from("printers").select("*").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle(),
    "Printer",
  ) as Printer;
  const statusChanged = before.status !== input.status;
  const printer = check(
    await ctx.supabase
      .from("printers")
      .update({
        ...input,
        ...(statusChanged ? { status_source: "manual", status_updated_at: new Date().toISOString() } : {}),
      })
      .eq("id", id)
      .select("*")
      .single(),
  ) as Printer;
  if (statusChanged) await recordStatusChange(ctx, "printer", id, before.status, input.status);
  await logAudit(ctx, "printer.updated", { type: "printer", id }, `Printer ${printer.name} updated`, {
    status: statusChanged ? { from: before.status, to: input.status } : undefined,
  });
  return printer;
}

export async function setPrinterStatusManual(ctx: AppContext, id: string, status: PrinterStatus) {
  const before = checkFound(
    await ctx.supabase.from("printers").select("id, name, status").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle(),
    "Printer",
  ) as Pick<Printer, "id" | "name" | "status">;
  if (before.status === status) return;
  check(
    await ctx.supabase
      .from("printers")
      .update({ status, status_source: "manual", status_updated_at: new Date().toISOString() })
      .eq("id", id),
  );
  await recordStatusChange(ctx, "printer", id, before.status, status);
  await logAudit(ctx, "printer.status_changed", { type: "printer", id }, `${before.name}: ${before.status} → ${status}`, {
    from: before.status,
    to: status,
    source: "manual",
  });
}

export async function setPrinterArchived(ctx: AppContext, id: string, archived: boolean) {
  const printer = checkFound(
    await ctx.supabase
      .from("printers")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("organization_id", ctx.orgId)
      .select("id, name")
      .maybeSingle(),
    "Printer",
  ) as Pick<Printer, "id" | "name">;
  await logAudit(ctx, "printer.updated", { type: "printer", id }, `Printer ${printer.name} ${archived ? "archived" : "restored"}`);
}
