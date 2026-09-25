import { LinkTabs } from "@/components/shared/link-tabs";

export function PrintersTabs({ active }: { active: "printers" | "agents" | "stats" }) {
  return (
    <div className="border-b bg-card">
      <div className="mx-auto max-w-[1400px] px-4 lg:px-6">
        <LinkTabs
          active={active}
          tabs={[
            { key: "printers", label: "Printers", href: "/printers" },
            { key: "agents", label: "Printer Agents", href: "/printers/agents" },
            { key: "stats", label: "Statistics", href: "/printers/stats" },
          ]}
        />
      </div>
    </div>
  );
}
