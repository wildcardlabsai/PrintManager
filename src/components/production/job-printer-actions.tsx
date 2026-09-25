"use client";

import { useState } from "react";
import { ClipboardCheckIcon, Loader2Icon, PauseIcon, PlayIcon, RotateCcwIcon, SendIcon, ShuffleIcon, SquareIcon, XCircleIcon, XIcon } from "lucide-react";
import {
  cancelPendingStartAction,
  controlJobAction,
  dismissAttentionAction,
  markFailedAction,
  retryJobAction,
  reviewPrintAction,
} from "@/actions/printer-control";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { useCommandWatch } from "@/hooks/use-command-watch";
import { formatGrams } from "@/lib/domain/dates";
import type { Suggestion } from "@/lib/printers/assignment";
import type { AttentionCode, JobStatus } from "@/types/db";
import type { SpoolOption } from "./job-actions";
import { SendToPrinterDialog, type SendFile, type SendPrinter } from "./send-to-printer-dialog";

export interface PrinterJob {
  id: string;
  label: string;
  product_name: string;
  quantity: number;
  status: JobStatus;
  printer_id: string | null;
  print_file_id: string | null;
  estimated_minutes: number;
  estimated_grams: number;
  material: string | null;
  colour: string | null;
  needs_attention: boolean;
  attention_code: AttentionCode | null;
  attention_reason: string | null;
  filament_recorded: boolean;
  filament_id: string | null;
  /** Job's printer is connected to PrintFlow. */
  connected: boolean;
}

/**
 * Printer-side actions for a production job: send, pause/resume/stop, cancel
 * a pending send, deal with alerts, and review finished prints.
 */
export function JobPrinterActions({
  job,
  printers,
  files,
  suggestions,
  spools,
  canOperate,
  size = "sm",
}: {
  job: PrinterJob;
  printers: SendPrinter[];
  files: SendFile[];
  suggestions?: Suggestion[];
  spools: SpoolOption[];
  canOperate: boolean;
  size?: "sm" | "default";
}) {
  const { pending, execute } = useAction();
  const { watch, watching } = useCommandWatch();
  if (!canOperate) return null;
  const busy = pending || Boolean(watching);
  const anyConnected = printers.some((p) => p.connected);

  async function control(action: "pause" | "resume" | "stop") {
    const r = await execute(() => controlJobAction(job.id, action, action === "stop"), { success: "" });
    if (r.ok) await watch(r.data.commandId);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {busy && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Waiting" />}
      {job.status === "queued" && anyConnected && (!job.printer_id || job.connected || !printers.some((p) => p.id === job.printer_id)) && (
        <SendToPrinterDialog
          mode="job"
          jobId={job.id}
          summary={{ title: job.label, product: job.product_name, quantity: job.quantity, estimatedMinutes: job.estimated_minutes, material: job.material, colour: job.colour }}
          printers={printers}
          files={files}
          suggestions={suggestions}
          defaultPrinterId={job.printer_id ?? suggestions?.find((s) => s.compatible)?.printerId}
          defaultFileId={job.print_file_id}
          trigger={
            <Button size={size} disabled={busy}>
              <SendIcon /> Send to printer
            </Button>
          }
        />
      )}
      {job.status === "sending" && (
        <Button size={size} variant="outline" disabled={busy} onClick={() => execute(() => cancelPendingStartAction(job.id))}>
          <XIcon /> Cancel send
        </Button>
      )}
      {job.connected && (job.status === "printing" || job.status === "sent") && (
        <Button size={size} variant="outline" disabled={busy} onClick={() => control("pause")}>
          <PauseIcon /> Pause
        </Button>
      )}
      {job.connected && job.status === "paused" && (
        <Button size={size} variant="outline" disabled={busy} onClick={() => control("resume")}>
          <PlayIcon /> Resume
        </Button>
      )}
      {job.connected && ["sent", "printing", "paused"].includes(job.status) && (
        <ConfirmButton
          title="Stop this print?"
          description={
            <>
              This cancels <strong>{job.label}</strong> ({job.product_name}) on the printer. It can&apos;t be resumed; the job will be marked failed so
              you can retry or reassign it.
            </>
          }
          confirmLabel="Stop print"
          destructive
          onConfirm={() => control("stop")}
          trigger={
            <Button size={size} variant="outline" className="text-destructive" disabled={busy}>
              <SquareIcon /> Stop
            </Button>
          }
        />
      )}
      {job.needs_attention && <AttentionActions job={job} printers={printers} spools={spools} size={size} />}
      {job.status === "printed" && !job.filament_recorded && <ReviewPrintDialog job={job} spools={spools} size={size} />}
    </div>
  );
}

export function AttentionActions({ job, printers, spools, size = "sm" }: { job: PrinterJob; printers: SendPrinter[]; spools: SpoolOption[]; size?: "sm" | "default" }) {
  const { pending, execute } = useAction();
  const [reassignTo, setReassignTo] = useState<string>("");
  const [reason, setReason] = useState(job.attention_reason ?? "");
  const [waste, setWaste] = useState("");
  const [spool, setSpool] = useState(job.filament_id ?? "");
  const retryable = job.status === "failed" || job.status === "queued";
  const stillRunning = ["sent", "printing", "paused"].includes(job.status);
  return (
    <>
      {retryable && (
        <ConfirmButton
          title="Retry this job?"
          description="It goes back to the queue on the same printer. Nothing starts until someone sends it."
          confirmLabel="Queue again"
          onConfirm={() => execute(() => retryJobAction(job.id, job.printer_id))}
          trigger={
            <Button size={size} variant="outline" disabled={pending}>
              <RotateCcwIcon /> Retry
            </Button>
          }
        />
      )}
      {retryable && (
        <Dialog>
          <DialogTrigger asChild>
            <Button size={size} variant="outline" disabled={pending}>
              <ShuffleIcon /> Reassign
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reassign {job.label}</DialogTitle>
              <DialogDescription>The job goes back to the queue on the printer you choose.</DialogDescription>
            </DialogHeader>
            <Select value={reassignTo} onValueChange={setReassignTo}>
              <SelectTrigger aria-label="Printer">
                <SelectValue placeholder="Choose a printer" />
              </SelectTrigger>
              <SelectContent>
                {printers
                  .filter((p) => p.id !== job.printer_id)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button disabled={!reassignTo || pending} onClick={() => execute(() => retryJobAction(job.id, reassignTo))}>
                Reassign and queue
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {!stillRunning && (
        <Dialog>
          <DialogTrigger asChild>
            <Button size={size} variant="outline" className="text-destructive" disabled={pending}>
              <XCircleIcon /> Mark failed
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Mark {job.label} failed</DialogTitle>
              <DialogDescription>Clears the alert and keeps the job in Failed. Record any wasted filament.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`mf-r-${job.id}`} label="Reason" className="sm:col-span-2">
                <Textarea id={`mf-r-${job.id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <Field id={`mf-w-${job.id}`} label="Wasted filament (g)" hint="Optional">
                <Input id={`mf-w-${job.id}`} inputMode="decimal" value={waste} onChange={(e) => setWaste(e.target.value)} />
              </Field>
              <Field id={`mf-s-${job.id}`} label="From spool">
                <SpoolPicker id={`mf-s-${job.id}`} value={spool} onChange={setSpool} spools={spools} />
              </Field>
            </div>
            <DialogFooter>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => execute(() => markFailedAction(job.id, { reason, wasteGrams: waste || null, wasteFilamentId: spool }))}
              >
                Mark failed
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {(job.attention_code === "printer_offline" || job.attention_code === "printer_error" || job.attention_code === "other_job" || stillRunning) && (
        <Button size={size} variant="ghost" disabled={pending} onClick={() => execute(() => dismissAttentionAction(job.id))}>
          Dismiss alert
        </Button>
      )}
    </>
  );
}

function SpoolPicker({ id, value, onChange, spools }: { id: string; value: string; onChange: (v: string) => void; spools: SpoolOption[] }) {
  return (
    <Select value={value || "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">Don&apos;t deduct from a spool</SelectItem>
        {spools.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {[s.brand, s.material, s.colour].filter(Boolean).join(" ")} · {formatGrams(s.remaining_g)} left
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * After a connected printer reports a finished print: record the filament
 * actually used (the printer doesn't report it) and whether the print was good.
 */
export function ReviewPrintDialog({ job, spools, size = "sm" }: { job: PrinterJob; spools: SpoolOption[]; size?: "sm" | "default" }) {
  const [open, setOpen] = useState(false);
  const [grams, setGrams] = useState(String(job.estimated_grams));
  const [spool, setSpool] = useState(job.filament_id ?? spools.find((s) => s.material === job.material)?.id ?? "");
  const [ok, setOk] = useState(true);
  const [proven, setProven] = useState(true);
  const [notes, setNotes] = useState("");
  const { pending, execute } = useAction();
  const variance = grams === "" ? null : Number(grams) - Number(job.estimated_grams);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} variant="outline">
          <ClipboardCheckIcon /> Review print
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review {job.label}</DialogTitle>
          <DialogDescription>
            {job.product_name} × {job.quantity}. The printer doesn&apos;t report how much filament was used, so weigh or estimate it here.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id={`rv-g-${job.id}`}
            label="Filament used (g)"
            hint={`Estimated ${formatGrams(job.estimated_grams)}${variance != null && Number.isFinite(variance) ? ` · variance ${variance >= 0 ? "+" : ""}${variance.toFixed(1)} g` : ""}`}
          >
            <Input id={`rv-g-${job.id}`} inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
          </Field>
          <Field id={`rv-s-${job.id}`} label="Deduct from spool">
            <SpoolPicker id={`rv-s-${job.id}`} value={spool} onChange={setSpool} spools={spools} />
          </Field>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Checkbox id={`rv-ok-${job.id}`} checked={ok} onCheckedChange={(v) => setOk(v === true)} />
            <Label htmlFor={`rv-ok-${job.id}`} className="font-normal">
              The print came out right
            </Label>
          </div>
          {job.print_file_id && (
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox id={`rv-p-${job.id}`} checked={ok && proven} disabled={!ok} onCheckedChange={(v) => setProven(v === true)} />
              <Label htmlFor={`rv-p-${job.id}`} className="font-normal">
                Mark the print file as proven (allows it in the automatic queue)
              </Label>
            </div>
          )}
          <Field id={`rv-n-${job.id}`} label="Notes" className="sm:col-span-2">
            <Textarea id={`rv-n-${job.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              execute(
                () => reviewPrintAction(job.id, { filamentId: spool, actualGrams: grams === "" ? null : grams, printOk: ok, markFileProven: ok && proven, notes }),
                { onSuccess: () => setOpen(false) },
              )
            }
          >
            {pending && <Loader2Icon className="animate-spin" />}
            Save review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
