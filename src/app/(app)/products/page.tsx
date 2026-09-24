import type { Metadata } from "next";
import Link from "next/link";
import { BoxIcon, PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { LinkTabs } from "@/components/shared/link-tabs";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { SearchInput } from "@/components/shared/search-input";
import { DemoBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { calculateMargin } from "@/lib/domain/costing";
import { formatDuration, formatGrams } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { requirePageContext } from "@/lib/services/context";
import { listProducts, type ProductListFilter } from "@/lib/services/products";

export const metadata: Metadata = { title: "Products" };

const FILTERS: { key: ProductListFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const filter = (FILTERS.find((f) => f.key === sp.filter)?.key ?? "active") as ProductListFilter;
  const q = typeof sp.q === "string" ? sp.q : "";
  const result = await listProducts(ctx, { q, filter, page: Number(sp.page) || 1 });
  const money = (v: number) => formatMoney(v, ctx.settings.currency);

  return (
    <>
      <PageHeader
        title="Products"
        description="Your catalogue, SKUs and per-unit costs."
        actions={
          <Button asChild size="sm">
            <Link href="/products/new">
              <PlusIcon /> New product
            </Link>
          </Button>
        }
      />
      <PageBody>
        <div className="rounded-lg border bg-card">
          <div className="flex flex-col gap-2 border-b px-3 pt-1 sm:flex-row sm:items-end sm:justify-between">
            <LinkTabs
              active={filter}
              tabs={FILTERS.map((f) => ({ key: f.key, label: f.label, href: f.key === "active" ? "/products" : `/products?filter=${f.key}` }))}
            />
            <div className="pb-2">
              <SearchInput placeholder="Search name, SKU, material" />
            </div>
          </div>
          {result.rows.length === 0 ? (
            <EmptyState
              icon={BoxIcon}
              title={q ? "No products match your search" : "No products here"}
              description={q ? undefined : "Add the things you sell so orders can calculate costs and create production jobs."}
              action={
                !q && (
                  <Button asChild size="sm">
                    <Link href="/products/new">
                      <PlusIcon /> New product
                    </Link>
                  </Button>
                )
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="hidden md:table-cell">Material</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Unit cost</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Profit</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Print time</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Filament</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((p) => {
                  const m = calculateMargin(p.selling_price, p.cost_price);
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="size-9 shrink-0 overflow-hidden rounded border bg-muted">
                            {p.primary_image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.primary_image} alt="" className="size-full object-cover" />
                            ) : (
                              <BoxIcon className="m-2.5 size-4 text-muted-foreground" aria-hidden />
                            )}
                          </div>
                          <div className="min-w-0">
                            <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                              {p.name}
                            </Link>
                            {p.is_demo && <DemoBadge className="ml-1.5" />}
                            {!p.is_active && !p.archived_at && (
                              <Badge tone="outline" className="ml-1.5">
                                Inactive
                              </Badge>
                            )}
                            <div className="font-mono text-xs text-muted-foreground">
                              {p.sku}
                              {p.variant_count > 0 && <span className="font-sans"> · {p.variant_count} variants</span>}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{p.material}</TableCell>
                      <TableCell className="tabular text-right">{money(p.selling_price)}</TableCell>
                      <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">{money(p.cost_price)}</TableCell>
                      <TableCell className="tabular hidden text-right sm:table-cell">
                        {money(m.profit)}
                        {m.margin != null && <span className="ml-1 text-xs text-muted-foreground">{Math.round(m.margin * 100)}%</span>}
                      </TableCell>
                      <TableCell className="tabular hidden text-right lg:table-cell">{formatDuration(p.print_minutes)}</TableCell>
                      <TableCell className="tabular hidden text-right lg:table-cell">{formatGrams(p.filament_grams)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <Pagination {...result} basePath="/products" params={sp} noun="products" />
        </div>
      </PageBody>
    </>
  );
}
