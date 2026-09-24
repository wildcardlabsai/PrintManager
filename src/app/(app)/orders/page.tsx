import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon, ShoppingBagIcon } from "lucide-react";
import { ChannelFilter } from "@/components/orders/channel-filter";
import { EmptyState } from "@/components/shared/empty-state";
import { LinkTabs } from "@/components/shared/link-tabs";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { SearchInput } from "@/components/shared/search-input";
import { DemoBadge, StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatShortDateTime } from "@/lib/domain/dates";
import { ORDER_STATUS_META, PAYMENT_STATUS_META, SALES_CHANNEL_SHORT } from "@/lib/domain/labels";
import { formatMoney } from "@/lib/domain/money";
import { requirePageContext } from "@/lib/services/context";
import { ORDER_VIEWS, countOrdersByView, listOrders, type OrderView } from "@/lib/services/orders";
import { SALES_CHANNELS, type SalesChannel } from "@/types/db";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const view = (typeof sp.view === "string" && sp.view in ORDER_VIEWS ? sp.view : "open") as OrderView;
  const channel = SALES_CHANNELS.includes(sp.channel as SalesChannel) ? (sp.channel as SalesChannel) : null;
  const q = typeof sp.q === "string" ? sp.q : "";
  const [result, counts] = await Promise.all([
    listOrders(ctx, { view, channel, q, page: Number(sp.page) || 1 }),
    countOrdersByView(ctx),
  ]);
  const money = (v: number) => formatMoney(v, ctx.settings.currency);
  const tz = ctx.settings.timezone;

  const tabHref = (key: string) => {
    const p = new URLSearchParams();
    if (key !== "open") p.set("view", key);
    if (channel) p.set("channel", channel);
    if (q) p.set("q", q);
    return `/orders${p.size ? `?${p}` : ""}`;
  };
  const tabOrder: OrderView[] = ["open", "new", "production", "pack", "ship", "shipped", "completed", "closed", "all"];

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order from every channel in one place."
        actions={
          <Button asChild size="sm">
            <Link href="/orders/new">
              <PlusIcon /> New order
            </Link>
          </Button>
        }
      />
      <PageBody>
        <div className="rounded-lg border bg-card">
          <div className="border-b px-3 pt-1">
            <LinkTabs
              active={view}
              tabs={tabOrder.map((k) => ({ key: k, label: ORDER_VIEWS[k].label, href: tabHref(k), count: counts[k] }))}
            />
          </div>
          <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
            <SearchInput placeholder="Order #, external ID, customer" />
            <ChannelFilter />
          </div>

          {result.rows.length === 0 ? (
            <EmptyState
              icon={ShoppingBagIcon}
              title={q || channel ? "No orders match these filters" : "No orders here"}
              description={q || channel ? "Try clearing the search or channel filter." : "New orders you create or import will appear here."}
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/orders/new">
                    <PlusIcon /> New order
                  </Link>
                </Button>
              }
            />
          ) : (
            <>
              {/* Phone layout */}
              <ul className="divide-y md:hidden">
                {result.rows.map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="block px-3 py-3 active:bg-muted/60">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {o.order_number}
                          {o.is_demo && <DemoBadge className="ml-1.5" />}
                        </span>
                        <span className="tabular font-medium">{money(o.total)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="truncate">
                          {o.customer_name} · {SALES_CHANNEL_SHORT[o.sales_channel]}
                        </span>
                        <span className="shrink-0">{formatShortDateTime(o.order_date, tz)}</span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="truncate text-xs">{o.item_summary}</span>
                        <StatusBadge meta={ORDER_STATUS_META[o.status]} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {/* Desktop layout */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="hidden text-right xl:table-cell">Est. profit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden lg:table-cell">Payment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>
                          <Link href={`/orders/${o.id}`} className="font-medium text-primary hover:underline">
                            {o.order_number}
                          </Link>
                          {o.is_demo && <DemoBadge className="ml-1.5" />}
                          {o.external_order_id && <div className="text-xs text-muted-foreground">{o.external_order_id}</div>}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatShortDateTime(o.order_date, tz)}</TableCell>
                        <TableCell>{SALES_CHANNEL_SHORT[o.sales_channel]}</TableCell>
                        <TableCell className="max-w-44 truncate">{o.customer_name}</TableCell>
                        <TableCell className="max-w-64 truncate text-muted-foreground" title={o.item_summary}>
                          {o.item_summary}
                        </TableCell>
                        <TableCell className="tabular text-right">{money(o.total)}</TableCell>
                        <TableCell className="tabular hidden text-right text-muted-foreground xl:table-cell">{money(o.estimated_profit)}</TableCell>
                        <TableCell>
                          <StatusBadge meta={ORDER_STATUS_META[o.status]} />
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <StatusBadge meta={PAYMENT_STATUS_META[o.payment_status]} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
          <Pagination {...result} basePath="/orders" params={sp} noun="orders" />
        </div>
      </PageBody>
    </>
  );
}
