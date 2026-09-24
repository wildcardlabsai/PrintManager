"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2Icon, PlusIcon, Trash2Icon, UserPlusIcon, UsersIcon } from "lucide-react";
import { createOrderAction } from "@/actions/orders";
import { Combobox } from "@/components/shared/combobox";
import { Field, FormSection } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { productUnitCost, type CostingSettings } from "@/lib/domain/costing";
import { formatDuration, formatGrams } from "@/lib/domain/dates";
import {
  PAYMENT_STATUS_META,
  PRIORITY_META,
  SALES_CHANNEL_LABELS,
  SHIPPING_PROVIDER_LABELS,
  SHIPPING_SERVICES,
} from "@/lib/domain/labels";
import { formatMoney, toNumber } from "@/lib/domain/money";
import { calculateOrderTotals, mergeOrderLines } from "@/lib/domain/order-pricing";
import type { ProductOption } from "@/lib/services/products";
import {
  JOB_PRIORITIES,
  PAYMENT_STATUSES,
  SALES_CHANNELS,
  SHIPPING_PROVIDERS,
  type Customer,
  type JobPriority,
  type PaymentStatus,
  type SalesChannel,
  type ShippingProvider,
} from "@/types/db";

type CustomerOption = Pick<
  Customer,
  "id" | "name" | "email" | "phone" | "address_line1" | "address_line2" | "city" | "region" | "postcode" | "country"
>;

interface Line {
  key: number;
  productId: string;
  variantId: string | null;
  quantity: string;
  unitPrice: string;
}

const emptyAddress = { line1: "", line2: "", city: "", region: "", postcode: "", country: "United Kingdom" };

function localDateTimeValue(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function OrderForm({
  customers,
  products,
  settings,
  currency,
  defaultProvider,
  initialCustomerId,
}: {
  customers: CustomerOption[];
  products: ProductOption[];
  settings: CostingSettings;
  currency: string;
  defaultProvider: ShippingProvider;
  initialCustomerId?: string | null;
}) {
  const router = useRouter();
  const { pending, execute } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const money = (v: number) => formatMoney(v, currency);

  // Customer
  const [mode, setMode] = useState<"existing" | "new">(customers.length ? "existing" : "new");
  const [customerId, setCustomerId] = useState<string | null>(
    initialCustomerId && customers.some((c) => c.id === initialCustomerId) ? initialCustomerId : null,
  );
  const [newCustomer, setNewCustomer] = useState({ name: "", email: "", phone: "" });
  const [address, setAddress] = useState(() => {
    const c = customers.find((x) => x.id === initialCustomerId);
    return c ? addressOf(c) : emptyAddress;
  });
  const [saveAddress, setSaveAddress] = useState(false);

  // Order meta
  const [channel, setChannel] = useState<SalesChannel>("manual");
  const [externalId, setExternalId] = useState("");
  const [orderDate, setOrderDate] = useState(() => localDateTimeValue());
  const [payment, setPayment] = useState<PaymentStatus>("paid");
  const [priority, setPriority] = useState<JobPriority>("normal");

  // Lines
  const [lines, setLines] = useState<Line[]>([{ key: 1, productId: "", variantId: null, quantity: "1", unitPrice: "" }]);
  const [nextKey, setNextKey] = useState(2);

  // Shipping & money
  const [provider, setProvider] = useState<ShippingProvider>(defaultProvider);
  const [service, setService] = useState(SHIPPING_SERVICES[defaultProvider][0] ?? "");
  const [shippingCharged, setShippingCharged] = useState("0");
  const [postage, setPostage] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [fees, setFees] = useState("0");
  const [customerNotes, setCustomerNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const productOptions = useMemo(
    () =>
      products.flatMap((p) => [
        {
          value: `${p.id}|`,
          label: p.name,
          description: `${p.sku} · ${money(p.selling_price)}`,
          keywords: p.sku,
        },
        ...p.product_variants.map((v) => ({
          value: `${p.id}|${v.id}`,
          label: `${p.name} — ${v.name}`,
          description: `${v.sku} · ${money(v.selling_price ?? p.selling_price)}`,
          keywords: `${v.sku} ${v.colour ?? ""}`,
        })),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, currency],
  );

  function lineDetails(line: Line) {
    const p = productById.get(line.productId);
    if (!p) return null;
    const v = line.variantId ? p.product_variants.find((x) => x.id === line.variantId) : undefined;
    const grams = Number(v?.filament_grams ?? p.filament_grams);
    const minutes = Number(v?.print_minutes ?? p.print_minutes);
    const unitCost = productUnitCost({ ...p, filament_grams: grams, print_minutes: minutes }, settings).total;
    const listPrice = Number(v?.selling_price ?? p.selling_price);
    const unitPrice = line.unitPrice === "" ? listPrice : toNumber(line.unitPrice);
    return { product: p, variant: v, grams, minutes, unitCost, listPrice, unitPrice, qty: Math.max(0, Math.trunc(toNumber(line.quantity))) };
  }

  const priced = lines.map((l) => ({ line: l, d: lineDetails(l) }));
  const totals = calculateOrderTotals({
    lines: priced.filter((x) => x.d).map((x) => ({ quantity: x.d!.qty, unitPrice: x.d!.unitPrice, unitCost: x.d!.unitCost })),
    shippingCharged: toNumber(shippingCharged),
    discount: toNumber(discount),
    fees: toNumber(fees),
    postageCost: toNumber(postage),
  });
  const jobs = mergeOrderLines(
    priced
      .filter((x) => x.d && x.d.qty > 0)
      .map((x) => ({ productId: x.line.productId, variantId: x.line.variantId, quantity: x.d!.qty, d: x.d! })),
  );
  const totalMinutes = jobs.reduce((s, j) => s + j.d.minutes * j.quantity, 0);
  const totalGrams = jobs.reduce((s, j) => s + j.d.grams * j.quantity, 0);

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickCustomer(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c) setAddress(addressOf(c));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      customer_id: mode === "existing" ? customerId : null,
      new_customer: mode === "new" ? newCustomer : null,
      sales_channel: channel,
      external_order_id: externalId,
      order_date: orderDate ? new Date(orderDate).toISOString() : null,
      payment_status: payment,
      items: lines
        .filter((l) => l.productId)
        .map((l) => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.quantity, unit_price: l.unitPrice })),
      shipping_provider: provider,
      shipping_service: service,
      shipping_charged: shippingCharged || 0,
      postage_cost: postage || 0,
      discount: discount || 0,
      fees: fees || 0,
      shipping_address: address,
      save_address_to_customer: mode === "existing" && saveAddress,
      priority,
      customer_notes: customerNotes,
      internal_notes: internalNotes,
    };
    const result = await execute(() => createOrderAction(payload));
    if (result.ok) {
      toast.success(`Order ${result.data.order_number} created`, {
        description: `${result.data.jobCount} production job${result.data.jobCount === 1 ? "" : "s"} added to the queue.`,
      });
      router.push(`/orders/${result.data.id}`);
    } else {
      setErrors(result.fieldErrors ?? {});
    }
  }

  const channelNeedsExternal = channel !== "manual";

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-4">
        <FormSection title="Customer">
          <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Customer type">
            <Button type="button" size="xs" variant={mode === "existing" ? "secondary" : "ghost"} onClick={() => setMode("existing")} disabled={!customers.length}>
              <UsersIcon /> Existing
            </Button>
            <Button type="button" size="xs" variant={mode === "new" ? "secondary" : "ghost"} onClick={() => setMode("new")}>
              <UserPlusIcon /> New customer
            </Button>
          </div>
          {mode === "existing" ? (
            <Field id="o-customer" label="Customer" required error={errors.customer_id}>
              <Combobox
                id="o-customer"
                value={customerId}
                onChange={pickCustomer}
                placeholder="Search customers…"
                searchPlaceholder="Name, email or postcode"
                invalid={!!errors.customer_id}
                options={customers.map((c) => ({
                  value: c.id,
                  label: c.name,
                  description: [c.email, c.postcode].filter(Boolean).join(" · "),
                  keywords: `${c.email ?? ""} ${c.postcode ?? ""} ${c.phone ?? ""}`,
                }))}
              />
            </Field>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="o-nc-name" label="Name" required error={errors["new_customer.name"] ?? errors.customer_id}>
                <Input id="o-nc-name" value={newCustomer.name} onChange={(e) => setNewCustomer((s) => ({ ...s, name: e.target.value }))} />
              </Field>
              <Field id="o-nc-email" label="Email" error={errors["new_customer.email"]}>
                <Input id="o-nc-email" type="email" value={newCustomer.email} onChange={(e) => setNewCustomer((s) => ({ ...s, email: e.target.value }))} />
              </Field>
              <Field id="o-nc-phone" label="Phone">
                <Input id="o-nc-phone" type="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer((s) => ({ ...s, phone: e.target.value }))} />
              </Field>
            </div>
          )}
        </FormSection>

        <FormSection title="Order">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field id="o-channel" label="Sales channel" required>
              <Select value={channel} onValueChange={(v) => setChannel(v as SalesChannel)}>
                <SelectTrigger id="o-channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SALES_CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {SALES_CHANNEL_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="o-ext" label="External order ID" error={errors.external_order_id} hint={channelNeedsExternal ? "Used to prevent duplicates" : "Optional"}>
              <Input id="o-ext" value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder={channelNeedsExternal ? "e.g. 3012345678" : ""} />
            </Field>
            <Field id="o-date" label="Order date" error={errors.order_date}>
              <Input id="o-date" type="datetime-local" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </Field>
            <Field id="o-payment" label="Payment">
              <Select value={payment} onValueChange={(v) => setPayment(v as PaymentStatus)}>
                <SelectTrigger id="o-payment">
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
          </div>
        </FormSection>

        <FormSection title="Products" description="Each product line becomes one production job.">
          {errors.items && <p className="text-xs text-destructive" role="alert">{errors.items}</p>}
          {products.length === 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              You don&apos;t have any active products yet. Add a product first.
            </p>
          )}
          <div className="space-y-3">
            {priced.map(({ line, d }, idx) => (
              <div key={line.key} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_80px_110px_90px_auto] sm:items-end sm:border-0 sm:p-0">
                <Field id={`o-line-${line.key}`} label={idx === 0 ? "Product" : <span className="sm:sr-only">Product</span>} error={errors[`items.${idx}.product_id`]}>
                  <Combobox
                    id={`o-line-${line.key}`}
                    value={line.productId ? `${line.productId}|${line.variantId ?? ""}` : null}
                    onChange={(val) => {
                      const [pid, vid] = val.split("|");
                      updateLine(line.key, { productId: pid, variantId: vid || null, unitPrice: "" });
                    }}
                    options={productOptions}
                    placeholder="Choose product…"
                    searchPlaceholder="Name or SKU"
                  />
                </Field>
                <Field id={`o-qty-${line.key}`} label={idx === 0 ? "Qty" : <span className="sm:sr-only">Qty</span>} error={errors[`items.${idx}.quantity`]}>
                  <Input id={`o-qty-${line.key}`} inputMode="numeric" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} />
                </Field>
                <Field id={`o-price-${line.key}`} label={idx === 0 ? `Unit price` : <span className="sm:sr-only">Unit price</span>}>
                  <Input
                    id={`o-price-${line.key}`}
                    inputMode="decimal"
                    value={line.unitPrice}
                    placeholder={d ? String(d.listPrice) : ""}
                    onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                  />
                </Field>
                <div className="flex h-9 items-center justify-between text-sm sm:justify-end">
                  <span className="text-xs text-muted-foreground sm:hidden">Line total</span>
                  <span className="tabular font-medium">{d ? money(d.unitPrice * d.qty) : "—"}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove line"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                  className="justify-self-end"
                >
                  <Trash2Icon />
                </Button>
                {d && (
                  <p className="text-xs text-muted-foreground sm:col-span-5">
                    Unit cost {money(d.unitCost)} · {formatGrams(d.grams)} · {formatDuration(d.minutes)} per unit
                  </p>
                )}
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLines((ls) => [...ls, { key: nextKey, productId: "", variantId: null, quantity: "1", unitPrice: "" }]);
              setNextKey((k) => k + 1);
            }}
          >
            <PlusIcon /> Add product
          </Button>
        </FormSection>

        <FormSection title="Shipping">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field id="o-provider" label="Provider">
              <Select
                value={provider}
                onValueChange={(v) => {
                  setProvider(v as ShippingProvider);
                  setService(SHIPPING_SERVICES[v as ShippingProvider][0] ?? "");
                }}
              >
                <SelectTrigger id="o-provider">
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
            <Field id="o-service" label="Service">
              <Select value={service} onValueChange={setService}>
                <SelectTrigger id="o-service">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHIPPING_SERVICES[provider].map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="o-ship" label="Shipping charged" hint="Paid by the customer" error={errors.shipping_charged}>
              <Input id="o-ship" inputMode="decimal" value={shippingCharged} onChange={(e) => setShippingCharged(e.target.value)} />
            </Field>
            <Field id="o-postage" label="Postage cost" hint="What you pay the carrier" error={errors.postage_cost}>
              <Input id="o-postage" inputMode="decimal" value={postage} onChange={(e) => setPostage(e.target.value)} />
            </Field>
          </div>
          <fieldset className="space-y-3">
            <legend className="mb-2 text-[13px] font-medium">Shipping address</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input aria-label="Address line 1" placeholder="Address line 1" value={address.line1} onChange={(e) => setAddress((a) => ({ ...a, line1: e.target.value }))} className="sm:col-span-2" />
              <Input aria-label="Address line 2" placeholder="Address line 2" value={address.line2} onChange={(e) => setAddress((a) => ({ ...a, line2: e.target.value }))} className="sm:col-span-2" />
              <Input aria-label="Town / city" placeholder="Town / city" value={address.city} onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))} />
              <Input aria-label="County / region" placeholder="County / region" value={address.region} onChange={(e) => setAddress((a) => ({ ...a, region: e.target.value }))} />
              <Input aria-label="Postcode" placeholder="Postcode" value={address.postcode} onChange={(e) => setAddress((a) => ({ ...a, postcode: e.target.value }))} />
              <Input aria-label="Country" placeholder="Country" value={address.country} onChange={(e) => setAddress((a) => ({ ...a, country: e.target.value }))} />
            </div>
            {mode === "existing" && customerId && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={saveAddress} onCheckedChange={(c) => setSaveAddress(Boolean(c))} />
                Save this address to the customer
              </label>
            )}
          </fieldset>
        </FormSection>

        <FormSection title="Notes">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="o-cnotes" label="Customer notes" hint="Personalisation, gift messages…">
              <Textarea id="o-cnotes" rows={3} value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} />
            </Field>
            <Field id="o-inotes" label="Internal notes">
              <Textarea id="o-inotes" rows={3} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
            </Field>
          </div>
        </FormSection>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <section className="rounded-lg border bg-card">
          <header className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Summary</h2>
          </header>
          <div className="space-y-3 p-4 text-[13px]">
            <div className="grid grid-cols-2 gap-3">
              <Field id="o-discount" label="Discount" error={errors.discount}>
                <Input id="o-discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
              <Field id="o-fees" label="Fees" hint="Marketplace/payment" error={errors.fees}>
                <Input id="o-fees" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} />
              </Field>
            </div>
            <dl className="divide-y">
              <SummaryRow label="Subtotal" value={money(totals.subtotal)} />
              <SummaryRow label="Shipping" value={money(totals.shippingCharged)} />
              {totals.discount > 0 && <SummaryRow label="Discount" value={`−${money(totals.discount)}`} />}
              <SummaryRow label="Total" value={money(totals.total)} strong />
              <SummaryRow label="Product cost" value={`−${money(totals.productCost)}`} muted />
              <SummaryRow label="Postage" value={`−${money(totals.postageCost)}`} muted />
              {totals.fees > 0 && <SummaryRow label="Fees" value={`−${money(totals.fees)}`} muted />}
              <SummaryRow
                label="Estimated profit"
                value={<span className={totals.estimatedProfit < 0 ? "text-red-700" : "text-emerald-700"}>{money(totals.estimatedProfit)}</span>}
                strong
              />
            </dl>
            <div className="grid grid-cols-2 gap-3">
              <Field id="o-priority" label="Production priority">
                <Select value={priority} onValueChange={(v) => setPriority(v as JobPriority)}>
                  <SelectTrigger id="o-priority">
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
            </div>
            <div className="rounded-md bg-muted/60 p-3 text-xs">
              <p className="font-medium text-foreground">
                Creates {jobs.length} production job{jobs.length === 1 ? "" : "s"}
              </p>
              {jobs.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {jobs.map((j) => (
                    <li key={`${j.productId}:${j.variantId}`}>
                      {j.d.product.name}
                      {j.d.variant ? ` — ${j.d.variant.name}` : ""} × {j.quantity}
                    </li>
                  ))}
                  <li className="pt-1">
                    ≈ {formatDuration(totalMinutes)} printing · {formatGrams(totalGrams)} filament
                  </li>
                </ul>
              )}
            </div>
          </div>
          <div className="border-t p-4">
            <Button type="submit" className="w-full" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Create order
            </Button>
          </div>
        </section>
      </aside>
    </form>
  );
}

function SummaryRow({ label, value, strong, muted }: { label: string; value: React.ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between py-1.5 ${strong ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

function addressOf(c: CustomerOption) {
  return {
    line1: c.address_line1 ?? "",
    line2: c.address_line2 ?? "",
    city: c.city ?? "",
    region: c.region ?? "",
    postcode: c.postcode ?? "",
    country: c.country ?? "United Kingdom",
  };
}
