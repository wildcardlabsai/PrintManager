import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ServerIcon } from "lucide-react";
import { AgentRowActions, CreateAgentButton } from "@/components/printers/agents-panel";
import { PrintersTabs } from "@/components/printers/printers-tabs";
import { ago } from "@/components/printers/telemetry-bits";
import { EmptyState } from "@/components/shared/empty-state";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/domain/dates";
import { secondsSince } from "@/lib/printers/status";
import { hasPermission, requirePageContext } from "@/lib/services/context";
import { listAgents } from "@/lib/services/printers/agents";

export const metadata: Metadata = { title: "Printer Agents" };

export default async function AgentsPage() {
  const ctx = await requirePageContext();
  const agents = await listAgents(ctx);
  const canManage = hasPermission(ctx, "manage_agents");
  const h = await headers();
  const serverUrl = process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const now = new Date();
  const offlineAfter = ctx.settings.printer_offline_after_seconds;

  return (
    <>
      <PageHeader
        title="Printers"
        description="Printer Agents connect printers on your local network to PrintFlow."
        actions={canManage && <CreateAgentButton serverUrl={serverUrl} />}
      />
      <PrintersTabs active="agents" />
      <PageBody>
        {agents.length === 0 ? (
          <EmptyState icon={ServerIcon} title="No Printer Agents" description="Add one to connect your Flashforge printers." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {agents.map((a) => {
              const online = a.status === "active" && secondsSince(a.last_seen_at, now) <= offlineAfter;
              return (
                <Card key={a.id}>
                  <CardHeader>
                    <div className="flex w-full items-start justify-between gap-2">
                      <CardTitle>{a.name}</CardTitle>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={a.status === "revoked" ? "red" : a.status === "pending" ? "amber" : online ? "green" : "neutral"}>
                          {a.status === "active" ? (online ? "Online" : "Offline") : a.status === "pending" ? "Waiting to pair" : "Revoked"}
                        </Badge>
                        {a.driver === "mock" && <Badge tone="cyan">Mock (simulated printers)</Badge>}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-[13px]">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">Last seen</dt>
                      <dd>{a.last_seen_at ? `${ago(a.last_seen_at, now)} · ${formatDateTime(a.last_seen_at, ctx.settings.timezone)}` : "Never"}</dd>
                      <dt className="text-muted-foreground">Version</dt>
                      <dd>{a.version ?? "—"}</dd>
                      <dt className="text-muted-foreground">Platform</dt>
                      <dd>{a.platform ?? "—"}</dd>
                      <dt className="text-muted-foreground">FlashNetwork</dt>
                      <dd>{a.library_version ?? "—"}</dd>
                      <dt className="text-muted-foreground">Token issued</dt>
                      <dd>{a.token_issued_at ? formatDateTime(a.token_issued_at, ctx.settings.timezone) : "—"} (rotates weekly)</dd>
                      {a.status === "pending" && a.pairing_expires_at && (
                        <>
                          <dt className="text-muted-foreground">Code expires</dt>
                          <dd>{formatDateTime(a.pairing_expires_at, ctx.settings.timezone)}</dd>
                        </>
                      )}
                      <dt className="text-muted-foreground">Printers</dt>
                      <dd>
                        {a.printers.length
                          ? a.printers.map((p, i) => (
                              <span key={p.id}>
                                {i > 0 && ", "}
                                <Link href={`/printers/${p.id}`} className="hover:underline">
                                  {p.name}
                                </Link>
                              </span>
                            ))
                          : "None yet — set a printer's connection to this agent"}
                      </dd>
                    </dl>
                    {canManage && <AgentRowActions agentId={a.id} name={a.name} status={a.status} serverUrl={serverUrl} />}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Connecting a Flashforge AD5X or Adventurer 5M</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-[13px]">
              <li>
                On the printer, turn on <strong>LAN mode</strong> (Settings → Network → Network mode) and note the <strong>serial number</strong> and{" "}
                <strong>check code</strong> (“Printer ID”) shown there.
              </li>
              <li>
                On a computer on the same network, install Flashforge&apos;s <strong>Orca-Flashforge</strong> slicer. The agent uses Flashforge&apos;s own
                network library from that installation; PrintFlow doesn&apos;t ship or modify it.
              </li>
              <li>
                Install Node.js 20+ and the PrintFlow Printer Agent (the <code>agent/</code> folder of this project: <code>npm install &amp;&amp; npm run build</code>).
              </li>
              <li>Add a Printer Agent above and run the pairing command it shows.</li>
              <li>
                Store each printer&apos;s check code on that computer: <code>printflow-agent set-check-code SN…</code>. It never leaves the computer.
              </li>
              <li>
                Start the agent with <code>printflow-agent run</code>, then open the printer here, choose <em>Connection settings</em>, pick the agent and enter
                the serial number.
              </li>
              <li>Work through the printer&apos;s live test checklist, including a small supervised test print.</li>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              The agent only makes outgoing HTTPS requests to PrintFlow and can only carry out a fixed set of printer commands (start a verified file,
              pause, resume, stop, status checks). PrintFlow cannot run anything else on that computer.
            </p>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
