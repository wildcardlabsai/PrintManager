import type { Metadata } from "next";
import Link from "next/link";
import { InfoIcon, PlusIcon, PrinterIcon } from "lucide-react";
import { PrinterFormDialog } from "@/components/printers/printer-form-dialog";
import { PrinterLiveCard } from "@/components/printers/printer-live-card";
import { PrintersTabs } from "@/components/printers/printers-tabs";
import { AutoRefresh } from "@/components/shared/auto-refresh";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Stat } from "@/components/shared/stat";
import { Button } from "@/components/ui/button";
import { effectivePrinterStatus } from "@/lib/printers/status";
import { hasPermission, requirePageContext } from "@/lib/services/context";
import { loadPrinterView } from "@/lib/services/printers/production-view";

export const metadata: Metadata = { title: "Printers" };

export default async function PrintersPage() {
  const ctx = await requirePageContext();
  const { printers, now } = await loadPrinterView(ctx);
  const offlineAfter = ctx.settings.printer_offline_after_seconds;
  const canConfigure = hasPermission(ctx, "configure_printers");
  const statuses = printers.map((p) => effectivePrinterStatus(p, now, offlineAfter));
  const connected = printers.filter((p) => p.connection_mode === "agent_lan");
  const attention = printers.filter((p) => p.current_job?.needs_attention || p.status === "error").length;

  return (
    <>
      <AutoRefresh intervalMs={10_000} />
      <PageHeader
        title="Printers"
        description="Live status from connected printers; manual status for the rest."
        actions={
          canConfigure && (
            <PrinterFormDialog
              trigger={
                <Button size="sm">
                  <PlusIcon /> Add printer
                </Button>
              }
            />
          )
        }
      />
      <PrintersTabs active="printers" />
      <PageBody>
        <div className="grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:grid-cols-4 sm:divide-y-0">
          <Stat label="Printing" value={statuses.filter((s) => s === "printing" || s === "paused").length} />
          <Stat label="Idle" value={statuses.filter((s) => s === "idle").length} />
          <Stat label="Offline / unknown" value={statuses.filter((s) => s === "offline" || s === "unknown").length} />
          <Stat label="Needs attention" value={attention} emphasis={attention ? "danger" : null} />
        </div>
        {connected.length === 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              No printer is connected yet, so statuses here are set by hand. To connect a Flashforge AD5X or Adventurer 5M, run the{" "}
              <Link href="/printers/agents" className="font-medium underline">
                PrintFlow Printer Agent
              </Link>{" "}
              on a computer on the same network, then set the printer&apos;s connection on its page.
            </p>
          </div>
        )}
        {printers.length === 0 ? (
          <EmptyState icon={PrinterIcon} title="No printers" description="Add the printers you use so jobs can be assigned to them." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {printers.map((p) => (
              <PrinterLiveCard
                key={p.id}
                printer={p}
                now={now}
                offlineAfter={offlineAfter}
                timeZone={ctx.settings.timezone}
                canOperate={hasPermission(ctx, "operate_printers")}
                canEdit={canConfigure}
              />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
