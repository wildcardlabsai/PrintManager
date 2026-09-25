import "server-only";
import type { MaterialMapping, StartPrintPayload } from "../../../../agent/src/protocol";
import { jobLabel } from "@/lib/services/production";
import type { AdminClient } from "@/lib/supabase/admin";
import type { PrintFile, Printer, ProductionJob, Settings } from "@/types/db";
import { AppError } from "../errors";

export interface PrintOptions {
  levelingBeforePrint: boolean;
  flowCalibration: boolean;
  firstLayerInspection: boolean;
  timeLapseVideo: boolean;
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  levelingBeforePrint: true,
  flowCalibration: false,
  firstLayerInspection: false,
  timeLapseVideo: false,
};

function slug(s: string) {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .slice(0, 40) || "print"
  );
}

/** Unique, printer-safe name: lets PrintFlow recognise its own file in the printer's telemetry. */
export function printerFileName(label: string, file: Pick<PrintFile, "name" | "file_name" | "file_type">) {
  const ext = file.file_type === "gcode" ? "gcode" : file.file_type;
  return `PF-${label}-${slug(file.name)}.${ext}`;
}

/**
 * Queues a start-print command for the printer's agent and moves the job to
 * "sending". Database constraints guarantee one print start in flight per
 * printer and one active job per printer, so double submits fail safely.
 */
export async function createStartCommand(
  admin: AdminClient,
  args: {
    orgId: string;
    settings: Pick<Settings, "printer_command_timeout_seconds">;
    printer: Pick<Printer, "id" | "agent_id">;
    job: Pick<ProductionJob, "id" | "job_number" | "status"> | null;
    file: Pick<PrintFile, "id" | "name" | "file_name" | "file_type" | "sha256" | "size_bytes" | "multi_colour" | "colour_channels" | "ifs_required" | "filament_assignments">;
    options: PrintOptions;
    mappings: MaterialMapping[];
    automatic: boolean;
    requestedBy: string | null;
  },
) {
  const { printer, job, file } = args;
  if (!printer.agent_id) throw new AppError("No Printer Agent is assigned to this printer.", "validation");
  const label = job ? jobLabel(job) : `TEST-${Date.now().toString(36).toUpperCase()}`;
  const fileName = printerFileName(label, file);
  const payload: StartPrintPayload = {
    printFileId: file.id,
    fileName,
    sha256: file.sha256,
    sizeBytes: file.size_bytes,
    fileType: file.file_type,
    ...args.options,
    useMaterialStation: file.ifs_required,
    materialMappings: file.ifs_required ? args.mappings : [],
  };

  if (job) {
    const { data: moved, error } = await admin
      .from("production_jobs")
      .update({
        status: "sending",
        printer_id: printer.id,
        print_file_id: file.id,
        printer_file_name: fileName,
        external_printer_job_id: null,
        sent_at: null,
        progress: null,
        remaining_seconds: null,
        printer_status: null,
        printer_elapsed_seconds: null,
        current_layer: null,
        total_layers: null,
        multi_colour: file.multi_colour,
        colour_channels: file.colour_channels,
        ifs_required: file.ifs_required,
        filament_assignments: file.filament_assignments,
        needs_attention: false,
        attention_code: null,
        attention_reason: null,
        auto_dispatched: args.automatic,
      })
      .eq("id", job.id)
      .eq("organization_id", args.orgId)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (error?.code === "23505") throw new AppError("That printer already has a print being sent or in progress.", "conflict");
    if (error) throw new AppError("Could not update the job. Please try again.");
    if (!moved) throw new AppError("The job is no longer awaiting print.", "conflict");
  }

  const { data: command, error } = await admin
    .from("printer_commands")
    .insert({
      organization_id: args.orgId,
      printer_id: printer.id,
      agent_id: printer.agent_id,
      production_job_id: job?.id ?? null,
      print_file_id: file.id,
      type: "start_print",
      payload,
      automatic: args.automatic,
      requested_by: args.requestedBy,
      expires_at: new Date(Date.now() + args.settings.printer_command_timeout_seconds * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !command) {
    if (job) await admin.from("production_jobs").update({ status: "queued", printer_file_name: null }).eq("id", job.id).eq("status", "sending");
    if (error?.code === "23505") throw new AppError("A print is already being sent to that printer.", "conflict");
    throw new AppError("Could not queue the print for the Printer Agent. Please try again.");
  }
  return { commandId: command.id as string, fileName };
}
