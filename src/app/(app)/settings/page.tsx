import type { Metadata } from "next";
import { DemoDataPanel } from "@/components/settings/demo-data-panel";
import { SettingsForm } from "@/components/settings/settings-form";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
              <CardDescription>Etsy and eBay order sync, product mapping, Royal Mail shipping and sync history.</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/integrations">Manage integrations</Link>
            </Button>
          </CardHeader>
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
