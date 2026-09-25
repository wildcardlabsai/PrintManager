import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ServerError, type PrintFlowApi } from "./api.js";
import { saveConfig, type AgentConfig } from "./config.js";
import { createFlashforgeIntegration } from "./flashforge/adapter.js";
import type { DiscoveredPrinter, FlashforgeTransport, LanTarget } from "./flashforge/transport.js";
import type { PrinterIntegration, Result } from "./integration.js";
import {
  AGENT_COMMAND_TYPES,
  AGENT_PROTOCOL_VERSION,
  type AgentCommand,
  type AgentErrorCode,
  type AgentPrinterConfig,
  type CommandResultRequest,
  type PrinterReport,
  type PrinterTelemetry,
} from "./protocol.js";

export const AGENT_VERSION = "0.3.0";
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const DISCOVERY_INTERVAL_MS = 60_000;

export type Logger = (level: "info" | "warn" | "error", message: string) => void;
export const consoleLogger: Logger = (level, message) => {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  if (level === "error") console.error(line);
  else console.log(line);
};

type Api = Pick<PrintFlowApi, "heartbeat" | "fileTicket" | "reportResult" | "setToken">;

export class AgentRevokedError extends Error {}

/**
 * The agent loop: poll each configured printer over the LAN, send the
 * telemetry to PrintFlow, and carry out the whitelisted commands PrintFlow
 * returns. There is no other way for the server to act on this machine.
 */
export class PrinterAgent {
  printers: AgentPrinterConfig[] = [];
  private discovered = new Map<string, DiscoveredPrinter>();
  private lastDiscovery = 0;
  /** Printers with a command in progress, so uploads aren't interleaved with other calls. */
  private busy = new Map<string, Promise<void>>();
  private pendingResults: { id: string; body: CommandResultRequest; attempts: number }[] = [];
  private stopped = false;
  pollIntervalMs = 10_000;

  constructor(
    private config: AgentConfig,
    private readonly transport: FlashforgeTransport,
    private readonly api: Api,
    private readonly log: Logger = consoleLogger,
    private readonly workDir = path.join(os.tmpdir(), "printflow-agent"),
  ) {}

  stop() {
    this.stopped = true;
  }

  async run() {
    let backoff = 1000;
    while (!this.stopped) {
      try {
        await this.tick();
        backoff = 1000;
        await sleep(this.pollIntervalMs);
      } catch (error) {
        if (error instanceof AgentRevokedError) throw error;
        this.log("warn", `Could not reach PrintFlow: ${(error as Error).message}. Retrying in ${Math.round(backoff / 1000)} s.`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  /** One heartbeat cycle. Exposed for tests. */
  async tick() {
    const reports = await this.pollAll();
    let res;
    try {
      res = await this.api.heartbeat({
        protocol: AGENT_PROTOCOL_VERSION,
        agent: { version: AGENT_VERSION, platform: `${process.platform}-${process.arch}`, driver: this.transport.kind, libraryVersion: this.transport.libraryVersion() },
        printers: reports,
      });
    } catch (error) {
      if (error instanceof ServerError && error.status === 401) {
        throw new AgentRevokedError("PrintFlow rejected this agent's token (revoked or replaced). Pair the agent again.");
      }
      throw error;
    }
    if (res.rotatedToken) {
      this.config = { ...this.config, token: res.rotatedToken };
      saveConfig(this.config);
      this.api.setToken(res.rotatedToken);
      this.log("info", "Agent token rotated.");
    }
    this.printers = res.printers;
    this.pollIntervalMs = Math.max(2000, Math.min(res.pollIntervalMs, 60_000));
    for (const cmd of res.commands) this.enqueue(cmd);
    await this.flushResults();
  }

  /** Waits for commands started by the last tick (tests). */
  async idle() {
    while (this.busy.size) await Promise.all([...this.busy.values()]);
    await this.flushResults();
  }

  // --- printers --------------------------------------------------------------

  private async pollAll(): Promise<PrinterReport[]> {
    const out: PrinterReport[] = [];
    await Promise.all(
      this.printers.map(async (p) => {
        if (this.busy.has(p.id)) return; // mid-command; report on the next cycle
        out.push(await this.poll(p));
      }),
    );
    return out;
  }

  private report(p: AgentPrinterConfig, code: AgentErrorCode, error: string): PrinterReport {
    return { printerId: p.id, reachable: false, latencyMs: null, errorCode: code, error, telemetry: null };
  }

  private async resolveTarget(p: AgentPrinterConfig, forceDiscovery = false): Promise<Result<{ target: LanTarget; integration: PrinterIntegration }>> {
    if (!p.model) return { ok: false, code: "NOT_SUPPORTED", message: `${p.modelLabel || "This model"} is not supported by the Flashforge LAN integration.` };
    if (!p.serialNumber) return { ok: false, code: "NOT_CONFIGURED", message: "Add the printer's serial number in PrintFlow." };
    const checkCode = this.config.checkCodes[p.serialNumber];
    if (!checkCode) {
      return { ok: false, code: "MISSING_CHECK_CODE", message: `No check code on this agent for ${p.serialNumber}. Run: printflow-agent set-check-code ${p.serialNumber}` };
    }
    let found = this.discovered.get(p.serialNumber);
    if ((!p.ipAddress || !p.lanPort || forceDiscovery) && (!found || forceDiscovery)) {
      await this.discover();
      found = this.discovered.get(p.serialNumber);
    }
    const ip = forceDiscovery && found ? found.ip : p.ipAddress ?? found?.ip;
    const port = p.lanPort ?? found?.port;
    if (!ip || !port) {
      return { ok: false, code: "NOT_CONFIGURED", message: "The printer wasn't found on the local network. Check it is on and in LAN mode, or enter its IP address and port." };
    }
    const target = { ip, port, serialNumber: p.serialNumber, checkCode };
    return { ok: true, value: { target, integration: createFlashforgeIntegration(p.model, this.transport, target) } };
  }

  async discover(force = false) {
    if (!force && Date.now() - this.lastDiscovery < DISCOVERY_INTERVAL_MS) return [...this.discovered.values()];
    this.lastDiscovery = Date.now();
    try {
      const list = await this.transport.discover(1500);
      for (const d of list) this.discovered.set(d.serialNumber, d);
      return list;
    } catch (error) {
      this.log("warn", `LAN discovery failed: ${(error as Error).message}`);
      return [];
    }
  }

  private async poll(p: AgentPrinterConfig): Promise<PrinterReport> {
    let resolved = await this.resolveTarget(p);
    if (!resolved.ok) return this.report(p, resolved.code, resolved.message);
    const started = Date.now();
    let t = await safe(() => resolved.ok ? resolved.value.integration.getTelemetry() : Promise.reject());
    if (!t.ok && t.code === "UNREACHABLE") {
      // DHCP may have moved it: look for the same serial number elsewhere on the network.
      const again = await this.resolveTarget(p, true);
      if (again.ok && again.value.target.ip !== resolved.value.target.ip) {
        resolved = again;
        t = await safe(() => again.value.integration.getTelemetry());
      }
    }
    if (!t.ok) return this.report(p, t.code, t.message);
    return { printerId: p.id, reachable: true, latencyMs: Date.now() - started, errorCode: null, error: null, telemetry: t.value };
  }

  // --- commands --------------------------------------------------------------

  private enqueue(cmd: AgentCommand) {
    if (!(AGENT_COMMAND_TYPES as readonly string[]).includes(cmd.type)) {
      this.queueResult(cmd.id, { status: "failed", errorCode: "NOT_SUPPORTED", error: `Unknown command type ${String(cmd.type)}` });
      return;
    }
    const prev = this.busy.get(cmd.printerId) ?? Promise.resolve();
    const next = prev
      .then(() => this.execute(cmd))
      .catch((error) => {
        this.log("error", `Command ${cmd.type} failed: ${(error as Error).message}`);
        this.queueResult(cmd.id, { status: "failed", errorCode: "ERROR", error: (error as Error).message });
      })
      .finally(() => {
        if (this.busy.get(cmd.printerId) === next) this.busy.delete(cmd.printerId);
      });
    this.busy.set(cmd.printerId, next);
  }

  private async execute(cmd: AgentCommand) {
    const printer = this.printers.find((p) => p.id === cmd.printerId);
    if (!printer) {
      this.queueResult(cmd.id, { status: "failed", errorCode: "NOT_CONFIGURED", error: "This agent does not manage that printer." });
      return;
    }
    if (new Date(cmd.expiresAt).getTime() < Date.now()) {
      this.queueResult(cmd.id, { status: "failed", errorCode: "INVALID_STATE", error: "Command expired before it could run." });
      return;
    }
    const resolved = await this.resolveTarget(printer);
    if (!resolved.ok) {
      this.queueResult(cmd.id, { status: "failed", errorCode: resolved.code, error: resolved.message });
      return;
    }
    const integration = resolved.value.integration;
    this.log("info", `${printer.name}: ${cmd.type}`);

    let outcome: Result<Record<string, string | number | boolean | null>>;
    switch (cmd.type) {
      case "start_print":
        outcome = await this.startPrint(cmd, integration);
        break;
      case "pause":
      case "resume":
      case "stop": {
        const jobId = await this.resolveJobId(integration, cmd.payload.expectedJobId, cmd.payload.expectedFileName);
        if (!jobId.ok) {
          outcome = jobId;
          break;
        }
        const fn = cmd.type === "pause" ? integration.pausePrint : cmd.type === "resume" ? integration.resumePrint : integration.stopPrint;
        const r = await safe(() => fn.call(integration, jobId.value));
        outcome = r.ok ? { ok: true, value: { jobId: jobId.value } } : r;
        break;
      }
      case "refresh":
      case "test_connection": {
        const r = await safe(() => integration.connect());
        outcome = r.ok
          ? { ok: true, value: { latencyMs: r.value.latencyMs, firmwareVersion: r.value.firmwareVersion, name: r.value.name, pid: r.value.pid } }
          : r;
        break;
      }
      case "clear_platform": {
        const r = await safe(() => integration.clearPlatform());
        outcome = r.ok ? { ok: true, value: {} } : r;
        break;
      }
    }

    const fresh = await safe(() => integration.getTelemetry());
    this.queueResult(
      cmd.id,
      outcome.ok
        ? { status: "succeeded", result: outcome.value, telemetry: fresh.ok ? fresh.value : null }
        : { status: "failed", errorCode: outcome.code, error: outcome.message, telemetry: fresh.ok ? fresh.value : null },
    );
  }

  private async resolveJobId(integration: PrinterIntegration, expectedJobId: string | null, expectedFileName: string | null): Promise<Result<string>> {
    const current = await safe(() => integration.getCurrentJob());
    if (!current.ok) return current;
    const { jobId, fileName } = current.value;
    if (!jobId) return { ok: false, code: "INVALID_STATE", message: "The printer is not running a job." };
    if (expectedJobId ? jobId !== expectedJobId : !expectedFileName || fileName !== expectedFileName) {
      return { ok: false, code: "JOB_MISMATCH", message: "The printer is running a different job from the one PrintFlow expected, so nothing was changed." };
    }
    return { ok: true, value: jobId };
  }

  private async startPrint(
    cmd: Extract<AgentCommand, { type: "start_print" }>,
    integration: PrinterIntegration,
  ): Promise<Result<Record<string, string | number | boolean | null>>> {
    const p = cmd.payload;
    if (!/^[\w.\- ()]{1,120}\.(gcode|gx|3mf)$/i.test(p.fileName)) return { ok: false, code: "INVALID_STATE", message: "Unsafe file name." };
    if (p.sizeBytes > MAX_FILE_BYTES) return { ok: false, code: "INVALID_STATE", message: "File is too large." };
    fs.mkdirSync(this.workDir, { recursive: true, mode: 0o700 });
    const local = path.join(this.workDir, `${cmd.id}-${path.basename(p.fileName)}`);
    try {
      const ticket = await this.api.fileTicket(cmd.id);
      const dl = await download(ticket.url, local, p.sizeBytes);
      if (!dl.ok) return dl;
      if (dl.value !== p.sha256 || dl.value !== ticket.sha256) {
        return { ok: false, code: "CHECKSUM_MISMATCH", message: "The downloaded file does not match its checksum, so it was not sent." };
      }
      const sent = await safe(() =>
        integration.sendPrintJob({
          filePath: local,
          fileName: p.fileName,
          levelingBeforePrint: p.levelingBeforePrint,
          flowCalibration: p.flowCalibration,
          firstLayerInspection: p.firstLayerInspection,
          timeLapseVideo: p.timeLapseVideo,
          useMaterialStation: p.useMaterialStation,
          materialMappings: p.materialMappings,
        }),
      );
      return sent.ok ? { ok: true, value: { fileName: p.fileName } } : sent;
    } catch (error) {
      return { ok: false, code: "DOWNLOAD_FAILED", message: (error as Error).message };
    } finally {
      fs.rmSync(local, { force: true });
    }
  }

  private queueResult(id: string, body: CommandResultRequest) {
    this.pendingResults.push({ id, body, attempts: 0 });
    void this.flushResults();
  }

  private flushing: Promise<void> | null = null;
  private flushResults(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const remaining: typeof this.pendingResults = [];
      while (this.pendingResults.length) {
        const item = this.pendingResults.shift()!;
        try {
          await this.api.reportResult(item.id, item.body);
        } catch (error) {
          // 4xx other than timeouts: the server won't accept it later either.
          if (error instanceof ServerError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
            this.log("warn", `Result for command ${item.id} rejected: ${error.message}`);
          } else if (++item.attempts < 20) {
            remaining.push(item);
          }
        }
      }
      this.pendingResults.push(...remaining);
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }
}

async function safe<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    const msg = (error as Error).message ?? String(error);
    return { ok: false, code: /within \d+ ms/.test(msg) ? "TIMEOUT" : "ERROR", message: msg };
  }
}

async function download(url: string, dest: string, expectedSize: number): Promise<Result<string>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok || !res.body) return { ok: false, code: "DOWNLOAD_FAILED", message: `Download failed (HTTP ${res.status}).` };
  const hash = crypto.createHash("sha256");
  let size = 0;
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    size += chunk.length;
    hash.update(chunk);
    if (size > expectedSize) body.destroy(new Error("File is larger than expected."));
  });
  await pipeline(body, fs.createWriteStream(dest, { mode: 0o600 }));
  if (size !== expectedSize) return { ok: false, code: "CHECKSUM_MISMATCH", message: "The downloaded file is not the expected size." };
  return { ok: true, value: hash.digest("hex") };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export type { PrinterTelemetry };
