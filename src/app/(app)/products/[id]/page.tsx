import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintFileDialog } from "@/components/print-files/print-file-form";
import { PrintFileTable } from "@/components/print-files/print-file-table";
import { ImagesPanel } from "@/components/products/images-panel";
import { ProductArchiveButton } from "@/components/products/product-archive-button";
import { ProductForm } from "@/components/products/product-form";
import { VariantsPanel } from "@/components/products/variants-panel";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { DemoBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { hasPermission, requirePageContext } from "@/lib/services/context";
import { listPrintFiles } from "@/lib/services/print-files";
import { AppError } from "@/lib/services/errors";
import { getProduct, listPrinterOptions } from "@/lib/services/products";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const { id } = await params;
  const ctx = await requirePageContext();
  const [data, printers, files] = await Promise.all([
    getProduct(ctx, id).catch((e) => {
      if (e instanceof AppError && e.code === "not_found") notFound();
      throw e;
    }),
    listPrinterOptions(ctx),
    listPrintFiles(ctx, { productId: id }),
  ]);
  const canManage = hasPermission(ctx, "manage_production");
  const { product: p } = data;
  const currency = ctx.settings.currency;

  return (
    <>
      <PageHeader
        back={{ href: "/products", label: "Products" }}
        title={p.name}
        meta={
          <>
            <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
            {p.is_demo && <DemoBadge />}
            {p.archived_at && <Badge tone="outline">Archived</Badge>}
          </>
        }
        description={
          <>
            {data.unitsSold} sold · {formatMoney(data.revenue, currency)} revenue · created {formatDate(p.created_at, ctx.settings.timezone)} · updated{" "}
            {formatDate(p.updated_at, ctx.settings.timezone)}
          </>
        }
        actions={<ProductArchiveButton id={p.id} archived={Boolean(p.archived_at)} />}
      />
      <PageBody>
        <ProductForm
          key={p.updated_at}
          product={p}
          compatiblePrinterIds={data.compatiblePrinterIds}
          printers={printers}
          settings={ctx.settings}
          currency={currency}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <VariantsPanel productId={p.id} productSku={p.sku} basePrice={p.selling_price} variants={data.variants} currency={currency} />
          <ImagesPanel productId={p.id} images={data.images} />
        </div>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Print files</CardTitle>
              <CardDescription>Sliced files for this product. The default file for each printer model is picked when sending a job.</CardDescription>
            </div>
            {canManage && <PrintFileDialog orgId={ctx.orgId} products={[{ id: p.id, name: p.name, sku: p.sku }]} productId={p.id} />}
          </CardHeader>
          {files.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">No print files yet. Upload the sliced file for each printer you use.</p>
          ) : (
            <div className="overflow-x-auto">
              <PrintFileTable
                files={files}
                orgId={ctx.orgId}
                products={[{ id: p.id, name: p.name, sku: p.sku }]}
                canManage={canManage}
                timeZone={ctx.settings.timezone}
                showProduct={false}
              />
            </div>
          )}
        </Card>
      </PageBody>
    </>
  );
}
