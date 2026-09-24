"use client";

import { useState } from "react";
import { DownloadIcon, Loader2Icon, RefreshCwIcon, SendIcon, TagIcon } from "lucide-react";
import { toast } from "sonner";
import { createLabelAction, refreshTrackingAction, sendTrackingToMarketplaceAction } from "@/actions/integrations";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";

export function SendTrackingButton({ orderId, marketplace, retry }: { orderId: string; marketplace: string; retry: boolean }) {
  const { pending, execute } = useAction();
  return (
    <Button
      size="sm"
      variant={retry ? "default" : "outline"}
      disabled={pending}
      onClick={() =>
        execute(() => sendTrackingToMarketplaceAction(orderId), {
          success: (d) => (d.alreadySynced ? `${marketplace} already has this tracking` : `${marketplace} confirmed the shipment`),
        })
      }
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {retry ? "Retry" : "Send tracking to"} {retry ? "" : marketplace}
    </Button>
  );
}

const FORMATS = [
  { value: "letter", label: "Letter" },
  { value: "largeLetter", label: "Large letter" },
  { value: "smallParcel", label: "Small parcel" },
  { value: "mediumParcel", label: "Medium parcel" },
  { value: "parcel", label: "Parcel" },
];

export function CreateLabelDialog({
  orderId,
  orderNumber,
  providerName,
  defaults,
  hasExisting,
}: {
  orderId: string;
  orderNumber: string;
  providerName: string;
  defaults: { weightGrams: number | null; estimatedWeight: number; format: string | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null };
  hasExisting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState(defaults.format ?? "largeLetter");
  const [confirmed, setConfirmed] = useState(false);
  const [another, setAnother] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, execute } = useAction();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await execute(
      () =>
        createLabelAction({
          orderId,
          weightGrams: fd.get("weight"),
          format,
          lengthMm: fd.get("length") || null,
          widthMm: fd.get("width") || null,
          heightMm: fd.get("height") || null,
          serviceCode: fd.get("service"),
          confirmed: confirmed || undefined,
          allowAdditional: another,
        }),
      {
        onSuccess: (d) => {
          if (d.labelStatus === "created") toast.success(`Label created${d.trackingNumber ? ` · tracking ${d.trackingNumber}` : ""}`);
          else toast.success(`Shipment ${d.externalShipmentId} created in Click & Drop`, { description: d.message ?? undefined });
        },
      },
    );
    if (r.ok) {
      setOpen(false);
      setConfirmed(false);
    } else setErrors(r.fieldErrors ?? {});
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <TagIcon /> Create shipping label
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create shipping label — {orderNumber}</DialogTitle>
          <DialogDescription>Sends this order to {providerName} using the order&apos;s shipping address.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="l-weight" label="Package weight (g)" required error={errors.weightGrams} hint={`Estimate from products: ${defaults.estimatedWeight} g`}>
              <Input id="l-weight" name="weight" inputMode="numeric" defaultValue={defaults.weightGrams ?? defaults.estimatedWeight} />
            </Field>
            <Field id="l-format" label="Package format">
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger id="l-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <fieldset className="grid grid-cols-3 gap-2 sm:col-span-2">
              <legend className="mb-1.5 text-[13px] font-medium">Dimensions (mm, optional)</legend>
              <Input name="length" aria-label="Length (mm)" placeholder="Length" inputMode="numeric" defaultValue={defaults.lengthMm ?? ""} />
              <Input name="width" aria-label="Width (mm)" placeholder="Width" inputMode="numeric" defaultValue={defaults.widthMm ?? ""} />
              <Input name="height" aria-label="Height (mm)" placeholder="Height" inputMode="numeric" defaultValue={defaults.heightMm ?? ""} />
            </fieldset>
            <Field id="l-service" label="Royal Mail service code" hint="Optional. Leave blank to let your Click & Drop shipping rules choose." className="sm:col-span-2">
              <Input id="l-service" name="service" maxLength={10} className="font-mono" />
            </Field>
          </div>
          {hasExisting && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={another} onCheckedChange={(c) => setAnother(Boolean(c))} className="mt-0.5" />
              This order already has a shipment at the carrier. Create another one anyway.
            </label>
          )}
          <label className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <Checkbox checked={confirmed} onCheckedChange={(c) => setConfirmed(Boolean(c))} className="mt-0.5" />
            <span>
              I understand this creates a real order in my {providerName} account{" "}
              <span className="block text-xs">Labels you print or buy there are charged to your account. Cancel unwanted ones in Click &amp; Drop.</span>
            </span>
          </label>
          {errors.confirmed && <p className="text-xs text-destructive">{errors.confirmed}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !confirmed || (hasExisting && !another)}>
              {pending && <Loader2Icon className="animate-spin" />} Create label
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RefreshTrackingButton({ orderId }: { orderId: string }) {
  const { pending, execute } = useAction();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => execute(() => refreshTrackingAction(orderId), { success: (t) => (t.trackingNumber ? `Tracking ${t.trackingNumber}` : `No tracking yet (${t.status ?? "pending"})`) })}
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Refresh tracking
    </Button>
  );
}

export function DownloadLabelLink({ orderId }: { orderId: string }) {
  return (
    <Button asChild size="sm" variant="outline">
      <a href={`/api/shipping/labels/${orderId}`} target="_blank" rel="noopener">
        <DownloadIcon /> Label PDF
      </a>
    </Button>
  );
}
