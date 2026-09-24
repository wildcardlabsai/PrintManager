"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { markShippedAction, updateShipmentAction } from "@/actions/shipping";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { SHIPPING_PROVIDER_LABELS, SHIPPING_SERVICES } from "@/lib/domain/labels";
import { SHIPPING_PROVIDERS, type Shipment, type ShippingProvider } from "@/types/db";

type ShipmentFields = Pick<Shipment, "provider" | "service" | "shipping_cost" | "tracking_number" | "notes">;

/**
 * Edit shipping details / add tracking. With `markShipped`, saving also moves
 * the order to Shipped.
 */
export function ShipmentDialog({
  orderId,
  orderNumber,
  shipment,
  trigger,
  markShipped = false,
  marketplaceName = null,
}: {
  orderId: string;
  orderNumber: string;
  shipment: ShipmentFields | null;
  trigger: React.ReactElement;
  markShipped?: boolean;
  /** "Etsy" / "eBay" when the order came from a connected marketplace. */
  marketplaceName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { pending, execute } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState<ShippingProvider>(shipment?.provider ?? "royal_mail");
  const [sendToMarketplace, setSendToMarketplace] = useState(true);
  const [service, setService] = useState(shipment?.service ?? SHIPPING_SERVICES[shipment?.provider ?? "royal_mail"][0]);

  const services = Array.from(new Set([...(SHIPPING_SERVICES[provider] ?? []), ...(service ? [service] : [])]));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values = {
      provider,
      service,
      shipping_cost: fd.get("shipping_cost"),
      tracking_number: fd.get("tracking_number"),
      notes: fd.get("notes"),
    };
    const result = markShipped
      ? await execute(() => markShippedAction(orderId, values, Boolean(marketplaceName) && sendToMarketplace), {
          success: "Order marked as shipped",
          onSuccess: (d) => {
            if (d.marketplace.status === "synced") toast.success(`Tracking confirmed by ${marketplaceName}`);
            if (d.marketplace.status === "failed")
              toast.error(`${marketplaceName} was not updated`, { description: `${d.marketplace.error ?? ""} You can retry from the order page.` });
          },
        })
      : await execute(() => updateShipmentAction(orderId, values));
    if (result.ok) {
      setOpen(false);
      setErrors({});
    } else setErrors(result.fieldErrors ?? {});
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{markShipped ? `Ship ${orderNumber}` : "Shipping & tracking"}</DialogTitle>
          <DialogDescription>
            Enter the tracking number from the postage you bought. Label purchasing inside PrintFlow arrives in Phase 2.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="s-provider" label="Provider">
              <Select
                value={provider}
                onValueChange={(v) => {
                  setProvider(v as ShippingProvider);
                  setService(SHIPPING_SERVICES[v as ShippingProvider][0] ?? "");
                }}
              >
                <SelectTrigger id="s-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHIPPING_PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {SHIPPING_PROVIDER_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="s-service" label="Service">
              <Select value={service ?? ""} onValueChange={setService}>
                <SelectTrigger id="s-service">
                  <SelectValue placeholder="Choose service" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="s-tracking" label="Tracking number" error={errors.tracking_number} className="sm:col-span-2">
              <Input id="s-tracking" name="tracking_number" defaultValue={shipment?.tracking_number ?? ""} autoFocus autoComplete="off" className="font-mono" />
            </Field>
            <Field id="s-cost" label="Postage cost" hint="What you paid the carrier" error={errors.shipping_cost}>
              <Input id="s-cost" name="shipping_cost" inputMode="decimal" defaultValue={shipment?.shipping_cost ?? 0} />
            </Field>
            <Field id="s-notes" label="Notes" className="sm:col-span-2">
              <Textarea id="s-notes" name="notes" rows={2} defaultValue={shipment?.notes ?? ""} />
            </Field>
          </div>
          {markShipped && marketplaceName && (
            <label className="flex items-start gap-2.5 rounded-md border bg-muted/40 p-3 text-sm">
              <Checkbox checked={sendToMarketplace} onCheckedChange={(c) => setSendToMarketplace(Boolean(c))} className="mt-0.5" />
              <span>
                Also mark the order shipped on {marketplaceName} and send the tracking number to the buyer
                <span className="block text-xs text-muted-foreground">
                  This updates your live {marketplaceName} order. PrintFlow only shows it as synced once {marketplaceName} confirms.
                </span>
              </span>
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              {markShipped ? "Mark as shipped" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
