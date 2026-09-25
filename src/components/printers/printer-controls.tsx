"use client";

import { useState } from "react";
import { CheckCheckIcon, Loader2Icon, PauseIcon, PlayIcon, PlugZapIcon, RefreshCwIcon, SquareIcon } from "lucide-react";
import { confirmBedClearAction, controlJobAction, printerCheckAction } from "@/actions/printer-control";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import { useCommandWatch } from "@/hooks/use-command-watch";
import type { JobStatus } from "@/types/db";

export interface ControlJob {
  id: string;
  label: string;
  productName: string;
  status: JobStatus;
}

/**
 * Pause / resume / stop for the print PrintFlow started, plus plate-clear
 * confirmation and connection checks. Everything goes through server actions
 * that queue a whitelisted command for the Printer Agent.
 */
export function PrinterControls({
  printerId,
  printerName,
  live,
  job,
  rawStatus,
  bedClear,
  canOperate,
  showChecks = false,
  size = "sm",
}: {
  printerId: string;
  printerName: string;
  live: boolean;
  job: ControlJob | null;
  rawStatus: string | null;
  bedClear: boolean;
  canOperate: boolean;
  showChecks?: boolean;
  size?: "sm" | "default";
}) {
  const { pending, execute } = useAction();
  const { watch, watching } = useCommandWatch();
  const [tellPrinter, setTellPrinter] = useState(true);
  if (!canOperate) return null;
  const busy = pending || Boolean(watching);

  async function control(action: "pause" | "resume" | "stop") {
    const r = await execute(() => controlJobAction(job!.id, action, action === "stop"), { success: "" });
    if (r.ok) await watch(r.data.commandId);
  }
  async function check(type: "refresh" | "test_connection") {
    const r = await execute(() => printerCheckAction(printerId, type), { success: "" });
    if (r.ok) await watch(r.data.commandId);
  }

  const printing = rawStatus === "printing" || rawStatus === "heating" || rawStatus === "calibrate_doing";
  const canPause = job && live && (job.status === "printing" || job.status === "sent") && printing;
  const canResume = job && live && job.status === "paused";
  const canStop = job && live && ["sent", "printing", "paused"].includes(job.status);
  const needsClear = !bedClear && !printing && rawStatus !== "pause" && rawStatus !== "pausing";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {busy && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Waiting for the printer" />}
      {canPause && (
        <Button size={size} variant="outline" disabled={busy} onClick={() => control("pause")}>
          <PauseIcon /> Pause
        </Button>
      )}
      {canResume && (
        <Button size={size} variant="outline" disabled={busy} onClick={() => control("resume")}>
          <PlayIcon /> Resume
        </Button>
      )}
      {canStop && (
        <ConfirmButton
          title={`Stop the print on ${printerName}?`}
          description={
            <>
              This cancels <strong>{job!.label}</strong> ({job!.productName}) on the printer. A stopped print can&apos;t be resumed; the job will
              be marked failed so you can retry or reassign it.
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
      {needsClear && (
        <ConfirmButton
          title={`Is the build plate on ${printerName} clear?`}
          description={
            <span className="block space-y-3">
              <span className="block">Remove the finished print and anything else on the plate. PrintFlow won&apos;t start another print on this printer until you confirm.</span>
              {rawStatus === "completed" && (
                <span className="flex items-center gap-2">
                  <Checkbox id={`tell-${printerId}`} checked={tellPrinter} onCheckedChange={(v) => setTellPrinter(v === true)} />
                  <Label htmlFor={`tell-${printerId}`} className="font-normal">
                    Also tell the printer the plate is cleared
                  </Label>
                </span>
              )}
            </span>
          }
          confirmLabel="Plate is clear"
          onConfirm={() => execute(() => confirmBedClearAction(printerId, tellPrinter && rawStatus === "completed"))}
          trigger={
            <Button size={size} variant="outline" disabled={busy}>
              <CheckCheckIcon /> Plate cleared
            </Button>
          }
        />
      )}
      {showChecks && (
        <>
          <Button size={size} variant="outline" disabled={busy} onClick={() => check("refresh")}>
            <RefreshCwIcon /> Refresh status
          </Button>
          <Button size={size} variant="outline" disabled={busy} onClick={() => check("test_connection")}>
            <PlugZapIcon /> Test connection
          </Button>
        </>
      )}
    </div>
  );
}
