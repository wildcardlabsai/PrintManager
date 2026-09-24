import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon, UsersIcon } from "lucide-react";
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { SearchInput } from "@/components/shared/search-input";
import { DemoBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { requirePageContext } from "@/lib/services/context";
import { listCustomers } from "@/lib/services/customers";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const q = typeof sp.q === "string" ? sp.q : "";
  const archived = sp.archived === "1";
  const result = await listCustomers(ctx, { q, page: Number(sp.page) || 1, includeArchived: archived });
  const money = (v: number) => formatMoney(v, ctx.settings.currency);
  const tz = ctx.settings.timezone;

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone who has ordered from you, across every channel."
        actions={
          <CustomerFormDialog
            trigger={
              <Button size="sm">
                <PlusIcon /> New customer
              </Button>
            }
          />
        }
      />
      <PageBody>
        <div className="rounded-lg border bg-card">
          <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput placeholder="Search name, email, phone, postcode" />
            <Link
              href={archived ? "/customers" : "/customers?archived=1"}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {archived ? "Hide archived" : "Show archived"}
            </Link>
          </div>
          {result.rows.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title={q ? "No customers match your search" : "No customers yet"}
              description={q ? "Try a different name, email or postcode." : "Customers are created when you add them here or when you create an order."}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead className="hidden lg:table-cell">Phone</TableHead>
                  <TableHead className="hidden md:table-cell">Location</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Total spent</TableHead>
                  <TableHead className="hidden sm:table-cell">Last order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((c) => (
                  <TableRow key={c.id} className={c.archived_at ? "opacity-60" : undefined}>
                    <TableCell>
                      <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      {c.is_demo && <DemoBadge className="ml-1.5" />}
                      {c.archived_at && <span className="ml-1.5 text-xs text-muted-foreground">(archived)</span>}
                      <div className="text-xs text-muted-foreground md:hidden">{c.email}</div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{c.email ?? "—"}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{c.phone ?? "—"}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {[c.city, c.postcode].filter(Boolean).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="tabular text-right">{c.order_count}</TableCell>
                    <TableCell className="tabular text-right">{money(c.total_spent)}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(c.last_order_at, tz)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination {...result} basePath="/customers" params={sp} noun="customers" />
        </div>
      </PageBody>
    </>
  );
}
