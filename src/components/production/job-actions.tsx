"use client";

import { useState } from "react";
import {
  CheckIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { jobAction } from "@/actions/production";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { formatDuration, formatGrams } from "@/lib/domain/dates";
import { allowedJobActions, elapsedPrintMinutes, type JobAction } from "@/lib/domain/production";
import type { Filament, JobStatus, Printer } from "@/types/db";

export type ActionJob = {
  id: string;
  job_number: number;
  order_id: string | null;
  status: JobStatus;
  printer_id: string | null;
  product_name: string;
  quantity: number;
  material: string | null;
  colour: string | null;
  estimated_grams: number;
  estimated_minutes: number;
  accumulated_minutes: number;
  last_resumed_at: string | null;
  filament_id?: string | null;
  /** The job's printer is connected to PrintFlow (start/pause/resume happen on the printer). */
  connected?: boolean;
};

export type PrinterOption = Pick<Printer, "id" | "name" | "status"> & { connection_mode?: Printer["connection_mode"] };
export type SpoolOption = Pick<Filament, "id" | "brand" | "material" | "colour" | "remaining_g">;

const spoolLabel = (s: SpoolOption) => `${[s.brand, s.material, s.colour].filter(Boolean).join(" ")} · ${formatGrams(s.remaining_g)} left`;

function bestSpool(job: ActionJob, spools: SpoolOption[]) {
  if (job.filament_id && spools.some((s) => s.id === job.filament_id)) return job.filament_id;
  const colour = (job.colour ?? "").toLowerCase();
  return (
    spools.find((s) => s.material === job.material && colour && colour.startsWith(s.colour.toLowerCase()))?.id ??
    spools.find((s) => s.material === job.material)?.id ??
    ""
  );
}

type DialogKind = "start" | "complete" | "fail" | null;

/**
 * Manual production records: what the operator did at a printer that isn't
 * connected, plus record-only overrides (complete / fail / cancel) for any
 * job. Connected printers are controlled with "Send to printer" and the
 * printer controls instead.
 */
export function JobActions({
  job,
  printers,
  spools,
  compact = false,
}: {
  job: ActionJob;
  printers: PrinterOption[];
  spools: SpoolOption[];
  compact?: boolean;
}) {
  const { pending, execute } = useAction();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const actions = allowedJobActions(job.status).filter(
    (a) => !(job.connected && (a === "start" || a === "pause" || a === "resume")),
  );
  const manualPrinters = printers.filter((p) => p.connection_mode !== "agent_lan");
  if (!actions.length) return null;

  const run = (action: JobAction, extra: Record<string, unknown> = {}) =>
    execute(() => jobAction({ jobId: job.id, orderId: job.order_id, action, ...extra }), {
      onSuccess: () => setDialog(null),
    });

  const primary: JobAction | null =
    actions.includes("start") && manualPrinters.length
      ? "start"
      : actions.includes("complete") && !job.connected
        ? "complete"
        : actions.includes("requeue")
          ? "requeue"
          : null;
  const secondary = actions.filter((a) => a !== primary);

  const onPrimary = () => {
    if (primary === "start") {
      if (job.printer_id && !compact && manualPrinters.some((p) => p.id === job.printer_id)) return run("start");
      return setDialog("start");
    }
    if (primary === "complete") return setDialog("complete");
    if (primary === "requeue") return run("requeue");
  };

  const PRIMARY_LABEL: Record<string, { label: string; icon: React.ReactNode }> = {
    start: { label: "Start", icon: <PlayIcon /> },
    complete: { label: "Complete", icon: <CheckIcon /> },
    requeue: { label: job.status === "failed" ? "Re-queue" : "Restore", icon: <RotateCcwIcon /> },
  };

  const secondaryItem = (a: JobAction) => {
    switch (a) {
      case "pause":
        return (
          <DropdownMenuItem key={a} onSelect={() => run("pause")}>
            <PauseIcon /> Pause
          </DropdownMenuItem>
        );
      case "resume":
        return (
          <DropdownMenuItem key={a} onSelect={() => run("resume")}>
            <PlayIcon /> Resume
          </DropdownMenuItem>
        );
      case "complete":
        return (
          <DropdownMenuItem key={a} onSelect={() => setDialog("complete")}>
            <CheckIcon /> {job.connected ? "Mark printed (record only)" : "Complete"}
          </DropdownMenuItem>
        );
      case "fail":
        return (
          <DropdownMenuItem key={a} onSelect={() => setDialog("fail")}>
            <XCircleIcon /> {job.connected ? "Mark failed (record only)" : "Mark failed"}
          </DropdownMenuItem>
        );
      default:
        return null;
    }
  };
  const menuItems = secondary.filter((a) => a !== "cancel" && a !== "start");
  const canCancel = secondary.includes("cancel");
  const primaryForPaused = job.status === "paused" && !job.connected ? "resume" : null;

  return (
    <div className="flex items-center gap-1.5">
      {primaryForPaused ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run("resume")}>
          {pending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />} Resume
        </Button>
      ) : (
        primary && (
          <Button size="sm" variant={primary === "start" ? "default" : "outline"} disabled={pending} onClick={onPrimary}>
            {pending ? <Loader2Icon className="animate-spin" /> : PRIMARY_LABEL[primary].icon}
            {PRIMARY_LABEL[primary].label}
          </Button>
        )
      )}
      {(menuItems.filter((a) => a !== primaryForPaused).length > 0 || canCancel) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`More actions for job ${job.job_number}`} disabled={pending}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menuItems.filter((a) => a !== primaryForPaused).map(secondaryItem)}
            {canCancel && (
              <ConfirmButton
                title="Cancel this production job?"
                description="The job is removed from the queue. You can restore it later if needed."
                confirmLabel="Cancel job"
                destructive
                onConfirm={() => run("cancel")}
                trigger={
                  <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                    <XIcon /> Cancel job
                  </DropdownMenuItem>
                }
              />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <StartDialog open={dialog === "start"} onOpenChange={(o) => !o && setDialog(null)} job={job} printers={manualPrinters} pending={pending} onSubmit={(printerId) => run("start", { printerId })} />
      <CompleteDialog open={dialog === "complete"} onOpenChange={(o) => !o && setDialog(null)} job={job} spools={spools} pending={pending} onSubmit={(complete) => run("complete", { complete })} />
      <FailDialog open={dialog === "fail"} onOpenChange={(o) => !o && setDialog(null)} job={job} spools={spools} pending={pending} onSubmit={(extra) => run("fail", extra)} />
    </div>
  );
}

function PhaseNote({ connected }: { connected?: boolean }) {
  return (
    <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
      {connected
        ? "Record only — this does not change anything on the printer. Use it when the printer can't report the outcome itself."
        : "Manual record — for printers that aren't connected to PrintFlow. It doesn't control the printer."}
    </p>
  );
}

function StartDialog({
  open,
  onOpenChange,
  job,
  printers,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  job: ActionJob;
  printers: PrinterOption[];
  pending: boolean;
  onSubmit: (printerId: string) => void;
}) {
  const [printerId, setPrinterId] = useState(
    (job.printer_id && printers.some((p) => p.id === job.printer_id) ? job.printer_id : null) ?? printers.find((p) => p.status !== "printing")?.id ?? "",
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start printing</DialogTitle>
          <DialogDescription>
            {job.product_name} × {job.quantity} · est. {formatDuration(job.estimated_minutes)}
          </DialogDescription>
        </DialogHeader>
        <Field id={`start-printer-${job.id}`} label="Printer">
          <Select value={printerId} onValueChange={setPrinterId}>
            <SelectTrigger id={`start-printer-${job.id}`}>
              <SelectValue placeholder="Choose a printer" />
            </SelectTrigger>
            <SelectContent>
              {printers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.status === "printing" ? " (printing)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <PhaseNote />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!printerId || pending} onClick={() => onSubmit(printerId)}>
            {pending && <Loader2Icon className="animate-spin" />}
            Start job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SpoolSelect({ id, value, onChange, spools }: { id: string; value: string; onChange: (v: string) => void; spools: SpoolOption[] }) {
  return (
    <Select value={value || "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">Don&apos;t deduct from a spool</SelectItem>
        {spools.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {spoolLabel(s)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CompleteDialog({
  open,
  onOpenChange,
  job,
  spools,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  job: ActionJob;
  spools: SpoolOption[];
  pending: boolean;
  onSubmit: (v: { actual_minutes: number | null; actual_grams: string; filament_id: string; notes: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && <CompleteForm job={job} spools={spools} pending={pending} onSubmit={onSubmit} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CompleteForm({
  job,
  spools,
  pending,
  onSubmit,
  onCancel,
}: {
  job: ActionJob;
  spools: SpoolOption[];
  pending: boolean;
  onSubmit: (v: { actual_minutes: number | null; actual_grams: string; filament_id: string; notes: string }) => void;
  onCancel: () => void;
}) {
  const [elapsed] = useState(() => elapsedPrintMinutes(job));
  const [minutes, setMinutes] = useState(String(elapsed > 0 ? elapsed : job.estimated_minutes));
  const [grams, setGrams] = useState(String(job.estimated_grams));
  const [spool, setSpool] = useState(() => bestSpool(job, spools));
  const [notes, setNotes] = useState("");
  return (
    <>
      <DialogHeader>
        <DialogTitle>Complete job</DialogTitle>
        <DialogDescription>
          {job.product_name} × {job.quantity}. Record what was actually used — filament is only deducted now, not when the job
          was created.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`c-min-${job.id}`} label="Actual print time (minutes)" hint={`Estimated ${formatDuration(job.estimated_minutes)}${elapsed ? ` · tracked ${formatDuration(elapsed)}` : ""}`}>
          <Input id={`c-min-${job.id}`} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
        <Field id={`c-g-${job.id}`} label="Filament used (g)" hint={`Estimated ${formatGrams(job.estimated_grams)}`}>
          <Input id={`c-g-${job.id}`} inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
        </Field>
        <Field id={`c-s-${job.id}`} label="Deduct from spool" className="sm:col-span-2">
          <SpoolSelect id={`c-s-${job.id}`} value={spool} onChange={setSpool} spools={spools} />
        </Field>
        <Field id={`c-n-${job.id}`} label="Notes" className="sm:col-span-2">
          <Textarea id={`c-n-${job.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <PhaseNote connected={job.connected} />
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            onSubmit({ actual_minutes: minutes === "" ? null : Math.round(Number(minutes)), actual_grams: grams, filament_id: spool, notes })
          }
        >
          {pending && <Loader2Icon className="animate-spin" />}
          Mark printed
        </Button>
      </DialogFooter>
    </>
  );
}

function FailDialog({
  open,
  onOpenChange,
  job,
  spools,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  job: ActionJob;
  spools: SpoolOption[];
  pending: boolean;
  onSubmit: (v: { failureReason: string; wasteGrams: string; wasteFilamentId: string }) => void;
}) {
  const [reason, setReason] = useState("");
  const [waste, setWaste] = useState("");
  const [spool, setSpool] = useState(() => bestSpool(job, spools));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark job as failed</DialogTitle>
          <DialogDescription>The job moves to the Failed list so you can re-queue it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`f-r-${job.id}`} label="What went wrong?" className="sm:col-span-2">
            <Textarea id={`f-r-${job.id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Spaghetti at 40%, bed adhesion" />
          </Field>
          <Field id={`f-w-${job.id}`} label="Wasted filament (g)" hint="Optional">
            <Input id={`f-w-${job.id}`} inputMode="decimal" value={waste} onChange={(e) => setWaste(e.target.value)} />
          </Field>
          <Field id={`f-s-${job.id}`} label="From spool">
            <SpoolSelect id={`f-s-${job.id}`} value={spool} onChange={setSpool} spools={spools} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => onSubmit({ failureReason: reason, wasteGrams: waste, wasteFilamentId: spool })}>
            {pending && <Loader2Icon className="animate-spin" />}
            Mark failed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
