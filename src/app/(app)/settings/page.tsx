import type { Metadata } from "next";
import { DemoDataPanel } from "@/components/settings/demo-data-panel";
import { SettingsForm } from "@/components/settings/settings-form";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { INTEGRATIONS } from "@/lib/integrations/registry";
import { requirePageContext } from "@/lib/services/context";
import { hasDemoData } from "@/lib/services/demo-data";
import { listPrinterOptions } from "@/lib/services/products";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requirePageContext();
  const [printers, demo] = await Promise.all([listPrinterOptions(ctx), hasDemoData(ctx)]);
  return (
    <>
      <PageHeader title="Settings" description={`${ctx.settings.business_name} · signed in as ${ctx.email ?? ""}`} />
      <PageBody className="max-w-5xl">
        <SettingsForm settings={ctx.settings} printers={printers} />

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Integrations</CardTitle>
              <CardDescription>Nothing is connected in Phase 1. Credentials will be configured server-side when each integration is built.</CardDescription>
            </div>
          </CardHeader>
          <ul className="divide-y">
            {INTEGRATIONS.map((i) => (
              <li key={i.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.capabilities.join(" · ")}
                    {i.notes && <> — {i.notes}</>}
                  </div>
                </div>
                <Badge tone="outline">Coming in Phase {i.phase}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card id="demo" className="scroll-mt-20">
          <CardHeader>
            <div>
              <CardTitle>Demo data</CardTitle>
              <CardDescription>
                {demo ? "Demo records are loaded and marked with a Demo badge." : "Load sample data to explore PrintFlow."}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <DemoDataPanel loaded={demo} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
