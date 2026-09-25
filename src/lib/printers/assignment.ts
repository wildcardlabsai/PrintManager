import { detectModel, MODEL_LABELS } from "../../../agent/src/protocol";
import type { PrintFile, ProductionJob } from "@/types/db";
import { fileSupportsModel, loadedFilament, normaliseColour, type DispatchPrinter } from "./dispatch";
import { connectionView } from "./status";

/**
 * Printer suggestions for a queued job. PrintFlow only suggests: a person
 * always makes the assignment.
 */
export interface Suggestion {
  printerId: string;
  printerName: string;
  score: number;
  /** Why it is a good fit. */
  reasons: string[];
  /** Why it can't take the job right now (or at all). */
  concerns: string[];
  compatible: boolean;
}

export interface SuggestPrinter extends DispatchPrinter {
  status: string;
  /** Jobs already assigned and waiting on this printer. */
  queued: number;
  busy: boolean;
}

export function suggestPrinters(
  job: Pick<ProductionJob, "material" | "colour" | "estimated_minutes" | "multi_colour" | "ifs_required">,
  files: Pick<PrintFile, "id" | "compatible_models" | "multi_colour" | "ifs_required" | "material" | "colour" | "verified_at" | "archived_at">[],
  printers: SuggestPrinter[],
  opts: { now: Date; offlineAfterSeconds: number; defaultPrinterId?: string | null },
): Suggestion[] {
  const needsMulti = job.multi_colour || job.ifs_required || files.some((f) => f.ifs_required && !f.archived_at);
  const out = printers
    .filter((p) => !p.archived_at)
    .map((p) => {
      const reasons: string[] = [];
      const concerns: string[] = [];
      let score = 0;
      let compatible = true;
      const model = detectModel(p.model);
      const liveFiles = files.filter((f) => !f.archived_at);
      const fileFits = model ? liveFiles.filter((f) => fileSupportsModel(f, model)) : [];

      if (needsMulti && model !== "AD5X") {
        compatible = false;
        concerns.push("Can't print multi-colour");
      }
      if (liveFiles.length && !fileFits.length) {
        compatible = false;
        concerns.push(model ? `No print file sliced for the ${MODEL_LABELS[model]}` : "No compatible print file");
      } else if (fileFits.length) {
        score += 30;
        reasons.push(fileFits.some((f) => f.verified_at) ? "Has a proven print file" : "Has a print file for this model");
        if (fileFits.some((f) => f.verified_at)) score += 10;
      }

      if (p.connection_mode === "agent_lan") {
        const conn = connectionView(p, opts.now, opts.offlineAfterSeconds);
        if (!conn.live) {
          score -= 20;
          concerns.push(conn.label);
        } else if (p.raw_status === "ready" && p.bed_clear && !p.busy) {
          score += 40;
          reasons.push("Idle now");
        } else if (p.raw_status === "completed" || !p.bed_clear) {
          score += 10;
          concerns.push("Plate needs clearing");
        } else {
          concerns.push(`Busy (${p.raw_status ?? p.status})`);
        }
        const loaded = loadedFilament(p.telemetry);
        if (job.material && loaded.material) {
          if (loaded.material.toLowerCase() === job.material.toLowerCase()) {
            score += 15;
            reasons.push(`${loaded.material} loaded`);
          } else {
            score -= 10;
            concerns.push(`${loaded.material} loaded, job needs ${job.material}`);
          }
        }
        if (job.colour && loaded.colour && normaliseColour(job.colour) === normaliseColour(loaded.colour)) {
          score += 10;
          reasons.push("Colour matches");
        }
        if (!p.live_verified_at) concerns.push("Live test checklist not complete");
      } else {
        if (p.status === "idle") {
          score += 20;
          reasons.push("Marked idle");
        } else if (p.status === "offline" || p.status === "maintenance" || p.status === "error") {
          score -= 20;
          concerns.push(`Marked ${p.status}`);
        }
        concerns.push("Not connected: start the print by hand");
      }

      if (p.queued > 0) {
        score -= Math.min(30, p.queued * 5);
        concerns.push(`${p.queued} job${p.queued === 1 ? "" : "s"} already waiting`);
      } else {
        reasons.push("Nothing waiting");
      }
      if (opts.defaultPrinterId === p.id) {
        score += 5;
        reasons.push("Product's default printer");
      }
      return { printerId: p.id, printerName: p.name, score: compatible ? score : -1000, reasons, concerns, compatible };
    });
  return out.sort((a, b) => b.score - a.score || a.printerName.localeCompare(b.printerName));
}
