"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpIcon } from "lucide-react";
import { assignPrinterAction, moveJobAction, setJobPriorityAction } from "@/actions/production";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { PRIORITY_META } from "@/lib/domain/labels";
import { JOB_PRIORITIES, type JobPriority } from "@/types/db";
import type { PrinterOption } from "./job-actions";

export function AssignPrinterSelect({
  jobId,
  printerId,
  printers,
  className,
}: {
  jobId: string;
  printerId: string | null;
  printers: PrinterOption[];
  className?: string;
}) {
  const { pending, execute } = useAction();
  return (
    <Select
      value={printerId ?? "__none"}
      disabled={pending}
      onValueChange={(v) => execute(() => assignPrinterAction(jobId, v === "__none" ? null : v))}
    >
      <SelectTrigger size="sm" className={className ?? "w-44"} aria-label="Assigned printer">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">Unassigned</SelectItem>
        {printers.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PrioritySelect({ jobId, priority, className }: { jobId: string; priority: JobPriority; className?: string }) {
  const { pending, execute } = useAction();
  return (
    <Select value={priority} disabled={pending} onValueChange={(v) => execute(() => setJobPriorityAction(jobId, v))}>
      <SelectTrigger size="sm" className={className ?? "w-28"} aria-label="Priority">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {JOB_PRIORITIES.map((p) => (
          <SelectItem key={p} value={p}>
            {PRIORITY_META[p].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function MoveButtons({ jobId, isFirst, isLast }: { jobId: string; isFirst: boolean; isLast: boolean }) {
  const { pending, execute } = useAction();
  return (
    <div className="flex items-center">
      <Button
        size="icon-sm"
        variant="ghost"
        className="size-7"
        disabled={pending || isFirst}
        aria-label="Print next (move to front)"
        title="Print next"
        onClick={() => execute(() => moveJobAction(jobId, "next"))}
      >
        <ChevronsUpIcon />
      </Button>
      <Button size="icon-sm" variant="ghost" className="size-7" disabled={pending || isFirst} aria-label="Move up" onClick={() => execute(() => moveJobAction(jobId, "up"))}>
        <ArrowUpIcon />
      </Button>
      <Button size="icon-sm" variant="ghost" className="size-7" disabled={pending || isLast} aria-label="Move down" onClick={() => execute(() => moveJobAction(jobId, "down"))}>
        <ArrowDownIcon />
      </Button>
    </div>
  );
}
