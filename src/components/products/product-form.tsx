"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { createProductAction, updateProductAction } from "@/actions/products";
import { Field, FormSection } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { productUnitCost, type CostingSettings } from "@/lib/domain/costing";
import { formatDuration } from "@/lib/domain/dates";
import { MATERIALS, PACKAGING_TYPES } from "@/lib/domain/labels";
import { formatMoney, toNumber } from "@/lib/domain/money";
import type { Printer, Product } from "@/types/db";
import { CostBreakdownTable } from "./cost-breakdown";

type PrinterOption = Pick<Printer, "id" | "name" | "model">;

export function ProductForm({
  product,
  compatiblePrinterIds = [],
  printers,
  settings,
  currency,
}: {
  product?: Product;
  compatiblePrinterIds?: string[];
  printers: PrinterOption[];
  settings: CostingSettings;
  currency: string;
}) {
  const router = useRouter();
  const { pending, execute } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const p = product;

  const [v, setV] = useState({
    sku: p?.sku ?? "",
    name: p?.name ?? "",
    description: p?.description ?? "",
    selling_price: p ? String(p.selling_price) : "",
    filament_grams: p ? String(p.filament_grams) : "",
    print_hours: p ? String(Math.floor(p.print_minutes / 60)) : "",
    print_mins: p ? String(p.print_minutes % 60) : "",
    filament_cost_per_kg: p?.filament_cost_per_kg != null ? String(p.filament_cost_per_kg) : "",
    packaging_cost: p?.packaging_cost != null ? String(p.packaging_cost) : "",
    other_cost: p ? String(p.other_cost) : "0",
    material: p?.material ?? "PLA",
    default_colour: p?.default_colour ?? "",
    packaging_type: p?.packaging_type ?? "",
    default_printer_id: p?.default_printer_id ?? "",
    notes: p?.notes ?? "",
    is_active: p?.is_active ?? true,
  });
  const [compat, setCompat] = useState<string[]>(compatiblePrinterIds.length ? compatiblePrinterIds : printers.map((x) => x.id));
  const set = (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((s) => ({ ...s, [key]: e.target.value }));

  const printMinutes = Math.max(0, Math.round(toNumber(v.print_hours) * 60 + toNumber(v.print_mins)));
  const breakdown = useMemo(
    () =>
      productUnitCost(
        {
          filament_grams: toNumber(v.filament_grams),
          print_minutes: printMinutes,
          filament_cost_per_kg: v.filament_cost_per_kg === "" ? null : toNumber(v.filament_cost_per_kg),
          packaging_cost: v.packaging_cost === "" ? null : toNumber(v.packaging_cost),
          other_cost: toNumber(v.other_cost),
        },
        settings,
      ),
    [v.filament_grams, printMinutes, v.filament_cost_per_kg, v.packaging_cost, v.other_cost, settings],
  );
  const costPerKg = v.filament_cost_per_kg === "" ? settings.default_filament_cost_per_kg : toNumber(v.filament_cost_per_kg);
  const customMaterial = !(MATERIALS as readonly string[]).includes(v.material);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      sku: v.sku,
      name: v.name,
      description: v.description,
      selling_price: v.selling_price,
      filament_grams: v.filament_grams || 0,
      print_minutes: printMinutes,
      filament_cost_per_kg: v.filament_cost_per_kg,
      packaging_cost: v.packaging_cost,
      other_cost: v.other_cost || 0,
      material: v.material,
      default_colour: v.default_colour,
      packaging_type: v.packaging_type,
      default_printer_id: v.default_printer_id,
      compatible_printer_ids: compat,
      notes: v.notes,
      is_active: v.is_active,
    };
    const result = await execute<unknown>(() => (p ? updateProductAction(p.id, payload) : createProductAction(payload)));
    if (result.ok) {
      setErrors({});
      const data = result.data as { id?: string } | undefined;
      if (!p && data?.id) router.push(`/products/${data.id}`);
    } else setErrors(result.fieldErrors ?? {});
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <FormSection title="Product">
          <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
            <Field id="p-name" label="Product name" required error={errors.name}>
              <Input id="p-name" value={v.name} onChange={set("name")} aria-invalid={!!errors.name} />
            </Field>
            <Field id="p-sku" label="SKU" required error={errors.sku} hint="Used to match marketplace orders">
              <Input id="p-sku" value={v.sku} onChange={set("sku")} aria-invalid={!!errors.sku} className="font-mono" />
            </Field>
          </div>
          <Field id="p-desc" label="Description">
            <Textarea id="p-desc" value={v.description} onChange={set("description")} rows={3} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="p-price" label={`Selling price (${currency})`} required error={errors.selling_price}>
              <Input id="p-price" inputMode="decimal" value={v.selling_price} onChange={set("selling_price")} aria-invalid={!!errors.selling_price} />
            </Field>
            <Field id="p-material" label="Material" required error={errors.material}>
              <Select
                value={customMaterial ? "__custom" : v.material}
                onValueChange={(val) => setV((s) => ({ ...s, material: val === "__custom" ? "" : val }))}
              >
                <SelectTrigger id="p-material">
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
              {customMaterial && (
                <Input aria-label="Custom material" placeholder="e.g. PLA-CF" value={v.material} onChange={set("material")} className="mt-1.5" />
              )}
            </Field>
            <Field id="p-colour" label="Default colour">
              <Input id="p-colour" value={v.default_colour} onChange={set("default_colour")} />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="p-active" checked={v.is_active} onCheckedChange={(c) => setV((s) => ({ ...s, is_active: c }))} />
            <Label htmlFor="p-active">Active — available for new orders</Label>
          </div>
        </FormSection>

        <FormSection title="Production" description="Per unit. Used for costing, production jobs and time estimates.">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="p-grams" label="Filament (g)" error={errors.filament_grams}>
              <Input id="p-grams" inputMode="decimal" value={v.filament_grams} onChange={set("filament_grams")} />
            </Field>
            <div className="space-y-1.5">
              <Label htmlFor="p-hours">Print time</Label>
              <div className="flex items-center gap-1.5">
                <Input id="p-hours" aria-label="Hours" inputMode="numeric" value={v.print_hours} onChange={set("print_hours")} className="w-full" />
                <span className="text-xs text-muted-foreground">h</span>
                <Input aria-label="Minutes" inputMode="numeric" value={v.print_mins} onChange={set("print_mins")} className="w-full" />
                <span className="text-xs text-muted-foreground">m</span>
              </div>
              {errors.print_minutes && <p className="text-xs text-destructive">{errors.print_minutes}</p>}
            </div>
            <Field id="p-printer" label="Default printer">
              <Select value={v.default_printer_id || "__none"} onValueChange={(val) => setV((s) => ({ ...s, default_printer_id: val === "__none" ? "" : val }))}>
                <SelectTrigger id="p-printer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No default</SelectItem>
                  {printers.map((pr) => (
                    <SelectItem key={pr.id} value={pr.id}>
                      {pr.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {printers.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-[13px] font-medium">Compatible printers</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {printers.map((pr) => (
                  <label key={pr.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={compat.includes(pr.id)}
                      onCheckedChange={(c) => setCompat((s) => (c ? [...s, pr.id] : s.filter((x) => x !== pr.id)))}
                    />
                    {pr.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </FormSection>

        <FormSection title="Costs & packaging" description="Leave blank to use the defaults from Settings.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="p-fcost" label={`Filament cost per kg (${currency})`} error={errors.filament_cost_per_kg} hint={`Default ${formatMoney(settings.default_filament_cost_per_kg, currency)}`}>
              <Input id="p-fcost" inputMode="decimal" value={v.filament_cost_per_kg} onChange={set("filament_cost_per_kg")} placeholder={String(settings.default_filament_cost_per_kg)} />
            </Field>
            <Field id="p-ptype" label="Packaging type">
              <Select value={v.packaging_type || "__none"} onValueChange={(val) => setV((s) => ({ ...s, packaging_type: val === "__none" ? "" : val }))}>
                <SelectTrigger id="p-ptype">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Not set</SelectItem>
                  {PACKAGING_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="p-pcost" label={`Packaging cost (${currency})`} error={errors.packaging_cost} hint={`Default ${formatMoney(settings.default_packaging_cost, currency)}`}>
              <Input id="p-pcost" inputMode="decimal" value={v.packaging_cost} onChange={set("packaging_cost")} placeholder={String(settings.default_packaging_cost)} />
            </Field>
            <Field id="p-ocost" label={`Other cost (${currency})`} error={errors.other_cost} hint="Hardware, magnets, inserts…">
              <Input id="p-ocost" inputMode="decimal" value={v.other_cost} onChange={set("other_cost")} />
            </Field>
          </div>
          <Field id="p-notes" label="Internal notes">
            <Textarea id="p-notes" value={v.notes} onChange={set("notes")} rows={2} />
          </Field>
        </FormSection>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <section className="rounded-lg border bg-card">
          <header className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Unit cost</h2>
            <p className="text-xs text-muted-foreground">Updates as you type</p>
          </header>
          <CostBreakdownTable
            className="px-4 py-1"
            breakdown={breakdown}
            sellingPrice={toNumber(v.selling_price)}
            currency={currency}
            detail={{
              filament: `${toNumber(v.filament_grams)} g × ${formatMoney(costPerKg, currency)}/kg`,
              electricity: `${formatDuration(printMinutes)} × ${formatMoney(settings.electricity_cost_per_hour, currency)}/h`,
            }}
          />
        </section>
        <div className="flex gap-2">
          {p && (
            <Button type="button" variant="outline" className="flex-1" onClick={() => router.push("/products")}>
              Back
            </Button>
          )}
          <Button type="submit" className="flex-1" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" />}
            {p ? "Save product" : "Create product"}
          </Button>
        </div>
      </div>
    </form>
  );
}
