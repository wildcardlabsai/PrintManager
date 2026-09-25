import type { Metadata } from "next";
import Link from "next/link";
import { FileCodeIcon } from "lucide-react";
import { PrintFileDialog } from "@/components/print-files/print-file-form";
import { PrintFileTable } from "@/components/print-files/print-file-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { hasPermission, requirePageContext } from "@/lib/services/context";
import { listPrintFiles } from "@/lib/services/print-files";
import { listProductOptions } from "@/lib/services/products";

export const metadata: Metadata = { title: "Print files" };

export default async function PrintFilesPage({ searchParams }: PageProps<"/print-files">) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const archived = sp.archived === "1";
  const [files, productRows] = await Promise.all([listPrintFiles(ctx, { includeArchived: archived }), listProductOptions(ctx)]);
  const products = productRows.map((p) => ({ id: p.id, name: p.name, sku: p.sku }));
  const canManage = hasPermission(ctx, "manage_production");
  return (
    <>
      <PageHeader
        title="Print files"
        description="Sliced files ready for a specific printer. PrintFlow sends these to connected printers; it never slices models."
        actions={canManage && <PrintFileDialog orgId={ctx.orgId} products={products} />}
      />
      <PageBody>
        <div className="flex justify-end text-xs">
          <Link href={archived ? "/print-files" : "/print-files?archived=1"} className="text-muted-foreground hover:text-foreground">
            {archived ? "Hide archived" : "Show archived"}
          </Link>
        </div>
        {files.length === 0 ? (
          <EmptyState
            icon={FileCodeIcon}
            title="No print files yet"
            description="Slice a product for your AD5X or Adventurer 5M (e.g. in Orca-Flashforge), then upload the .gcode/.gx/.3mf here and link it to the product."
          />
        ) : (
          <Card className="overflow-x-auto">
            <PrintFileTable
              files={files}
              orgId={ctx.orgId}
              products={products}
              canManage={canManage}
              timeZone={ctx.settings.timezone}
              highlight={typeof sp.file === "string" ? sp.file : null}
            />
          </Card>
        )}
      </PageBody>
    </>
  );
}
