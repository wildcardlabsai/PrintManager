"use client";

import { useState } from "react";
import { Loader2Icon, PencilIcon } from "lucide-react";
import { updateOrderDetailsAction } from "@/actions/orders";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { PAYMENT_STATUS_META } from "@/lib/domain/labels";
import { PAYMENT_STATUSES, type Order, type PaymentStatus } from "@/types/db";

export function EditOrderDialog({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const [payment, setPayment] = useState<PaymentStatus>(order.payment_status);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, execute } = useAction();
  const a = order.shipping_address ?? {};

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => fd.get(k);
    const result = await execute(() =>
      updateOrderDetailsAction(order.id, {
        payment_status: payment,
        external_order_id: get("external_order_id"),
        shipping_charged: get("shipping_charged"),
        discount: get("discount"),
        fees: get("fees"),
        shipping_address: {
          line1: get("line1"),
          line2: get("line2"),
          city: get("city"),
          region: get("region"),
          postcode: get("postcode"),
          country: get("country"),
        },
        customer_notes: get("customer_notes"),
        internal_notes: get("internal_notes"),
      }),
    );
    if (result.ok) {
      setOpen(false);
      setErrors({});
    } else setErrors(result.fieldErrors ?? {});
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PencilIcon /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit order {order.order_number}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="e-payment" label="Payment">
              <Select value={payment} onValueChange={(v) => setPayment(v as PaymentStatus)}>
                <SelectTrigger id="e-payment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PAYMENT_STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="e-ext" label="External order ID" className="sm:col-span-2" error={errors.external_order_id}>
              <Input id="e-ext" name="external_order_id" defaultValue={order.external_order_id ?? ""} />
            </Field>
            <Field id="e-ship" label="Shipping charged" error={errors.shipping_charged}>
              <Input id="e-ship" name="shipping_charged" inputMode="decimal" defaultValue={order.shipping_charged} />
            </Field>
            <Field id="e-disc" label="Discount" error={errors.discount}>
              <Input id="e-disc" name="discount" inputMode="decimal" defaultValue={order.discount} />
            </Field>
            <Field id="e-fees" label="Fees" error={errors.fees}>
              <Input id="e-fees" name="fees" inputMode="decimal" defaultValue={order.fees} />
            </Field>
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-[13px] font-medium">Shipping address</legend>
            <Input name="line1" aria-label="Address line 1" placeholder="Address line 1" defaultValue={a.line1 ?? ""} className="sm:col-span-2" />
            <Input name="line2" aria-label="Address line 2" placeholder="Address line 2" defaultValue={a.line2 ?? ""} className="sm:col-span-2" />
            <Input name="city" aria-label="Town / city" placeholder="Town / city" defaultValue={a.city ?? ""} />
            <Input name="region" aria-label="County / region" placeholder="County / region" defaultValue={a.region ?? ""} />
            <Input name="postcode" aria-label="Postcode" placeholder="Postcode" defaultValue={a.postcode ?? ""} />
            <Input name="country" aria-label="Country" placeholder="Country" defaultValue={a.country ?? ""} />
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="e-cn" label="Customer notes">
              <Textarea id="e-cn" name="customer_notes" rows={3} defaultValue={order.customer_notes ?? ""} />
            </Field>
            <Field id="e-in" label="Internal notes">
              <Textarea id="e-in" name="internal_notes" rows={3} defaultValue={order.internal_notes ?? ""} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
