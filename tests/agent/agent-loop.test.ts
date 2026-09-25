import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRevokedError, PrinterAgent } from "../../agent/src/agent";
import { ServerError } from "../../agent/src/api";
import type { AgentConfig } from "../../agent/src/config";
import { MockPrinterFleet, MockTransport } from "../../agent/src/flashforge/mock";
import type { AgentCommand, CommandResultRequest, FileTicket, HeartbeatRequest, HeartbeatResponse } from "../../agent/src/protocol";

const PRINTER = { id: "11111111-1111-4111-8111-111111111111", name: "AD5X", model: "AD5X" as const, modelLabel: "Flashforge AD5X", serialNumber: "SN1", ipAddress: "127.0.0.1", lanPort: 8899 };
const content = Buffer.from("G28\nG1 X10\n");
const sha = crypto.createHash("sha256").update(content).digest("hex");
const dataUrl = `data:application/octet-stream;base64,${content.toString("base64")}`;

class FakeApi {
  beats: HeartbeatRequest[] = [];
  results: { id: string; body: CommandResultRequest }[] = [];
  queue: AgentCommand[] = [];
  token = "pfa_old";
  rotate: string | null = null;
  failResults = 0;
  revoked = false;
  async heartbeat(body: HeartbeatRequest): Promise<HeartbeatResponse> {
    if (this.revoked) throw new ServerError("revoked", 401);
    this.beats.push(body);
    const commands = this.queue;
    this.queue = [];
    const res: HeartbeatResponse = { printers: [PRINTER], commands, pollIntervalMs: 5000 };
    if (this.rotate) {
      res.rotatedToken = this.rotate;
      this.rotate = null;
    }
    return res;
  }
  async fileTicket(): Promise<FileTicket> {
    return { url: dataUrl, sha256: sha, sizeBytes: content.length, fileName: "PF-JOB-0001-Test.gcode", expiresAt: new Date(Date.now() + 60000).toISOString() };
  }
  async reportResult(id: string, body: CommandResultRequest) {
    if (this.failResults-- > 0) throw new Error("network down");
    this.results.push({ id, body });
    return { ok: true as const };
  }
  setToken(t: string) {
    this.token = t;
  }
}

let dir: string;
let api: FakeApi;
let fleet: MockPrinterFleet;
let agent: PrinterAgent;
const config = (): AgentConfig => ({ serverUrl: "https://printflow.test", agentId: "a", token: "pfa_old", driver: "mock", checkCodes: { SN1: "code" } });
const future = () => new Date(Date.now() + 60000).toISOString();
const start = (over: Partial<Extract<AgentCommand, { type: "start_print" }>["payload"]> = {}): AgentCommand => ({
  id: crypto.randomUUID(),
  printerId: PRINTER.id,
  type: "start_print",
  expiresAt: future(),
  payload: {
    printFileId: "f",
    fileName: "PF-JOB-0001-Test.gcode",
    sha256: sha,
    sizeBytes: content.length,
    fileType: "gcode",
    levelingBeforePrint: true,
    flowCalibration: false,
    firstLayerInspection: false,
    timeLapseVideo: false,
    useMaterialStation: false,
    materialMappings: [],
    ...over,
  },
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-agent-"));
  process.env.PRINTFLOW_AGENT_CONFIG = path.join(dir, "config.json");
  api = new FakeApi();
  fleet = new MockPrinterFleet([{ serialNumber: "SN1", checkCode: "code", model: "AD5X" }], { speed: 1, printSeconds: 60, heatingSeconds: 3 });
  agent = new PrinterAgent(config(), new MockTransport(fleet), api, () => {}, path.join(dir, "work"));
});
afterEach(() => {
  delete process.env.PRINTFLOW_AGENT_CONFIG;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function cycle() {
  await agent.tick();
  await agent.idle();
}

describe("PrinterAgent", () => {
  it("reports telemetry for the printers PrintFlow configured", async () => {
    await cycle(); // learns printers
    await cycle();
    const report = api.beats[1].printers[0];
    expect(report).toMatchObject({ printerId: PRINTER.id, reachable: true, errorCode: null });
    expect(report.telemetry?.status).toBe("ready");
    expect(api.beats[1].agent.driver).toBe("mock");
  });

  it("reports a missing check code instead of guessing", async () => {
    agent = new PrinterAgent({ ...config(), checkCodes: {} }, new MockTransport(fleet), api, () => {}, dir);
    await cycle();
    await cycle();
    expect(api.beats[1].printers[0]).toMatchObject({ reachable: false, errorCode: "MISSING_CHECK_CODE" });
  });

  it("downloads, verifies and sends a print, then cleans up", async () => {
    await cycle();
    const cmd = start();
    api.queue.push(cmd);
    await cycle();
    expect(api.results).toEqual([{ id: cmd.id, body: expect.objectContaining({ status: "succeeded" }) }]);
    expect(api.results[0].body.telemetry?.printFileName).toBe("PF-JOB-0001-Test.gcode");
    expect(fleet.snapshot("SN1")!.lastSend).toMatchObject({ dstName: "PF-JOB-0001-Test.gcode", printNow: true, levelingBeforePrint: true });
    expect(fs.readdirSync(path.join(dir, "work"))).toEqual([]);
  });

  it("refuses a file whose checksum doesn't match", async () => {
    await cycle();
    const cmd = start({ sha256: "0".repeat(64) });
    api.queue.push(cmd);
    await cycle();
    expect(api.results[0].body).toMatchObject({ status: "failed", errorCode: "CHECKSUM_MISMATCH" });
    expect(fleet.snapshot("SN1")!.lastSend).toBeNull();
  });

  it("refuses unsafe file names and expired commands", async () => {
    await cycle();
    api.queue.push(start({ fileName: "../../etc/passwd.gcode" }));
    api.queue.push({ ...start(), id: "expired", expiresAt: new Date(Date.now() - 1000).toISOString() });
    await cycle();
    expect(api.results.map((r) => r.body.status)).toEqual(["failed", "failed"]);
    expect(fleet.snapshot("SN1")!.lastSend).toBeNull();
  });

  it("only runs whitelisted commands", async () => {
    await cycle();
    api.queue.push({ id: "x", printerId: PRINTER.id, type: "shell" as never, payload: {} as never, expiresAt: future() });
    await cycle();
    expect(api.results[0].body).toMatchObject({ status: "failed", errorCode: "NOT_SUPPORTED" });
  });

  it("pauses / resumes / stops only the job PrintFlow expects", async () => {
    await cycle();
    api.queue.push(start());
    await cycle();
    const jobId = fleet.snapshot("SN1")!.jobId;
    api.queue.push({ id: "p1", printerId: PRINTER.id, type: "pause", payload: { expectedJobId: "someone-else", expectedFileName: null }, expiresAt: future() });
    await cycle();
    expect(api.results.at(-1)!.body).toMatchObject({ status: "failed", errorCode: "JOB_MISMATCH" });
    api.queue.push({ id: "p2", printerId: PRINTER.id, type: "stop", payload: { expectedJobId: null, expectedFileName: "PF-JOB-0001-Test.gcode" }, expiresAt: future() });
    await cycle();
    expect(api.results.at(-1)!.body).toMatchObject({ status: "succeeded", result: { jobId } });
  });

  it("queues commands per printer and runs them in order", async () => {
    await cycle();
    api.queue.push(start(), { id: "q2", printerId: PRINTER.id, type: "pause", payload: { expectedJobId: null, expectedFileName: "PF-JOB-0001-Test.gcode" }, expiresAt: future() });
    await cycle();
    expect(api.results.map((r) => r.body.status)).toEqual(["succeeded", "succeeded"]);
    expect(fleet.snapshot("SN1")!.phase).toMatch(/^paus/);
  });

  it("answers connection tests", async () => {
    await cycle();
    api.queue.push({ id: "t", printerId: PRINTER.id, type: "test_connection", payload: {}, expiresAt: future() });
    await cycle();
    expect(api.results[0].body).toMatchObject({ status: "succeeded", result: { firmwareVersion: "mock-1.0.0" } });
  });

  it("stores a rotated token (owner-only file) and uses it", async () => {
    api.rotate = "pfa_new";
    await cycle();
    expect(api.token).toBe("pfa_new");
    const saved = JSON.parse(fs.readFileSync(process.env.PRINTFLOW_AGENT_CONFIG!, "utf8"));
    expect(saved.token).toBe("pfa_new");
    if (process.platform !== "win32") expect(fs.statSync(process.env.PRINTFLOW_AGENT_CONFIG!).mode & 0o777).toBe(0o600);
  });

  it("keeps results until the server takes them", async () => {
    await cycle();
    api.failResults = 1000;
    const cmd = { id: "t2", printerId: PRINTER.id, type: "refresh" as const, payload: {}, expiresAt: future() };
    api.queue.push(cmd);
    await cycle();
    expect(api.results).toHaveLength(0);
    api.failResults = 0;
    await cycle();
    expect(api.results.map((r) => r.id)).toEqual(["t2"]);
  });

  it("stops when the token is revoked", async () => {
    api.revoked = true;
    await expect(agent.tick()).rejects.toBeInstanceOf(AgentRevokedError);
  });

  it("reports an unreachable printer and recovers", async () => {
    await cycle();
    fleet.control("SN1", "offline");
    const discover = vi.spyOn(MockTransport.prototype, "discover");
    await cycle();
    expect(api.beats.at(-1)!.printers[0]).toMatchObject({ reachable: false, errorCode: "UNREACHABLE" });
    expect(discover).toHaveBeenCalled();
    fleet.control("SN1", "online");
    await cycle();
    expect(api.beats.at(-1)!.printers[0]).toMatchObject({ reachable: true });
  });
});
