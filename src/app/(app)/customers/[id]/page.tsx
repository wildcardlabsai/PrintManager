import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon, PlusIcon, ShoppingBagIcon } from "lucide-react";
import { CustomerArchiveButton } from "@/components/customers/customer-archive-button";
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog";
import { DetailList } from "@/components/shared/detail-list";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Stat } from "@/components/shared/stat";
import { DemoBadge, StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/domain/dates";
import { ORDER_STATUS_META, SALES_CHANNEL_SHORT } from "@/lib/domain/labels";
import { formatMoney } from "@/lib/domain/money";
import { requirePageContext } from "@/lib/services/context";
import { getCustomer } from "@/lib/services/customers";
import { AppError } from "@/lib/services/errors";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  const ctx = await requirePageContext();
  const data = await getCustomer(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { customer: c, orders } = data;
  const money = (v: number) => formatMoney(v, ctx.settings.currency);
  const tz = ctx.settings.timezone;
  const address = [c.address_line1, c.address_line2, c.city, c.region, c.postcode, c.country].filter(Boolean);

  return (
    <>
      <PageHeader
        back={{ href: "/customers", label: "Customers" }}
        title={c.name}
        meta={
          <>
            {c.is_demo && <DemoBadge />}
            {c.archived_at && <span className="text-xs text-muted-foreground">Archived</span>}
          </>
        }
        actions={
          <>
            <CustomerArchiveButton id={c.id} archived={Boolean(c.archived_at)} />
            <CustomerFormDialog
              customerId={c.id}
              customer={c}
              trigger={
                <Button variant="outline" size="sm">
                  <PencilIcon /> Edit
                </Button>
              }
            />
            <Button asChild size="sm">
              <Link href={`/orders/new?customer=${c.id}`}>
                <PlusIcon /> New order
              </Link>
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:grid-cols-4 sm:divide-y-0">
          <Stat label="Orders" value={c.order_count} />
          <Stat label="Total spent" value={money(c.total_spent)} />
          <Stat label="First order" value={<span className="text-base">{formatDate(c.first_order_at, tz)}</span>} />
          <Stat label="Last order" value={<span className="text-base">{formatDate(c.last_order_at, tz)}</span>} />
        </div>
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card className="self-start">
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  ["Email", c.email ? <a href={`mailto:${c.email}`} className="text-primary hover:underline">{c.email}</a> : "—"],
                  ["Phone", c.phone ? <a href={`tel:${c.phone}`} className="text-primary hover:underline">{c.phone}</a> : "—"],
                  ["Address", address.length ? <span className="whitespace-pre-line">{address.join("\n")}</span> : "—"],
                  ["Customer since", formatDate(c.created_at, tz)],
                  ["Notes", c.notes ? <span className="whitespace-pre-line">{c.notes}</span> : "—"],
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Order history</CardTitle>
            </CardHeader>
            {orders.length === 0 ? (
              <EmptyState icon={ShoppingBagIcon} title="No orders yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="hidden sm:table-cell">Channel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Est. profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link href={`/orders/${o.id}`} className="font-medium hover:underline">
                          {o.order_number}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(o.order_date, tz)}</TableCell>
                      <TableCell className="hidden sm:table-cell">{SALES_CHANNEL_SHORT[o.sales_channel]}</TableCell>
                      <TableCell>
                        <StatusBadge meta={ORDER_STATUS_META[o.status]} />
                      </TableCell>
                      <TableCell className="tabular text-right">{money(o.total)}</TableCell>
                      <TableCell className="tabular hidden text-right md:table-cell">{money(o.estimated_profit)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      </PageBody>
    </>
  );
}
