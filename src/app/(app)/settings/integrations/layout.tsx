import { IntegrationTabs } from "@/components/integrations/integration-tabs";
import { PageHeader } from "@/components/shared/page-header";
import { requirePageContext } from "@/lib/services/context";
import { countAttentionImports } from "@/lib/services/integrations/mappings";

export default async function IntegrationsLayout({ children }: LayoutProps<"/settings/integrations">) {
  const ctx = await requirePageContext();
  const attention = await countAttentionImports(ctx);
  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Integrations"
        description="Marketplace orders, product mapping, shipping labels and sync history."
      />
      <div className="border-b bg-card">
        <div className="mx-auto max-w-[1400px] px-4 lg:px-6">
          <IntegrationTabs attention={attention} />
        </div>
      </div>
      {children}
    </>
  );
}
