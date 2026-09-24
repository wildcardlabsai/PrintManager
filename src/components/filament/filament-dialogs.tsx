"use client";

import { useState } from "react";
import { Loader2Icon, MinusCircleIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { createFilamentAction, deleteFilamentAction, recordFilamentUsageAction, updateFilamentAction } from "@/actions/filaments";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { formatGrams } from "@/lib/domain/dates";
import { MATERIALS, SPOOL_STATUS_META } from "@/lib/domain/labels";
import { formatMoney, toNumber } from "@/lib/domain/money";
import { SPOOL_STATUSES, type Filament, type SpoolStatus } from "@/types/db";

export function FilamentFormDialog({ spool, currency, trigger }: { spool?: Filament; currency: string; trigger: React.ReactElement }) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<SpoolStatus>(spool?.status ?? "sealed");
  const [material, setMaterial] = useState(spool?.material ?? "PLA");
  const [weight, setWeight] = useState(String(spool?.weight_purchased_g ?? 1000));
  const [cost, setCost] = useState(String(spool?.cost ?? ""));
  const { pending, execute } = useAction();
  const custom = !(MATERIALS as readonly string[]).includes(material);
  const perKg = toNumber(weight) > 0 ? (toNumber(cost) / toNumber(weight)) * 1000 : 0;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = { ...Object.fromEntries(new FormData(e.currentTarget)), status, material };
    const r = await execute(() => (spool ? updateFilamentAction(spool.id, values) : createFilamentAction(values)));
    if (r.ok) {
      setOpen(false);
      setErrors({});
    } else setErrors(r.fieldErrors ?? {});
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{spool ? "Edit spool" : "Add spool"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="f-brand" label="Brand">
              <Input id="f-brand" name="brand" defaultValue={spool?.brand ?? ""} />
            </Field>
            <Field id="f-material" label="Material" required error={errors.material}>
              <Select value={custom ? "__custom" : material} onValueChange={(v) => setMaterial(v === "__custom" ? "" : v)}>
                <SelectTrigger id="f-material">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIALS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom">Other…</SelectItem>
                </SelectContent>
              </Select>
              {custom && <Input aria-label="Custom material" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="e.g. PLA-CF" className="mt-1.5" />}
            </Field>
            <Field id="f-colour" label="Colour" required error={errors.colour}>
              <Input id="f-colour" name="colour" defaultValue={spool?.colour ?? ""} />
            </Field>
            <Field id="f-hex" label="Swatch" error={errors.colour_hex} hint="Optional hex, e.g. #C62828">
              <Input id="f-hex" name="colour_hex" defaultValue={spool?.colour_hex ?? ""} placeholder="#000000" />
            </Field>
            <Field id="f-weight" label="Weight purchased (g)" required error={errors.weight_purchased_g}>
              <Input id="f-weight" name="weight_purchased_g" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </Field>
            <Field id="f-remaining" label="Remaining (g)" required error={errors.remaining_g}>
              <Input id="f-remaining" name="remaining_g" inputMode="decimal" defaultValue={spool?.remaining_g ?? 1000} />
            </Field>
            <Field id="f-cost" label={`Cost (${currency})`} error={errors.cost} hint={perKg ? `${formatMoney(perKg, currency)}/kg · ${formatMoney(perKg / 1000, currency)}/g` : undefined}>
              <Input id="f-cost" name="cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
            </Field>
            <Field id="f-status" label="Status">
              <Select value={status} onValueChange={(v) => setStatus(v as SpoolStatus)}>
                <SelectTrigger id="f-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPOOL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SPOOL_STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="f-date" label="Purchased on" error={errors.purchased_on}>
              <Input id="f-date" name="purchased_on" type="date" defaultValue={spool?.purchased_on ?? ""} />
            </Field>
            <Field id="f-notes" label="Notes" className="sm:col-span-2">
              <Textarea id="f-notes" name="notes" rows={2} defaultValue={spool?.notes ?? ""} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              {spool ? "Save" : "Add spool"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RecordUsageDialog({ spool }: { spool: Filament }) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, execute } = useAction();
  const label = [spool.brand, spool.material, spool.colour].filter(Boolean).join(" ");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await execute(() => recordFilamentUsageAction({ filament_id: spool.id, grams: fd.get("grams"), note: fd.get("note") }), {
      success: (d) => `Recorded. ${formatGrams(d.remaining)} left on ${label}.`,
    });
    if (r.ok) {
      setOpen(false);
      setErrors({});
    } else setErrors(r.fieldErrors ?? {});
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Record usage for ${label}`} title="Record usage">
          <MinusCircleIcon />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record filament usage</DialogTitle>
          <DialogDescription>
            {label} · {formatGrams(spool.remaining_g)} remaining. Use this for test prints or waste not linked to a job — job
            usage is recorded when you complete the job.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field id={`u-g-${spool.id}`} label="Grams used" required error={errors.grams}>
            <Input id={`u-g-${spool.id}`} name="grams" inputMode="decimal" autoFocus />
          </Field>
          <Field id={`u-n-${spool.id}`} label="Note">
            <Input id={`u-n-${spool.id}`} name="note" placeholder="e.g. Calibration print" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Record usage
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SpoolRowActions({ spool, currency }: { spool: Filament; currency: string }) {
  const { execute } = useAction();
  return (
    <div className="flex justify-end">
      <RecordUsageDialog spool={spool} />
      <FilamentFormDialog
        spool={spool}
        currency={currency}
        trigger={
          <Button size="icon-sm" variant="ghost" aria-label="Edit spool">
            <PencilIcon />
          </Button>
        }
      />
      <ConfirmButton
        title="Delete this spool?"
        description="Spools with recorded usage can't be deleted — archive them instead to keep your history."
        confirmLabel="Delete"
        destructive
        onConfirm={() => execute(() => deleteFilamentAction(spool.id))}
        trigger={
          <Button size="icon-sm" variant="ghost" aria-label="Delete spool">
            <Trash2Icon />
          </Button>
        }
      />
    </div>
  );
}
