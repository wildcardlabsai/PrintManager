import "server-only";
import { suggestPrinters, type Suggestion } from "@/lib/printers/assignment";
import { connectionView } from "@/lib/printers/status";
import { jobLabel } from "@/lib/production-labels";
import { hasAdminClient } from "@/lib/supabase/admin";
import type { PrintFile, ProductionJob } from "@/types/db";
import type { SendFile, SendPrinter } from "@/components/production/send-to-printer-dialog";
import type { PrinterJob } from "@/components/production/job-printer-actions";
import type { AppContext } from "../context";
import { check } from "../errors";
import { listPrinters, type PrinterWithJob } from "../printers";
import { sweepStalePrinters } from "./telemetry";

const FILE_COLUMNS =
  "id, name, product_id, variant_id, compatible_models, verified_at, multi_colour, ifs_required, colour_channels, filament_assignments, estimated_minutes, estimated_grams, material, colour, file_type, archived_at";

export type ViewFile = SendFile & Pick<PrintFile, "product_id" | "variant_id" | "archived_at">;

/** Printers, print files and suggestion inputs shared by the production screens. */
export async function loadPrinterView(ctx: AppContext) {
  if (hasAdminClient()) {
    try {
      await sweepStalePrinters(ctx);
    } catch (error) {
      console.error("[printers] sweep failed", error);
    }
  }
  const [printers, filesRes] = await Promise.all([
    listPrinters(ctx),
    ctx.supabase.from("print_files").select(FILE_COLUMNS).eq("organization_id", ctx.orgId).is("archived_at", null).limit(1000),
  ]);
  const files = check(filesRes) as ViewFile[];
  const now = new Date();
  const sendPrinters: SendPrinter[] = printers.map((p) => ({
    id: p.id,
    name: p.name,
    model: p.model,
    connected: p.connection_mode === "agent_lan" && Boolean(p.agent_id),
  }));
  return {
    printers,
    files,
    sendPrinters,
    now,
    filesFor: (job: Pick<ProductionJob, "product_id">) => files.filter((f) => f.product_id && f.product_id === job.product_id),
    suggestionsFor: (job: ProductionJob): Suggestion[] =>
      suggestPrinters(
        job,
        files.filter((f) => f.product_id && f.product_id === job.product_id),
        printers.map((p) => ({ ...p, queued: p.queued_count, busy: Boolean(p.current_job) })),
        { now, offlineAfterSeconds: ctx.settings.printer_offline_after_seconds },
      ),
    isConnected: (printerId: string | null) => {
      const p = printers.find((x) => x.id === printerId);
      return Boolean(p && p.connection_mode === "agent_lan");
    },
    isLive: (p: PrinterWithJob) => connectionView(p, now, ctx.settings.printer_offline_after_seconds).live,
  };
}

export function toPrinterJob(job: ProductionJob, connected: boolean): PrinterJob {
  return {
    id: job.id,
    label: jobLabel(job),
    product_name: job.product_name,
    quantity: job.quantity,
    status: job.status,
    printer_id: job.printer_id,
    print_file_id: job.print_file_id,
    estimated_minutes: job.estimated_minutes,
    estimated_grams: Number(job.estimated_grams),
    material: job.material,
    colour: job.colour,
    needs_attention: job.needs_attention,
    attention_code: job.attention_code,
    attention_reason: job.attention_reason,
    filament_recorded: job.filament_recorded,
    filament_id: job.filament_id,
    connected,
  };
}
