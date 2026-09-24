"use client";

import { useState } from "react";
import { Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { deleteVariantAction, saveVariantAction } from "@/actions/products";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field } from "@/components/shared/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { formatMoney } from "@/lib/domain/money";
import type { ProductVariant } from "@/types/db";

export function VariantsPanel({
  productId,
  productSku,
  basePrice,
  variants,
  currency,
}: {
  productId: string;
  productSku: string;
  basePrice: number;
  variants: ProductVariant[];
  currency: string;
}) {
  const [editing, setEditing] = useState<ProductVariant | "new" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [active, setActive] = useState(true);
  const { pending, execute } = useAction();
  const current = editing && editing !== "new" ? editing : null;

  function open(v: ProductVariant | "new") {
    setErrors({});
    setActive(v === "new" ? true : v.is_active);
    setEditing(v);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = { ...Object.fromEntries(new FormData(e.currentTarget)), is_active: active };
    const result = await execute(() => saveVariantAction(productId, current?.id ?? null, values));
    if (result.ok) setEditing(null);
    else setErrors(result.fieldErrors ?? {});
  }

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Variants</h2>
          <p className="text-xs text-muted-foreground">Colours or sizes with their own SKU. Blank fields use the product&apos;s values.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => open("new")}>
          <PlusIcon /> Add
        </Button>
      </header>
      {variants.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">No variants.</p>
      ) : (
        <ul className="divide-y">
          {variants.map((v) => (
            <li key={v.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {v.name}
                  {!v.is_active && (
                    <Badge tone="outline" className="ml-1.5">
                      Inactive
                    </Badge>
                  )}
                </div>
                <div className="font-mono text-xs text-muted-foreground">{v.sku}</div>
              </div>
              <span className="tabular">{formatMoney(v.selling_price ?? basePrice, currency)}</span>
              <Button size="icon-sm" variant="ghost" aria-label={`Edit ${v.name}`} onClick={() => open(v)}>
                <PencilIcon />
              </Button>
              <ConfirmButton
                title={`Remove variant "${v.name}"?`}
                description="Variants used by existing orders are deactivated instead of deleted, so order history stays intact."
                confirmLabel="Remove"
                destructive
                onConfirm={async () => {
                  const r = await deleteVariantAction(productId, v.id);
                  if (r.ok) toast.success(r.data === "deleted" ? "Variant deleted" : "Variant deactivated (used by orders)");
                  else toast.error(r.error);
                }}
                trigger={
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ${v.name}`}>
                    <Trash2Icon />
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{current ? "Edit variant" : "New variant"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="v-name" label="Name" required error={errors.name}>
                <Input id="v-name" name="name" defaultValue={current?.name ?? ""} placeholder="e.g. Red" />
              </Field>
              <Field id="v-sku" label="SKU" required error={errors.sku}>
                <Input id="v-sku" name="sku" defaultValue={current?.sku ?? `${productSku}-`} className="font-mono" />
              </Field>
              <Field id="v-colour" label="Colour">
                <Input id="v-colour" name="colour" defaultValue={current?.colour ?? ""} />
              </Field>
              <Field id="v-material" label="Material">
                <Input id="v-material" name="material" defaultValue={current?.material ?? ""} placeholder="Same as product" />
              </Field>
              <Field id="v-price" label={`Price (${currency})`} error={errors.selling_price}>
                <Input id="v-price" name="selling_price" inputMode="decimal" defaultValue={current?.selling_price ?? ""} placeholder={String(basePrice)} />
              </Field>
              <Field id="v-grams" label="Filament (g)" error={errors.filament_grams}>
                <Input id="v-grams" name="filament_grams" inputMode="decimal" defaultValue={current?.filament_grams ?? ""} placeholder="Same as product" />
              </Field>
              <Field id="v-mins" label="Print time (minutes)" error={errors.print_minutes}>
                <Input id="v-mins" name="print_minutes" inputMode="numeric" defaultValue={current?.print_minutes ?? ""} placeholder="Same as product" />
              </Field>
              <div className="flex items-center gap-2 pt-6">
                <Switch id="v-active" checked={active} onCheckedChange={setActive} />
                <Label htmlFor="v-active">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2Icon className="animate-spin" />}
                Save variant
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
