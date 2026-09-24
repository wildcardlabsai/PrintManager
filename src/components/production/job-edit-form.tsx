"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { updateJobAction } from "@/actions/production";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { PRIORITY_META } from "@/lib/domain/labels";
import { JOB_PRIORITIES, type JobPriority, type ProductionJob } from "@/types/db";
import type { PrinterOption } from "./job-actions";

export function JobEditForm({ job, printers }: { job: ProductionJob; printers: PrinterOption[] }) {
  const { pending, execute } = useAction();
  const [printerId, setPrinterId] = useState(job.printer_id ?? "");
  const [priority, setPriority] = useState<JobPriority>(job.priority);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const locked = job.status === "printed" || job.status === "cancelled";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await execute(() =>
      updateJobAction(job.id, {
        printer_id: printerId,
        priority,
        material: fd.get("material"),
        colour: fd.get("colour"),
        estimated_minutes: fd.get("estimated_minutes"),
        estimated_grams: fd.get("estimated_grams"),
        notes: fd.get("notes"),
      }),
    );
    setErrors(r.ok ? {} : r.fieldErrors ?? {});
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="j-printer" label="Printer">
          <Select value={printerId || "__none"} onValueChange={(v) => setPrinterId(v === "__none" ? "" : v)} disabled={locked}>
            <SelectTrigger id="j-printer">
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
        </Field>
        <Field id="j-priority" label="Priority">
          <Select value={priority} onValueChange={(v) => setPriority(v as JobPriority)} disabled={locked}>
            <SelectTrigger id="j-priority">
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
        </Field>
        <Field id="j-material" label="Material">
          <Input id="j-material" name="material" defaultValue={job.material ?? ""} disabled={locked} />
        </Field>
        <Field id="j-colour" label="Colour">
          <Input id="j-colour" name="colour" defaultValue={job.colour ?? ""} disabled={locked} />
        </Field>
        <Field id="j-min" label="Estimated time (minutes)" error={errors.estimated_minutes}>
          <Input id="j-min" name="estimated_minutes" inputMode="numeric" defaultValue={job.estimated_minutes} disabled={locked} />
        </Field>
        <Field id="j-g" label="Estimated filament (g)" error={errors.estimated_grams}>
          <Input id="j-g" name="estimated_grams" inputMode="decimal" defaultValue={job.estimated_grams} disabled={locked} />
        </Field>
        <Field id="j-notes" label="Notes" className="sm:col-span-2">
          <Textarea id="j-notes" name="notes" rows={3} defaultValue={job.notes ?? ""} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />}
          Save job
        </Button>
      </div>
    </form>
  );
}
