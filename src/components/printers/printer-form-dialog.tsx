"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { archivePrinterAction, createPrinterAction, updatePrinterAction } from "@/actions/printers";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { PRINTER_STATUS_META } from "@/lib/domain/labels";
import { PRINTER_STATUSES, type Printer, type PrinterStatus } from "@/types/db";

export function PrinterFormDialog({ printer, trigger }: { printer?: Printer; trigger: React.ReactElement }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PrinterStatus>(printer?.status ?? "idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, execute } = useAction();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = { ...Object.fromEntries(new FormData(e.currentTarget)), status };
    const r = await execute(() => (printer ? updatePrinterAction(printer.id, values) : createPrinterAction(values)));
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
          <DialogTitle>{printer ? `Edit ${printer.name}` : "Add printer"}</DialogTitle>
          <DialogDescription>Status is set manually in Phase 1. Live printer integration is coming in Phase 3.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pr-name" label="Name" required error={errors.name} className="sm:col-span-2">
              <Input id="pr-name" name="name" defaultValue={printer?.name ?? ""} />
            </Field>
            <Field id="pr-man" label="Manufacturer">
              <Input id="pr-man" name="manufacturer" defaultValue={printer?.manufacturer ?? ""} />
            </Field>
            <Field id="pr-model" label="Model">
              <Input id="pr-model" name="model" defaultValue={printer?.model ?? ""} />
            </Field>
            <Field id="pr-status" label="Status (manual)">
              <Select value={status} onValueChange={(v) => setStatus(v as PrinterStatus)}>
                <SelectTrigger id="pr-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRINTER_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PRINTER_STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="pr-ip" label="IP address" hint="For Phase 3 integration">
              <Input id="pr-ip" name="ip_address" defaultValue={printer?.ip_address ?? ""} placeholder="192.168.1.50" />
            </Field>
            <Field id="pr-loc" label="Location">
              <Input id="pr-loc" name="location" defaultValue={printer?.location ?? ""} placeholder="Workshop shelf 1" />
            </Field>
            <Field id="pr-vol" label="Build volume">
              <Input id="pr-vol" name="build_volume" defaultValue={printer?.build_volume ?? ""} />
            </Field>
            <Field id="pr-cap" label="Capabilities" hint="Comma separated, e.g. PLA, PETG, Multi-colour" className="sm:col-span-2">
              <Input id="pr-cap" name="capabilities" defaultValue={printer?.capabilities.join(", ") ?? ""} />
            </Field>
            <Field id="pr-notes" label="Notes" className="sm:col-span-2">
              <Textarea id="pr-notes" name="notes" rows={2} defaultValue={printer?.notes ?? ""} />
            </Field>
          </div>
          <DialogFooter className="sm:justify-between">
            {printer ? (
              <ConfirmButton
                title={`Archive ${printer.name}?`}
                description="Archived printers are hidden from assignment lists. Job history is kept."
                confirmLabel="Archive"
                destructive
                onConfirm={async () => {
                  const r = await execute(() => archivePrinterAction(printer.id, true));
                  if (r.ok) setOpen(false);
                }}
                trigger={
                  <Button type="button" variant="ghost" className="text-destructive">
                    Archive printer
                  </Button>
                }
              />
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2Icon className="animate-spin" />}
                {printer ? "Save" : "Add printer"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
