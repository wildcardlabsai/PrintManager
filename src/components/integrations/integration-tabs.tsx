"use client";

import { usePathname } from "next/navigation";
import { LinkTabs } from "@/components/shared/link-tabs";

export function IntegrationTabs({ attention }: { attention: number }) {
  const pathname = usePathname();
  const tabs = [
    { key: "/settings/integrations", label: "Connections", href: "/settings/integrations" },
    { key: "/settings/integrations/imports", label: "Needs mapping", href: "/settings/integrations/imports", count: attention },
    { key: "/settings/integrations/mappings", label: "Product mappings", href: "/settings/integrations/mappings" },
    { key: "/settings/integrations/history", label: "Sync history", href: "/settings/integrations/history" },
  ];
  return <LinkTabs tabs={tabs} active={tabs.find((t) => t.key === pathname)?.key ?? "/settings/integrations"} />;
}
