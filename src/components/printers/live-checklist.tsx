"use client";

import { CheckCircle2Icon, CircleIcon, Loader2Icon, RotateCcwIcon, ShieldCheckIcon } from "lucide-react";
import { confirmChecklistStepAction, markPrinterVerifiedAction, resetPrinterVerificationAction } from "@/actions/printer-control";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { LIVE_CHECKLIST, checklistComplete } from "@/lib/printers/checklist";
import type { LiveChecklist } from "@/types/db";

/**
 * The live test checklist. Observed steps tick themselves from real printer
 * data; the rest need someone standing at the printer. PrintFlow won't send
 * production jobs until an admin marks the printer verified.
 */
export function LiveChecklistPanel({
  printerId,
  checklist,
  verifiedAt,
  canConfigure,
  identity,
  testPrint,
}: {
  printerId: string;
  checklist: LiveChecklist;
  verifiedAt: string | null;
  canConfigure: boolean;
  identity: string;
  testPrint: React.ReactNode;
}) {
  const { pending, execute } = useAction();
  const complete = checklistComplete(checklist);
  const simulated = Object.values(checklist).some((e) => e?.source === "mock");
  return (
    <div className="space-y-3">
      <ol className="space-y-2 text-[13px]">
        {LIVE_CHECKLIST.map((step, i) => {
          const entry = checklist[step.key];
          return (
            <li key={step.key} className="flex items-start gap-2.5">
              {entry ? (
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Done" />
              ) : (
                <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not done" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {i + 1}. {step.label}
                  {entry?.source === "mock" && <span className="ml-1 text-xs font-normal text-cyan-700">(simulated)</span>}
                  {entry?.note && <span className="ml-1 text-xs font-normal text-muted-foreground">· {entry.note}</span>}
                </p>
                <p className="text-xs text-muted-foreground">{step.help}</p>
                {!entry && step.key === "verify_identity" && <p className="mt-0.5 text-xs">{identity}</p>}
              </div>
              {!entry && canConfigure && step.how === "confirm" && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => execute(() => confirmChecklistStepAction(printerId, step.key, null))}>
                  Confirm
                </Button>
              )}
              {!entry && canConfigure && step.key === "test_print" && testPrint}
            </li>
          );
        })}
      </ol>
      {canConfigure && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {verifiedAt ? (
            <p className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
              <ShieldCheckIcon className="size-4" /> Verified for production{simulated ? " (against a simulated printer)" : ""}
            </p>
          ) : (
            <Button size="sm" disabled={!complete || pending} onClick={() => execute(() => markPrinterVerifiedAction(printerId))}>
              {pending ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />} Mark verified for production
            </Button>
          )}
          <ConfirmButton
            title="Reset the live test checklist?"
            description="PrintFlow will stop sending production jobs to this printer until the checklist is completed again."
            confirmLabel="Reset"
            onConfirm={() => execute(() => resetPrinterVerificationAction(printerId))}
            trigger={
              <Button size="sm" variant="ghost">
                <RotateCcwIcon /> Reset
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}
