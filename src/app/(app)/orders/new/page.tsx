import type { Metadata } from "next";
import { OrderForm } from "@/components/orders/order-form";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { requirePageContext } from "@/lib/services/context";
import { listCustomerOptions } from "@/lib/services/customers";
import { listProductOptions } from "@/lib/services/products";

export const metadata: Metadata = { title: "New order" };

export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const [customers, products] = await Promise.all([listCustomerOptions(ctx), listProductOptions(ctx)]);
  return (
    <>
      <PageHeader
        back={{ href: "/orders", label: "Orders" }}
        title="New order"
        description="Totals, costs and profit are calculated automatically. Production jobs are created when you save."
      />
      <PageBody>
        <OrderForm
          customers={customers}
          products={products}
          settings={ctx.settings}
          currency={ctx.settings.currency}
          defaultProvider={ctx.settings.default_shipping_provider}
          initialCustomerId={typeof sp.customer === "string" ? sp.customer : null}
        />
      </PageBody>
    </>
  );
}
