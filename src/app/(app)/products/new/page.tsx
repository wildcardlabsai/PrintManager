import type { Metadata } from "next";
import { ProductForm } from "@/components/products/product-form";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { requirePageContext } from "@/lib/services/context";
import { listPrinterOptions } from "@/lib/services/products";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const ctx = await requirePageContext();
  const printers = await listPrinterOptions(ctx);
  return (
    <>
      <PageHeader back={{ href: "/products", label: "Products" }} title="New product" />
      <PageBody>
        <ProductForm printers={printers} settings={ctx.settings} currency={ctx.settings.currency} />
      </PageBody>
    </>
  );
}
