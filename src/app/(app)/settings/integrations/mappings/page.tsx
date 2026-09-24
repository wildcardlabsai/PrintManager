import type { Metadata } from "next";
import Link from "next/link";
import { LinkIcon } from "lucide-react";
import { DeleteMappingButton } from "@/components/integrations/delete-mapping-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBody } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/domain/dates";
import { SALES_CHANNEL_SHORT } from "@/lib/domain/labels";
import { requirePageContext } from "@/lib/services/context";
import { listMappings } from "@/lib/services/integrations/mappings";

export const metadata: Metadata = { title: "Product mappings" };

export default async function MappingsPage() {
  const ctx = await requirePageContext();
  const rows = await listMappings(ctx);
  return (
    <PageBody>
      <p className="text-sm text-muted-foreground">
        How marketplace listings map to PrintFlow products. Matching SKUs are mapped automatically; anything else is mapped by you from
        &ldquo;Needs mapping&rdquo;.
      </p>
      <div className="rounded-lg border bg-card">
        {rows.length === 0 ? (
          <EmptyState icon={LinkIcon} title="No mappings yet" description="They appear here after the first marketplace import." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Marketplace item</TableHead>
                <TableHead>PrintFlow product</TableHead>
                <TableHead className="hidden md:table-cell">Source</TableHead>
                <TableHead className="hidden md:table-cell">Added</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{SALES_CHANNEL_SHORT[m.sales_channel]}</TableCell>
                  <TableCell className="max-w-72 whitespace-normal">
                    <div className="truncate">{m.external_title ?? "—"}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {m.external_listing_id && `listing ${m.external_listing_id}`}
                      {m.external_product_id && ` · variation ${m.external_product_id}`}
                      {m.external_sku && `SKU ${m.external_sku}`}
                    </div>
                  </TableCell>
                  <TableCell>
                    {m.product ? (
                      <Link href={`/products/${m.product.id}`} className="hover:underline">
                        {m.product.name}
                        {m.variant && ` — ${m.variant.name}`}
                      </Link>
                    ) : (
                      "—"
                    )}
                    <div className="font-mono text-xs text-muted-foreground">{m.variant?.sku ?? m.product?.sku}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge tone={m.source === "auto" ? "blue" : "neutral"}>{m.source === "auto" ? "SKU match" : "Manual"}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{formatDate(m.created_at, ctx.settings.timezone)}</TableCell>
                  <TableCell className="text-right">
                    <DeleteMappingButton id={m.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </PageBody>
  );
}
