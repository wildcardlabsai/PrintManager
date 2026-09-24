import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ImagesPanel } from "@/components/products/images-panel";
import { ProductArchiveButton } from "@/components/products/product-archive-button";
import { ProductForm } from "@/components/products/product-form";
import { VariantsPanel } from "@/components/products/variants-panel";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { DemoBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { requirePageContext } from "@/lib/services/context";
import { AppError } from "@/lib/services/errors";
import { getProduct, listPrinterOptions } from "@/lib/services/products";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const { id } = await params;
  const ctx = await requirePageContext();
  const [data, printers] = await Promise.all([
    getProduct(ctx, id).catch((e) => {
      if (e instanceof AppError && e.code === "not_found") notFound();
      throw e;
    }),
    listPrinterOptions(ctx),
  ]);
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
      </PageBody>
    </>
  );
}
