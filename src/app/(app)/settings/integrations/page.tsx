import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from "lucide-react";
import { MarketplaceConnectionActions } from "@/components/integrations/connection-actions";
import { CONNECTION_STATUS_META, IMPORT_STATUS_META } from "@/components/integrations/labels";
import { RoyalMailConnect } from "@/components/integrations/royal-mail-form";
import { DetailList } from "@/components/shared/detail-list";
import { PageBody } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatShortDateTime } from "@/lib/domain/dates";
import { META_STATUS } from "@/lib/integrations/meta/status";
import { UNAVAILABLE_SHIPPING_PROVIDERS } from "@/lib/integrations/shipping/registry";
import { royalMailClickDrop } from "@/lib/integrations/shipping/royal-mail-click-drop";
import { requirePageContext } from "@/lib/services/context";
import { integrationSetup, listConnections } from "@/lib/services/integrations/connections";
import { listRecentExternalOrders } from "@/lib/services/integrations/mappings";
import type { IntegrationConnection } from "@/lib/services/integrations/types";
import { SALES_CHANNEL_SHORT } from "@/lib/domain/labels";

export const metadata: Metadata = { title: "Integrations" };

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function Health({ conn, tz, sync = true }: { conn: IntegrationConnection | undefined; tz: string; sync?: boolean }) {
  if (!conn) return null;
  return (
    <DetailList
      items={[
        ["Account", conn.external_account_name ?? conn.external_account_id ?? "—"],
        ...(conn.environment === "sandbox" ? ([["Environment", "Sandbox"]] as [string, string][]) : []),
        ["Connected", formatDateTime(conn.connected_at, tz)],
        ...(sync
          ? ([
              ["Last sync", formatDateTime(conn.last_sync_at, tz)],
              ["Last successful sync", formatDateTime(conn.last_success_at, tz)],
              ["Last failed sync", formatDateTime(conn.last_failure_at, tz)],
            ] as [string, string][])
          : []),
        ["Last error", conn.last_error ? <span className="text-red-700">{conn.last_error}</span> : "—"],
      ]}
    />
  );
}

function MissingConfig({ vars }: { vars: string[] }) {
  if (!vars.length) return null;
  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        Server configuration needed before connecting: <span className="font-mono">{vars.join(", ")}</span>. See .env.example.
      </span>
    </p>
  );
}

function Endpoint({ label, path, configured }: { label: string; path: string; configured: boolean }) {
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        {configured ? <CheckCircle2Icon className="size-3.5 text-emerald-600" aria-hidden /> : <InfoIcon className="size-3.5 text-muted-foreground" aria-hidden />}
        {label} {configured ? "configured" : "not configured"}
      </div>
      <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-[11px]">{`${siteUrl()}${path}`}</code>
    </div>
  );
}

export default async function IntegrationsPage({ searchParams }: PageProps<"/settings/integrations">) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const [connections, recent] = await Promise.all([listConnections(ctx), listRecentExternalOrders(ctx, 15)]);
  const setup = integrationSetup();
  const tz = ctx.settings.timezone;
  const etsy = connections.etsy;
  const ebay = connections.ebay;
  const rm = connections.royal_mail_click_drop;
  const statusOf = (c?: IntegrationConnection) => CONNECTION_STATUS_META[c?.status ?? "not_connected"];

  return (
    <PageBody>
      {typeof sp.connected === "string" && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
          {sp.connected === "etsy" ? "Etsy" : "eBay"} connected{typeof sp.account === "string" && sp.account ? ` to ${sp.account}` : ""}. Run a sync to import paid orders.
        </p>
      )}
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {sp.error}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Etsy</CardTitle>
              <CardDescription>Imports paid receipts, keeps them in sync, and sends tracking back when you ship.</CardDescription>
            </div>
            <StatusBadge meta={statusOf(etsy)} />
          </CardHeader>
          <CardContent className="space-y-4">
            <MissingConfig vars={setup.etsyMissing} />
            <Health conn={etsy?.status === "disconnected" ? undefined : etsy} tz={tz} />
            <MarketplaceConnectionActions provider="etsy" name="Etsy" status={etsy?.status ?? null} configured={!setup.etsyMissing.length} />
            <Endpoint label="Webhook (order events)" path="/api/webhooks/etsy" configured={setup.etsyWebhookConfigured} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>eBay</CardTitle>
              <CardDescription>
                Imports paid orders through the Sell Fulfillment API and records shipments with tracking.
                {setup.ebayEnvironment === "sandbox" && " Using the eBay sandbox."}
              </CardDescription>
            </div>
            <StatusBadge meta={statusOf(ebay)} />
          </CardHeader>
          <CardContent className="space-y-4">
            <MissingConfig vars={setup.ebayMissing} />
            <Health conn={ebay?.status === "disconnected" ? undefined : ebay} tz={tz} />
            <MarketplaceConnectionActions provider="ebay" name="eBay" status={ebay?.status ?? null} configured={!setup.ebayMissing.length} />
            <Endpoint label="Account deletion notifications" path="/api/webhooks/ebay/account-deletion" configured={setup.ebayDeletionConfigured} />
            <p className="text-xs text-muted-foreground">
              eBay has no order webhooks in its REST APIs, so orders arrive through Sync now and the scheduled sync
              {setup.cronConfigured ? "" : " (set CRON_SECRET to enable it)"}. Inventory sync is not enabled: PrintFlow makes items to order and has no stock levels to publish.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Facebook / Meta</CardTitle>
              <CardDescription>{META_STATUS.summary}</CardDescription>
            </div>
            <StatusBadge meta={{ label: META_STATUS.label, tone: "slate" }} />
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {META_STATUS.fallback}{" "}
              <Link href="/orders/new" className="font-medium text-primary hover:underline">
                New order
              </Link>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Shipping — Royal Mail Click &amp; Drop</CardTitle>
              <CardDescription>Creates Click &amp; Drop orders from PrintFlow and brings tracking numbers back.</CardDescription>
            </div>
            <StatusBadge meta={statusOf(rm)} />
          </CardHeader>
          <CardContent className="space-y-4">
            <MissingConfig vars={setup.platformMissing} />
            {rm && rm.status !== "disconnected" && <Health conn={rm} tz={tz} sync={false} />}
            <RoyalMailConnect connected={rm?.status === "connected"} configured={!setup.platformMissing.length} oba={rm?.config?.oba === true} />
            <div className="flex flex-wrap gap-1.5 text-xs">
              {Object.entries({ ...royalMailClickDrop.capabilities, retrieveLabel: rm?.config?.oba === true }).map(([k, v]) => (
                <Badge key={k} tone={v ? "green" : "outline"}>
                  {v ? "✓" : "✗"} {k === "createLabel" ? "Create shipment" : k === "retrieveLabel" ? "Label PDF (OBA)" : k === "cancelLabel" ? "Cancel" : k === "rates" ? "Rates" : "Tracking number"}
                </Badge>
              ))}
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {UNAVAILABLE_SHIPPING_PROVIDERS.map((p) => (
                <li key={p.id}>
                  <span className="font-medium text-foreground">{p.name}:</span> not available — {p.reason}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent marketplace orders</CardTitle>
          <Link href="/settings/integrations/history" className="text-xs font-medium text-primary hover:underline">
            Sync history
          </Link>
        </CardHeader>
        {recent.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">No marketplace orders seen yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>External order</TableHead>
                <TableHead className="hidden sm:table-cell">Buyer</TableHead>
                <TableHead>Import</TableHead>
                <TableHead className="hidden md:table-cell">Last synced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{SALES_CHANNEL_SHORT[r.sales_channel]}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.order_id ? (
                      <Link href={`/orders/${r.order_id}`} className="text-primary hover:underline">
                        {r.external_order_id}
                      </Link>
                    ) : (
                      r.external_order_id
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{r.buyer_name ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge meta={IMPORT_STATUS_META[r.import_status]} />
                    {r.import_note && <div className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">{r.import_note}</div>}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{formatShortDateTime(r.last_synced_at, tz)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageBody>
  );
}
