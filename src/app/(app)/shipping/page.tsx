import type { Metadata } from "next";
import Link from "next/link";
import { InfoIcon, TruckIcon } from "lucide-react";
import { CreateLabelButton } from "@/components/orders/label-phase2-button";
import { QuickStatusButton } from "@/components/orders/quick-status-button";
import { ShipmentDialog } from "@/components/orders/shipment-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { LinkTabs } from "@/components/shared/link-tabs";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { DemoBadge, StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/domain/dates";
import { LABEL_STATUS_META, ORDER_STATUS_META, SALES_CHANNEL_SHORT, SHIPPING_PROVIDER_LABELS } from "@/lib/domain/labels";
import { requirePageContext } from "@/lib/services/context";
import { SHIPPING_VIEWS, listShipments, type ShipmentRow, type ShippingView } from "@/lib/services/shipping";

export const metadata: Metadata = { title: "Shipping" };

function Actions({ s }: { s: ShipmentRow }) {
  const status = s.order.status;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {status === "printed" && <QuickStatusButton orderId={s.order_id} to="packing" label="Pack order" variant="default" />}
      {status === "packing" && <QuickStatusButton orderId={s.order_id} to="ready_to_ship" label="Mark packed" variant="default" />}
      {status === "ready_to_ship" && (
        <ShipmentDialog
          orderId={s.order_id}
          orderNumber={s.order.order_number}
          shipment={s}
          markShipped
          trigger={
            <Button size="sm">
              <TruckIcon /> Mark shipped
            </Button>
          }
        />
      )}
      <ShipmentDialog
        orderId={s.order_id}
        orderNumber={s.order.order_number}
        shipment={s}
        trigger={
          <Button size="sm" variant="outline">
            {s.tracking_number ? "Edit" : "Add tracking"}
          </Button>
        }
      />
    </div>
  );
}

export default async function ShippingPage({ searchParams }: PageProps<"/shipping">) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const view = (typeof sp.view === "string" && sp.view in SHIPPING_VIEWS ? sp.view : "to_ship") as ShippingView;
  const rows = await listShipments(ctx, view);
  const tz = ctx.settings.timezone;

  return (
    <>
      <PageHeader title="Shipping" description="Pack, add tracking and dispatch." actions={<CreateLabelButton />} />
      <PageBody>
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>Shipping label integrations will be connected in Phase 2. For now, buy postage with your carrier and add the tracking number here.</p>
        </div>
        <div className="rounded-lg border bg-card">
          <div className="border-b px-3 pt-1">
            <LinkTabs
              active={view}
              tabs={(Object.keys(SHIPPING_VIEWS) as ShippingView[]).map((k) => ({
                key: k,
                label: SHIPPING_VIEWS[k].label,
                href: k === "to_ship" ? "/shipping" : `/shipping?view=${k}`,
                count: k === view ? rows.length : undefined,
              }))}
            />
          </div>
          {rows.length === 0 ? (
            <EmptyState
              icon={TruckIcon}
              title={view === "to_ship" ? "Nothing waiting to ship" : view === "awaiting_tracking" ? "No orders missing tracking" : "No shipped orders yet"}
              description={view === "to_ship" ? "Orders appear here once they're printed." : undefined}
            />
          ) : (
            <ul className="divide-y">
              {rows.map((s) => (
                <li key={s.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/orders/${s.order_id}`} className="font-medium text-primary hover:underline">
                        {s.order.order_number}
                      </Link>
                      <span className="font-medium">{s.order.customer_name}</span>
                      <StatusBadge meta={ORDER_STATUS_META[s.order.status]} />
                      {s.is_demo && <DemoBadge />}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{SALES_CHANNEL_SHORT[s.order.sales_channel]}</span>
                      <span>
                        {SHIPPING_PROVIDER_LABELS[s.provider]}
                        {s.service && ` · ${s.service}`}
                      </span>
                      <span>
                        {[s.order.shipping_address?.city, s.order.shipping_address?.postcode].filter(Boolean).join(" ") || (
                          <span className="text-amber-700">No address</span>
                        )}
                      </span>
                      <span>Ordered {formatDate(s.order.order_date, tz)}</span>
                      {s.shipped_at && <span>Shipped {formatDate(s.shipped_at, tz)}</span>}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <StatusBadge meta={LABEL_STATUS_META[s.label_status]} />
                      {s.tracking_number ? (
                        <span className="font-mono">{s.tracking_number}</span>
                      ) : (
                        <span className="text-muted-foreground">No tracking yet</span>
                      )}
                    </div>
                  </div>
                  <Actions s={s} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageBody>
    </>
  );
}
