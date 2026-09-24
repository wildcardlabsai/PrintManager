"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { updateSettingsAction } from "@/actions/settings";
import { Field, FormSection } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { CURRENCIES, SHIPPING_PROVIDER_LABELS } from "@/lib/domain/labels";
import { formatOrderNumber } from "@/lib/domain/order-number";
import { SHIPPING_PROVIDERS, type Printer, type Settings, type ShippingProvider } from "@/types/db";

const NOTIFICATIONS: { key: string; label: string; description: string }[] = [
  { key: "new_order", label: "New orders", description: "Highlight new orders that need confirming on the dashboard." },
  { key: "job_failed", label: "Failed prints", description: "Show failed production jobs as an alert on the dashboard." },
  { key: "low_filament", label: "Low filament", description: "Warn on the dashboard when a spool drops below the threshold." },
  { key: "daily_summary", label: "Daily summary email", description: "Saved for when email delivery is added in a later phase." },
];

const TIMEZONES = ["Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney", "UTC"];

export function SettingsForm({ settings, printers }: { settings: Settings; printers: Pick<Printer, "id" | "name">[] }) {
  const { pending, execute } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [v, setV] = useState({
    business_name: settings.business_name,
    currency: settings.currency,
    timezone: settings.timezone,
    electricity_cost_per_hour: String(settings.electricity_cost_per_hour),
    default_filament_cost_per_kg: String(settings.default_filament_cost_per_kg),
    default_packaging_cost: String(settings.default_packaging_cost),
    default_shipping_provider: settings.default_shipping_provider,
    default_printer_id: settings.default_printer_id ?? "",
    order_number_prefix: settings.order_number_prefix,
    order_number_format: settings.order_number_format,
    order_number_padding: String(settings.order_number_padding),
    next_order_number: String(settings.next_order_number),
    low_filament_threshold_g: String(settings.low_filament_threshold_g),
  });
  const [notifications, setNotifications] = useState<Record<string, boolean>>(settings.notifications ?? {});
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const preview = v.order_number_format.includes("{SEQ}")
    ? formatOrderNumber(v.order_number_format, v.order_number_prefix, Number(v.next_order_number) || 1, Number(v.order_number_padding) || 1)
    : "Format must include {SEQ}";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const r = await execute(() => updateSettingsAction({ ...v, notifications }));
    setErrors(r.ok ? {} : r.fieldErrors ?? {});
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormSection title="Business">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="s-name" label="Business name" required error={errors.business_name}>
            <Input id="s-name" value={v.business_name} onChange={set("business_name")} />
          </Field>
          <Field id="s-currency" label="Currency" error={errors.currency}>
            <Select value={v.currency} onValueChange={(c) => setV((s) => ({ ...s, currency: c }))}>
              <SelectTrigger id="s-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(new Set([...CURRENCIES, v.currency])).map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="s-tz" label="Timezone" hint="Used for 'today' in dashboards and reports">
            <Select value={v.timezone} onValueChange={(t) => setV((s) => ({ ...s, timezone: t }))}>
              <SelectTrigger id="s-tz">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(new Set([...TIMEZONES, v.timezone])).map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </FormSection>

      <FormSection title="Production costs" description="Used to calculate every product's unit cost. Changing these recalculates product costs; existing orders keep the costs they were placed with.">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field id="s-elec" label="Electricity per hour" error={errors.electricity_cost_per_hour}>
            <Input id="s-elec" inputMode="decimal" value={v.electricity_cost_per_hour} onChange={set("electricity_cost_per_hour")} />
          </Field>
          <Field id="s-fil" label="Filament per kg" error={errors.default_filament_cost_per_kg}>
            <Input id="s-fil" inputMode="decimal" value={v.default_filament_cost_per_kg} onChange={set("default_filament_cost_per_kg")} />
          </Field>
          <Field id="s-pack" label="Packaging per order item" error={errors.default_packaging_cost}>
            <Input id="s-pack" inputMode="decimal" value={v.default_packaging_cost} onChange={set("default_packaging_cost")} />
          </Field>
          <Field id="s-low" label="Low filament threshold (g)" error={errors.low_filament_threshold_g}>
            <Input id="s-low" inputMode="numeric" value={v.low_filament_threshold_g} onChange={set("low_filament_threshold_g")} />
          </Field>
        </div>
      </FormSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <FormSection title="Shipping">
          <Field id="s-prov" label="Default shipping provider">
            <Select value={v.default_shipping_provider} onValueChange={(p) => setV((s) => ({ ...s, default_shipping_provider: p as ShippingProvider }))}>
              <SelectTrigger id="s-prov">
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
        </FormSection>
        <FormSection title="Printers">
          <Field id="s-printer" label="Default printer" hint="Suggested when starting jobs without a printer">
            <Select value={v.default_printer_id || "__none"} onValueChange={(p) => setV((s) => ({ ...s, default_printer_id: p === "__none" ? "" : p }))}>
              <SelectTrigger id="s-printer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {printers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FormSection>
      </div>

      <FormSection title="Order numbers" description="Tokens: {PREFIX} {YYYY} {YY} {MM} {SEQ}">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field id="s-prefix" label="Prefix" error={errors.order_number_prefix}>
            <Input id="s-prefix" value={v.order_number_prefix} onChange={set("order_number_prefix")} />
          </Field>
          <Field id="s-format" label="Format" error={errors.order_number_format}>
            <Input id="s-format" value={v.order_number_format} onChange={set("order_number_format")} className="font-mono" />
          </Field>
          <Field id="s-pad" label="Number digits" error={errors.order_number_padding}>
            <Input id="s-pad" inputMode="numeric" value={v.order_number_padding} onChange={set("order_number_padding")} />
          </Field>
          <Field id="s-next" label="Next number" error={errors.next_order_number}>
            <Input id="s-next" inputMode="numeric" value={v.next_order_number} onChange={set("next_order_number")} />
          </Field>
        </div>
        <p className="text-sm">
          Next order will be <span className="font-mono font-medium">{preview}</span>
        </p>
      </FormSection>

      <FormSection title="Notifications" description="In-app alerts appear on the dashboard. Email and push delivery will come in a later phase.">
        <ul className="divide-y">
          {NOTIFICATIONS.map((n) => (
            <li key={n.key} className="flex items-center justify-between gap-4 py-2.5">
              <div>
                <Label htmlFor={`n-${n.key}`}>{n.label}</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{n.description}</p>
              </div>
              <Switch id={`n-${n.key}`} checked={notifications[n.key] ?? false} onCheckedChange={(c) => setNotifications((s) => ({ ...s, [n.key]: c }))} />
            </li>
          ))}
        </ul>
      </FormSection>

      <div className="sticky bottom-16 z-10 flex justify-end rounded-lg border bg-card/95 p-3 backdrop-blur lg:bottom-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />}
          Save settings
        </Button>
      </div>
    </form>
  );
}
