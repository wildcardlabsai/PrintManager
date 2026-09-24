import type { Metadata } from "next";
import { InfoIcon, PlusIcon, PrinterIcon } from "lucide-react";
import { PrinterCard } from "@/components/printers/printer-card";
import { PrinterFormDialog } from "@/components/printers/printer-form-dialog";
import { DetailList } from "@/components/shared/detail-list";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageContext } from "@/lib/services/context";
import { listPrinters } from "@/lib/services/printers";

export const metadata: Metadata = { title: "Printers" };

export default async function PrintersPage() {
  const ctx = await requirePageContext();
  const printers = await listPrinters(ctx);
  return (
    <>
      <PageHeader
        title="Printers"
        description="Your machines, their manual status and what's on them."
        actions={
          <PrinterFormDialog
            trigger={
              <Button size="sm">
                <PlusIcon /> Add printer
              </Button>
            }
          />
        }
      />
      <PageBody>
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <strong>Manual status — live printer integration coming in Phase 3.</strong> Statuses here are set by you (or by
            starting/completing jobs in PrintFlow). No live telemetry is read from the printers yet.
          </p>
        </div>
        {printers.length === 0 ? (
          <EmptyState icon={PrinterIcon} title="No printers" description="Add the printers you use so jobs can be assigned to them." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {printers.map((p) => (
              <PrinterCard key={p.id} printer={p} timeZone={ctx.settings.timezone} />
            ))}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {printers.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle>{p.name} details</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailList
                  items={[
                    ["Manufacturer", p.manufacturer || "—"],
                    ["Model", p.model || "—"],
                    ["IP address", p.ip_address ? <span className="font-mono">{p.ip_address}</span> : "—"],
                    ["Location", p.location || "—"],
                    ["Build volume", p.build_volume || "—"],
                    [
                      "Capabilities",
                      p.capabilities.length ? (
                        <span className="flex flex-wrap gap-1">
                          {p.capabilities.map((c) => (
                            <Badge key={c} tone="outline">
                              {c}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        "—"
                      ),
                    ],
                    ["Notes", p.notes || "—"],
                    ["Live integration", <span key="i" className="text-muted-foreground">Not connected (Phase 3)</span>],
                  ]}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}
