import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LayersIcon, TruckIcon } from "lucide-react";
import { CreateLabelButton } from "@/components/orders/label-phase2-button";
import { EditOrderDialog } from "@/components/orders/edit-order-dialog";
import { OrderActions } from "@/components/orders/order-actions";
import { ShipmentDialog } from "@/components/orders/shipment-dialog";
import { JobActions } from "@/components/production/job-actions";
import { AssignPrinterSelect } from "@/components/production/queue-controls";
import { DetailList } from "@/components/shared/detail-list";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { DemoBadge, StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatDuration, formatGrams } from "@/lib/domain/dates";
import {
  JOB_STATUS_META,
  LABEL_STATUS_META,
  ORDER_STATUS_META,
  PACKING_STATUS_META,
  PAYMENT_STATUS_META,
  PRIORITY_META,
  PRODUCTION_STATUS_META,
  SALES_CHANNEL_LABELS,
  SHIPPING_PROVIDER_LABELS,
  SHIPPING_STATUS_META,
} from "@/lib/domain/labels";
import { formatMoney } from "@/lib/domain/money";
import { ORDER_FLOW } from "@/lib/domain/order-workflow";
import { elapsedPrintMinutes } from "@/lib/domain/production";
import { requirePageContext } from "@/lib/services/context";
import { AppError } from "@/lib/services/errors";
import { listUsableFilaments } from "@/lib/services/filaments";
import { getOrder, hasAddress } from "@/lib/services/orders";
import { jobLabel } from "@/lib/services/production";
import { listPrinterOptions } from "@/lib/services/products";
import { cn } from "@/lib/utils";
import type { Address, OrderStatus } from "@/types/db";

export const metadata: Metadata = { title: "Order" };

function formatAddress(a: Address | null) {
  if (!hasAddress(a)) return null;
  return [a.line1, a.line2, a.city, a.region, a.postcode, a.country].filter(Boolean).join("\n");
}

function Progress({ status }: { status: OrderStatus }) {
  const idx = ORDER_FLOW.indexOf(status);
  if (idx < 0) return null;
  return (
    <ol className="flex gap-1" aria-label="Order progress">
      {ORDER_FLOW.map((s, i) => (
        <li key={s} className="flex-1" title={ORDER_STATUS_META[s].label}>
          <span className={cn("block h-1.5 rounded-full", i <= idx ? "bg-primary" : "bg-muted")} />
          <span className={cn("mt-1 hidden text-[10px] xl:block", i === idx ? "font-medium text-foreground" : "text-muted-foreground")}>
            {ORDER_STATUS_META[s].label}
          </span>
        </li>
      ))}
      <span className="sr-only">
        Step {idx + 1} of {ORDER_FLOW.length}: {ORDER_STATUS_META[status].label}
      </span>
    </ol>
  );
}

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const ctx = await requirePageContext();
  const [detail, printers, spools] = await Promise.all([
    getOrder(ctx, id).catch((e) => {
      if (e instanceof AppError && e.code === "not_found") notFound();
      throw e;
    }),
    listPrinterOptions(ctx),
    listUsableFilaments(ctx),
  ]);
  const { order: o, items, jobs, shipment, history, activity } = detail;
  const money = (v: number) => formatMoney(v, ctx.settings.currency);
  const tz = ctx.settings.timezone;
  const address = formatAddress(o.shipping_address);
  const postage = Number(shipment?.shipping_cost ?? 0);
  const now = new Date();

  return (
    <>
      <PageHeader
        back={{ href: "/orders", label: "Orders" }}
        title={`Order ${o.order_number}`}
        meta={
          <>
            <StatusBadge meta={ORDER_STATUS_META[o.status]} />
            <Badge tone="outline">{SALES_CHANNEL_LABELS[o.sales_channel]}</Badge>
            {o.is_demo && <DemoBadge />}
          </>
        }
        description={
          <>
            {formatDateTime(o.order_date, tz)} · {o.customer_name}
            {o.external_order_id && <> · External ID {o.external_order_id}</>}
          </>
        }
        actions={
          <>
            <OrderActions
              orderId={o.id}
              orderNumber={o.order_number}
              status={o.status}
              jobs={jobs.map((j) => ({ id: j.id, status: j.status }))}
              shipment={shipment}
            />
            <EditOrderDialog order={o} />
          </>
        }
      />
      <PageBody>
        <div className="rounded-lg border bg-card px-4 py-3">
          <Progress status={o.status} />
          {(o.status === "cancelled" || o.status === "on_hold") && (
            <p className="text-sm">
              This order is <strong>{ORDER_STATUS_META[o.status].label.toLowerCase()}</strong>.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">Payment <StatusBadge meta={PAYMENT_STATUS_META[o.payment_status]} /></span>
            <span className="flex items-center gap-1.5">Production <StatusBadge meta={PRODUCTION_STATUS_META[o.production_status]} /></span>
            <span className="flex items-center gap-1.5">Packing <StatusBadge meta={PACKING_STATUS_META[o.packing_status]} /></span>
            <span className="flex items-center gap-1.5">Shipping <StatusBadge meta={SHIPPING_STATUS_META[o.shipping_status]} /></span>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Items</CardTitle>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Unit cost</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="whitespace-normal">
                        {i.product_id ? (
                          <Link href={`/products/${i.product_id}`} className="font-medium hover:underline">
                            {i.product_name}
                          </Link>
                        ) : (
                          <span className="font-medium">{i.product_name}</span>
                        )}
                        {i.variant_name && <span className="text-muted-foreground"> — {i.variant_name}</span>}
                        {i.sku && <div className="font-mono text-xs text-muted-foreground">{i.sku}</div>}
                      </TableCell>
                      <TableCell className="tabular text-right">{i.quantity}</TableCell>
                      <TableCell className="tabular text-right">{money(i.unit_price)}</TableCell>
                      <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">{money(i.unit_cost)}</TableCell>
                      <TableCell className="tabular text-right">{money(i.line_total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>Subtotal</TableCell>
                    <TableCell className="tabular text-right">{items.reduce((s, i) => s + i.quantity, 0)}</TableCell>
                    <TableCell />
                    <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">{money(o.product_cost)}</TableCell>
                    <TableCell className="tabular text-right">{money(o.subtotal)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </Card>

            <Card id="production" className="scroll-mt-20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LayersIcon className="size-4 text-muted-foreground" /> Production jobs
                </CardTitle>
                <Link href="/production" className="text-xs font-medium text-primary hover:underline">
                  Production queue
                </Link>
              </CardHeader>
              {jobs.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">No production jobs.</p>
              ) : (
                <ul className="divide-y">
                  {jobs.map((j) => (
                    <li key={j.id} id={`job-${j.id}`} className="flex scroll-mt-20 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/production/${j.id}`} className="font-mono text-xs text-primary hover:underline">
                            {jobLabel(j)}
                          </Link>
                          <span className="font-medium">
                            {j.product_name} × {j.quantity}
                          </span>
                          <StatusBadge meta={JOB_STATUS_META[j.status]} />
                          {j.priority !== "normal" && <StatusBadge meta={PRIORITY_META[j.priority]} />}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {j.status === "printed"
                            ? `Printed ${formatDateTime(j.completed_at, tz)} · ${formatDuration(j.actual_minutes)} · ${formatGrams(j.actual_grams)}`
                            : j.status === "printing" || j.status === "paused"
                              ? `${j.printer?.name ?? "No printer"} · ${formatDuration(elapsedPrintMinutes(j, now))} of ~${formatDuration(j.estimated_minutes)}`
                              : `Est. ${formatDuration(j.estimated_minutes)} · ${formatGrams(j.estimated_grams)}${j.material ? ` · ${j.material}` : ""}${j.colour ? ` ${j.colour}` : ""}`}
                          {j.status === "failed" && j.failure_reason && <span className="text-red-700"> · {j.failure_reason}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {j.status === "queued" && <AssignPrinterSelect jobId={j.id} printerId={j.printer_id} printers={printers} className="w-52" />}
                        <JobActions job={j} printers={printers} spools={spools} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Customer</CardTitle>
                {o.customer_id && (
                  <Link href={`/customers/${o.customer_id}`} className="text-xs font-medium text-primary hover:underline">
                    View customer
                  </Link>
                )}
              </CardHeader>
              <CardContent>
                <DetailList
                  items={[
                    ["Name", o.customer_name],
                    ["Email", o.customer_email ? <a className="text-primary hover:underline" href={`mailto:${o.customer_email}`}>{o.customer_email}</a> : "—"],
                    ["Phone", o.customer_phone ? <a className="text-primary hover:underline" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a> : "—"],
                    ["Ship to", address ? <span className="whitespace-pre-line">{address}</span> : <span className="text-amber-700">No address</span>],
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TruckIcon className="size-4 text-muted-foreground" /> Shipping
                </CardTitle>
                {shipment && <StatusBadge meta={LABEL_STATUS_META[shipment.label_status]} />}
              </CardHeader>
              <CardContent className="space-y-3">
                {shipment ? (
                  <>
                    <DetailList
                      items={[
                        ["Provider", `${SHIPPING_PROVIDER_LABELS[shipment.provider]}${shipment.service ? ` · ${shipment.service}` : ""}`],
                        ["Tracking", shipment.tracking_number ? <span className="font-mono">{shipment.tracking_number}</span> : <span className="text-muted-foreground">Not added</span>],
                        ["Postage cost", money(shipment.shipping_cost)],
                        ["Shipped", formatDateTime(shipment.shipped_at, tz)],
                        ...(shipment.notes ? ([["Notes", shipment.notes]] as [string, string][]) : []),
                      ]}
                    />
                    <div className="flex flex-wrap gap-2">
                      <ShipmentDialog
                        orderId={o.id}
                        orderNumber={o.order_number}
                        shipment={shipment}
                        trigger={
                          <Button size="sm" variant="outline">
                            {shipment.tracking_number ? "Edit shipping" : "Add tracking"}
                          </Button>
                        }
                      />
                      <CreateLabelButton />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No shipment record.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Money</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y text-[13px]">
                  {[
                    ["Subtotal", money(o.subtotal)],
                    ["Shipping charged", money(o.shipping_charged)],
                    ...(o.discount > 0 ? [["Discount", `−${money(o.discount)}`]] : []),
                    ["Order total", money(o.total), "font-semibold"],
                    ["Product cost", `−${money(o.product_cost)}`, "text-muted-foreground"],
                    ["Postage", `−${money(postage)}`, "text-muted-foreground"],
                    ...(o.fees > 0 ? [["Fees", `−${money(o.fees)}`, "text-muted-foreground"]] : []),
                  ].map(([k, v, cls]) => (
                    <div key={k} className={cn("flex justify-between py-1.5", cls)}>
                      <dt>{k}</dt>
                      <dd className="tabular">{v}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between py-1.5 font-semibold">
                    <dt>Estimated profit</dt>
                    <dd className={cn("tabular", o.estimated_profit < 0 ? "text-red-700" : "text-emerald-700")}>{money(o.estimated_profit)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            {(o.customer_notes || o.internal_notes) && (
              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-[13px]">
                  {o.customer_notes && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">From customer</div>
                      <p className="whitespace-pre-line">{o.customer_notes}</p>
                    </div>
                  )}
                  {o.internal_notes && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Internal</div>
                      <p className="whitespace-pre-line">{o.internal_notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            <p className="px-1 text-xs text-muted-foreground">
              Created {formatDateTime(o.created_at, tz)} · Updated {formatDateTime(o.updated_at, tz)}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">Status history</h3>
              <ol className="space-y-2.5 text-[13px]">
                {history.map((h) => (
                  <li key={h.id} className="flex gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    <div>
                      <div>
                        {h.from_status ? (
                          <>
                            {ORDER_STATUS_META[h.from_status as OrderStatus]?.label ?? h.from_status} →{" "}
                          </>
                        ) : (
                          "Created as "
                        )}
                        <strong>{ORDER_STATUS_META[h.to_status as OrderStatus]?.label ?? h.to_status}</strong>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(h.created_at, tz)} · {h.changed_by_name ?? "System"}
                        {h.note && ` · ${h.note}`}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">Events</h3>
              <ol className="space-y-2.5 text-[13px]">
                {activity.map((a) => (
                  <li key={a.id}>
                    <div>{a.summary ?? a.event}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(a.created_at, tz)} · {a.actor_name ?? "System"}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
