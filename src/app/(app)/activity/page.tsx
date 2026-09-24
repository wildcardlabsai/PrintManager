import type { Metadata } from "next";
import Link from "next/link";
import { HistoryIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { LinkTabs } from "@/components/shared/link-tabs";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/domain/dates";
import { listActivity } from "@/lib/services/activity";
import { requirePageContext } from "@/lib/services/context";

export const metadata: Metadata = { title: "Activity log" };

const ENTITIES = [
  { key: "", label: "All" },
  { key: "order", label: "Orders" },
  { key: "production_job", label: "Production" },
  { key: "product", label: "Products" },
  { key: "customer", label: "Customers" },
  { key: "printer", label: "Printers" },
  { key: "filament", label: "Filament" },
  { key: "shipment", label: "Shipping" },
  { key: "settings", label: "Settings" },
];

const LINKS: Record<string, string> = {
  order: "/orders/",
  production_job: "/production/",
  product: "/products/",
  customer: "/customers/",
};

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const entity = typeof sp.entity === "string" && ENTITIES.some((e) => e.key === sp.entity) ? sp.entity : "";
  const result = await listActivity(ctx, { page: Number(sp.page) || 1, entity: entity || null });
  const tz = ctx.settings.timezone;

  return (
    <>
      <PageHeader title="Activity log" description="An append-only record of important changes, who made them and when." />
      <PageBody>
        <div className="rounded-lg border bg-card">
          <div className="border-b px-3 pt-1">
            <LinkTabs active={entity} tabs={ENTITIES.map((e) => ({ key: e.key, label: e.label, href: e.key ? `/activity?entity=${e.key}` : "/activity" }))} />
          </div>
          {result.rows.length === 0 ? (
            <EmptyState icon={HistoryIcon} title="No activity yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="hidden md:table-cell">By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((a) => {
                  const orderId = typeof a.metadata?.order_id === "string" ? a.metadata.order_id : null;
                  const href = a.entity_id && LINKS[a.entity_type] ? `${LINKS[a.entity_type]}${a.entity_id}` : orderId ? `/orders/${orderId}` : null;
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="text-muted-foreground">{formatDateTime(a.created_at, tz)}</TableCell>
                      <TableCell>
                        <Badge tone="outline" className="font-mono text-[11px]">
                          {a.event}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-md truncate whitespace-normal sm:whitespace-nowrap">
                        {href ? (
                          <Link href={href} className="hover:underline">
                            {a.summary ?? "—"}
                          </Link>
                        ) : (
                          a.summary ?? "—"
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{a.actor_name ?? "System"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <Pagination {...result} basePath="/activity" params={sp} noun="events" />
        </div>
      </PageBody>
    </>
  );
}
