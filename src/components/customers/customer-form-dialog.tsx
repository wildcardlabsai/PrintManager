"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { createCustomerAction, updateCustomerAction } from "@/actions/customers";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import type { Customer } from "@/types/db";

type Editable = Pick<
  Customer,
  "name" | "email" | "phone" | "address_line1" | "address_line2" | "city" | "region" | "postcode" | "country" | "notes"
>;

export function CustomerFormDialog({
  customer,
  customerId,
  trigger,
  redirectOnCreate = true,
}: {
  customer?: Editable;
  customerId?: string;
  trigger: React.ReactElement;
  redirectOnCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, execute } = useAction();
  const router = useRouter();
  const isEdit = Boolean(customerId);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const result = await execute<unknown>(() =>
      isEdit ? updateCustomerAction(customerId!, values) : createCustomerAction(values),
    );
    if (result.ok) {
      setErrors({});
      setOpen(false);
      const data = result.data as { id?: string } | undefined;
      if (!isEdit && redirectOnCreate && data?.id) router.push(`/customers/${data.id}`);
    } else {
      setErrors(result.fieldErrors ?? {});
    }
  }

  const v = customer;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit customer" : "New customer"}</DialogTitle>
          <DialogDescription>Contact details and default delivery address.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="c-name" label="Name" required error={errors.name} className="sm:col-span-2">
              <Input id="c-name" name="name" defaultValue={v?.name ?? ""} aria-invalid={!!errors.name} autoFocus />
            </Field>
            <Field id="c-email" label="Email" error={errors.email}>
              <Input id="c-email" name="email" type="email" defaultValue={v?.email ?? ""} aria-invalid={!!errors.email} />
            </Field>
            <Field id="c-phone" label="Phone" error={errors.phone}>
              <Input id="c-phone" name="phone" type="tel" defaultValue={v?.phone ?? ""} />
            </Field>
            <Field id="c-line1" label="Address line 1" className="sm:col-span-2">
              <Input id="c-line1" name="address_line1" defaultValue={v?.address_line1 ?? ""} autoComplete="address-line1" />
            </Field>
            <Field id="c-line2" label="Address line 2" className="sm:col-span-2">
              <Input id="c-line2" name="address_line2" defaultValue={v?.address_line2 ?? ""} autoComplete="address-line2" />
            </Field>
            <Field id="c-city" label="Town / city">
              <Input id="c-city" name="city" defaultValue={v?.city ?? ""} autoComplete="address-level2" />
            </Field>
            <Field id="c-region" label="County / region">
              <Input id="c-region" name="region" defaultValue={v?.region ?? ""} autoComplete="address-level1" />
            </Field>
            <Field id="c-postcode" label="Postcode">
              <Input id="c-postcode" name="postcode" defaultValue={v?.postcode ?? ""} autoComplete="postal-code" />
            </Field>
            <Field id="c-country" label="Country">
              <Input id="c-country" name="country" defaultValue={v?.country ?? "United Kingdom"} autoComplete="country-name" />
            </Field>
            <Field id="c-notes" label="Notes" className="sm:col-span-2">
              <Textarea id="c-notes" name="notes" defaultValue={v?.notes ?? ""} rows={2} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              {isEdit ? "Save changes" : "Create customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
