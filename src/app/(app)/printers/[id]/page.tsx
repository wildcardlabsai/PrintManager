import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CameraIcon, CheckIcon, FlaskConicalIcon, MinusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { detectModel, MODEL_CAPABILITIES, MODEL_LABELS } from "../../../../../agent/src/protocol";
import { ConnectionSettingsDialog } from "@/components/printers/connection-settings";
import { LiveChecklistPanel } from "@/components/printers/live-checklist";
import { PrinterControls } from "@/components/printers/printer-controls";
import { PrinterFormDialog } from "@/components/printers/printer-form-dialog";
import { LoadedFilament, NA, PrinterBadges, TelemetryProgress, ago, temp, valueOrNA } from "@/components/printers/telemetry-bits";
import { SendToPrinterDialog } from "@/components/production/send-to-printer-dialog";
import { AutoRefresh } from "@/components/shared/auto-refresh";
import { DetailList } from "@/components/shared/detail-list";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/domain/dates";
import { firmwareWarnings } from "@/lib/printers/dispatch";
import { connectionView, estimateRemainingSeconds, formatDuration, rawStatusLabel } from "@/lib/printers/status";
import { jobLabel } from "@/lib/production-labels";
import { hasPermission, requirePageContext } from "@/lib/services/context";
import { AppError } from "@/lib/services/errors";
import { getPrinterDetail } from "@/lib/services/printers";
import { loadPrinterView } from "@/lib/services/printers/production-view";

export const metadata: Metadata = { title: "Printer" };

const EVENT_LABELS: Record<string, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  print_started: "Print started",
  print_paused: "Print paused",
  print_resumed: "Print resumed",
  print_stopped: "Print stopped",
  print_completed: "Print completed",
  print_failed: "Print failed",
  error: "Error",
  status_changed: "Status changed",
  command_failed: "Command failed",
  firmware_changed: "Firmware changed",
};

export default async function PrinterPage({ params }: PageProps<"/printers/[id]">) {
  const { id } = await params;
  const ctx = await requirePageContext();
  const view = await loadPrinterView(ctx);
  const detail = await getPrinterDetail(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const { printer: p, events, commands, agents, agent, testFiles } = detail;
  const tz = ctx.settings.timezone;
  const now = view.now;
  const offlineAfter = ctx.settings.printer_offline_after_seconds;
  const conn = connectionView(p, now, offlineAfter);
  const t = p.telemetry;
  const model = detectModel(p.model);
  const canConfigure = hasPermission(ctx, "configure_printers");
  const canOperate = hasPermission(ctx, "operate_printers");
  const manual = p.connection_mode === "manual";
  const job = p.current_job;
  const recentErrors = [
    ...commands.filter((c) => c.status === "failed" || c.status === "expired").map((c) => ({ at: c.created_at, text: `${c.type.replace("_", " ")}: ${c.error ?? c.error_code ?? c.status}` })),
    ...events.filter((e) => e.type === "error" || e.type === "print_failed").map((e) => ({ at: e.created_at, text: e.message ?? e.type })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);
  const cameraAvailable = t?.camera === 1 && t.cameraStreamUrl;
  const reportedIp = t?.ipAddress;

  return (
    <>
      {!manual && <AutoRefresh intervalMs={10_000} />}
      <PageHeader
        back={{ href: "/printers", label: "Printers" }}
        title={p.name}
        meta={<PrinterBadges printer={p} now={now} offlineAfter={offlineAfter} />}
        description={[p.manufacturer, p.model].filter(Boolean).join(" ") + (p.location ? ` · ${p.location}` : "")}
        actions={
          <>
            {canConfigure && <ConnectionSettingsDialog printer={p} agents={agents} supported={Boolean(model)} />}
            {canConfigure && (
              <PrinterFormDialog
                printer={p}
                trigger={
                  <Button size="sm" variant="outline">
                    Edit details
                  </Button>
                }
              />
            )}
          </>
        }
      />
      <PageBody>
        {p.telemetry_source === "mock" && (
          <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
            <FlaskConicalIcon className="mr-1.5 inline size-4" />
            This printer is being driven by a <strong>mock agent</strong>: every value below comes from a simulator, not from a physical printer.
          </div>
        )}
        {!manual && !p.live_verified_at && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <TriangleAlertIcon className="mr-1.5 inline size-4" />
            Not verified yet. PrintFlow won&apos;t send production jobs to this printer until the live test checklist below is complete.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{manual ? "Status" : "Live status"}</CardTitle>
                  <CardDescription>
                    {manual ? "Set by hand — this printer isn't connected." : conn.live ? `Reported ${ago(p.last_seen_at, now)}` : conn.detail}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {!manual && (
                  <PrinterControls
                    printerId={p.id}
                    printerName={p.name}
                    live={conn.live}
                    job={job ? { id: job.id, label: jobLabel(job), productName: job.product_name, status: job.status } : null}
                    rawStatus={p.raw_status}
                    bedClear={p.bed_clear}
                    canOperate={canOperate}
                    showChecks
                  />
                )}
                {job ? (
                  <div className="space-y-1.5 rounded-md border px-3 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                      <Link href={`/production/${job.id}`} className="font-medium hover:underline">
                        {jobLabel(job)} · {job.product_name} × {job.quantity}
                      </Link>
                      <span className="text-xs text-muted-foreground">{job.status}</span>
                    </div>
                    {!manual && (
                      <TelemetryProgress
                        progress={job.progress}
                        layer={job.current_layer}
                        totalLayers={job.total_layers}
                        elapsedSeconds={job.printer_elapsed_seconds}
                        remainingSeconds={job.remaining_seconds}
                        paused={job.status === "paused"}
                      />
                    )}
                    {job.needs_attention && <p className="text-xs text-red-700">{job.attention_reason}</p>}
                  </div>
                ) : t && conn.live && t.printFileName && ["printing", "heating", "pause", "pausing"].includes(t.status ?? "") ? (
                  <div className="space-y-1.5 rounded-md border px-3 py-2.5">
                    <p className="text-[13px]">
                      Printing <span className="font-mono">{t.printFileName}</span> <span className="text-muted-foreground">(not started from PrintFlow)</span>
                    </p>
                    <TelemetryProgress
                      progress={t.printProgress == null ? null : t.printProgress * 100}
                      layer={t.printLayer}
                      totalLayers={t.targetPrintLayer}
                      elapsedSeconds={t.printDuration}
                      remainingSeconds={estimateRemainingSeconds(t.printProgress, t.printDuration)}
                    />
                  </div>
                ) : null}
                {!manual && (
                  <DetailList
                    items={[
                      ["Printer state", conn.live ? rawStatusLabel(p.raw_status) : NA],
                      ["Nozzle", temp(conn.live ? t?.nozzleTemp : null, t?.nozzleTargetTemp)],
                      ["Bed", temp(conn.live ? t?.bedTemp : null, t?.bedTargetTemp)],
                      ["Chamber", temp(conn.live ? t?.chamberTemp : null, t?.chamberTargetTemp)],
                      ["Filament", <LoadedFilament key="f" t={conn.live ? t : null} />],
                      ["Build plate", p.bed_clear ? "Confirmed clear" : <span className="text-amber-700">Needs clearing</span>],
                      ["Printer's time estimate", t?.estimatedTime ? formatDuration(t.estimatedTime) : NA],
                      ["Printer's filament estimate", t?.estimatedRightWeight ? `${t.estimatedRightWeight} (as reported)` : NA],
                      ["Door", valueOrNA(t?.doorStatus)],
                      ["Light", valueOrNA(t?.lightStatus)],
                      ["Free storage", t?.remainingDiskSpaceGb != null ? `${t.remainingDiskSpaceGb.toFixed(1)} GB` : NA],
                      ["Error code", t?.errorCode ? <span className="text-red-700">{t.errorCode}</span> : "None reported"],
                    ]}
                  />
                )}
              </CardContent>
            </Card>

            {!manual && (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Live test checklist</CardTitle>
                    <CardDescription>Required before PrintFlow sends production jobs to this printer.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <LiveChecklistPanel
                    printerId={p.id}
                    checklist={p.live_checklist ?? {}}
                    verifiedAt={p.live_verified_at}
                    canConfigure={canConfigure}
                    identity={`Reported: ${t?.name ?? "name not available"} · serial ${p.serial_number ?? "?"} · IP ${reportedIp ?? p.ip_address ?? "?"} · firmware ${
                      p.firmware_version ?? "?"
                    }`}
                    testPrint={
                      <SendToPrinterDialog
                        mode="test"
                        summary={{ title: "Test print (no production job)", product: "Test file" }}
                        printers={[{ id: p.id, name: p.name, model: p.model, connected: true }]}
                        files={testFiles.map((f) => ({
                          ...f,
                          colour_channels: 1,
                          filament_assignments: [],
                          estimated_minutes: null,
                          estimated_grams: null,
                          material: null,
                          colour: null,
                          file_type: "gcode" as const,
                        }))}
                        defaultPrinterId={p.id}
                        trigger={
                          <Button size="sm" variant="outline">
                            Send test print
                          </Button>
                        }
                      />
                    }
                  />
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Events</CardTitle>
              </CardHeader>
              {events.length === 0 ? (
                <CardContent>
                  <p className="text-sm text-muted-foreground">No events yet.</p>
                </CardContent>
              ) : (
                <ul className="divide-y text-[13px]">
                  {events.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2">
                      <span>
                        <Badge
                          tone={
                            e.type === "error" || e.type === "print_failed" || e.type === "command_failed"
                              ? "red"
                              : e.type === "disconnected"
                                ? "neutral"
                                : e.type === "print_completed" || e.type === "connected"
                                  ? "green"
                                  : "outline"
                          }
                        >
                          {EVENT_LABELS[e.type] ?? e.type}
                        </Badge>{" "}
                        {e.message}
                        {e.production_job_id && (
                          <Link href={`/production/${e.production_job_id}`} className="ml-1 text-xs text-primary hover:underline">
                            job
                          </Link>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatDateTime(e.created_at, tz)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Diagnostics</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailList
                  items={[
                    ["Connection", manual ? "Manual" : conn.label],
                    ["Mode", manual ? "Manual" : "Flashforge LAN via Printer Agent"],
                    ["Model", model ? MODEL_LABELS[model] : p.model || NA],
                    ["Serial number", p.serial_number ? <span className="font-mono text-xs">{p.serial_number}</span> : NA],
                    [
                      "IP address",
                      p.ip_address || reportedIp ? (
                        <span className="font-mono text-xs">
                          {p.ip_address ?? "auto"}
                          {reportedIp && reportedIp !== p.ip_address && <span className="text-amber-700"> (printer reports {reportedIp})</span>}
                        </span>
                      ) : (
                        NA
                      ),
                    ],
                    ["LAN port", p.lan_port ?? (manual ? NA : "From discovery")],
                    [
                      "Firmware",
                      p.firmware_version ? (
                        <span>
                          {p.firmware_version}
                          <span className="block text-[11px] text-muted-foreground">Displayed only. PrintFlow never updates firmware.</span>
                          {firmwareWarnings(p).map((w) => (
                            <span key={w} className="block text-[11px] text-amber-700">
                              {w}
                            </span>
                          ))}
                        </span>
                      ) : (
                        NA
                      ),
                    ],
                    [
                      "Agent",
                      agent ? (
                        <Link href="/printers/agents" className="hover:underline">
                          {agent.name} · {agent.status}
                          {agent.driver === "mock" ? " · mock" : ""}
                        </Link>
                      ) : (
                        NA
                      ),
                    ],
                    ["Agent version", valueOrNA(agent?.version)],
                    ["FlashNetwork library", valueOrNA(agent?.library_version)],
                    ["Last seen", p.last_seen_at ? `${ago(p.last_seen_at, now)} · ${formatDateTime(p.last_seen_at, tz)}` : NA],
                    ["Last heartbeat", p.last_heartbeat_at ? `${ago(p.last_heartbeat_at, now)}` : NA],
                    ["Latency", p.latency_ms != null ? `${p.latency_ms} ms` : NA],
                    ["Failed requests in a row", manual ? NA : p.consecutive_failures],
                    ["Printer job ID", valueOrNA(t?.jobId)],
                    ["Printer file", t?.printFileName ? <span className="font-mono text-xs break-all">{t.printFileName}</span> : NA],
                    ["Last error", p.last_error ? `${p.last_error}${p.last_error_at ? ` (${ago(p.last_error_at, now)})` : ""}` : "None"],
                    ["Offline after", `${offlineAfter}s without status`],
                    [
                      "Recent errors",
                      recentErrors.length ? (
                        <ul className="space-y-0.5 text-xs">
                          {recentErrors.map((e, i) => (
                            <li key={i}>
                              <span className="text-red-700">{e.text}</span> <span className="text-muted-foreground">· {ago(e.at, now)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        "None"
                      ),
                    ],
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Camera</CardTitle>
              </CardHeader>
              <CardContent className="text-[13px]">
                {cameraAvailable ? (
                  <p>
                    <CameraIcon className="mr-1 inline size-4" />
                    The printer reports a camera stream.{" "}
                    <a href={t!.cameraStreamUrl!} target="_blank" rel="noreferrer noopener" className="text-primary underline">
                      Open stream
                    </a>{" "}
                    <span className="block text-xs text-muted-foreground">Works only on the same local network as the printer.</span>
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {t?.camera === 2 ? "The printer reports its camera is disabled." : "No camera stream reported by the printer."}
                  </p>
                )}
              </CardContent>
            </Card>

            {model && (
              <Card>
                <CardHeader>
                  <CardTitle>Capabilities</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-[13px]">
                    {MODEL_CAPABILITIES[model].map((c) => (
                      <li key={c.key} className="flex gap-2">
                        {c.support === "supported" ? (
                          <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Supported" />
                        ) : c.support === "not_supported" ? (
                          <XIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not supported" />
                        ) : (
                          <MinusIcon className="mt-0.5 size-4 shrink-0 text-blue-600" aria-label="Depends on the printer" />
                        )}
                        <span>
                          {c.label}
                          {c.note && <span className="block text-xs text-muted-foreground">{c.note}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-muted-foreground">
                    “Supported” means PrintFlow implements it through Flashforge&apos;s LAN interface. It has not been confirmed on this printer until the
                    checklist is complete.
                  </p>
                </CardContent>
              </Card>
            )}

            {!manual && (
              <Card>
                <CardHeader>
                  <CardTitle>Recent commands</CardTitle>
                </CardHeader>
                {commands.length === 0 ? (
                  <CardContent>
                    <p className="text-sm text-muted-foreground">None yet.</p>
                  </CardContent>
                ) : (
                  <ul className="divide-y text-[13px]">
                    {commands.map((c) => (
                      <li key={c.id} className="px-4 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span>
                            {c.type.replace("_", " ")}
                            {c.automatic && <span className="text-xs text-muted-foreground"> · automatic</span>}
                          </span>
                          <Badge tone={c.status === "succeeded" ? "green" : c.status === "failed" || c.status === "expired" ? "red" : "outline"}>{c.status}</Badge>
                        </div>
                        {c.error && <p className="text-xs text-red-700">{c.error}</p>}
                        <p className="text-[11px] text-muted-foreground">{formatDateTime(c.created_at, tz)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}
