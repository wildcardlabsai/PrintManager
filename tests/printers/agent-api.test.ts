import { describe, expect, it } from "vitest";
import { bearerToken, generateAgentToken, generatePairingCode, hashSecret, normalisePairingCode } from "@/lib/printers/agent-auth";
import { commandResultSchema, heartbeatSchema, pairSchema } from "@/lib/validation/agent";
import { telemetry } from "./fixtures";

describe("agent credentials", () => {
  it("pairing codes are readable, unambiguous and normalisable", () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(normalisePairingCode(code.toLowerCase().replace(/-/g, " "))).toBe(code);
    expect(normalisePairingCode("short")).toBeNull();
    expect(new Set(Array.from({ length: 50 }, generatePairingCode)).size).toBe(50);
  });
  it("tokens are long random secrets stored only as hashes", () => {
    const t = generateAgentToken();
    expect(t).toMatch(/^pfa_[A-Za-z0-9_-]{43}$/);
    expect(hashSecret(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(t)).not.toContain(t.slice(4, 20));
  });
  it("only accepts well-formed bearer tokens", () => {
    const t = generateAgentToken();
    expect(bearerToken(`Bearer ${t}`)).toBe(t);
    expect(bearerToken(t)).toBeNull();
    expect(bearerToken("Bearer abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("agent request validation", () => {
  const hb = (printers: unknown[]) => ({
    protocol: 1,
    agent: { version: "0.3.0", platform: "linux-x64", driver: "flashforge_lan", libraryVersion: "3.0.0" },
    printers,
  });
  it("accepts a normal heartbeat", () => {
    const r = heartbeatSchema.parse(hb([{ printerId: "7d6f6a4b-5d36-4b5e-9c3a-6e0f2f1d2c3b", reachable: true, latencyMs: 40, errorCode: null, error: null, telemetry: telemetry() }]));
    expect(r.printers[0].telemetry?.status).toBe("ready");
  });
  it("rejects the wrong protocol version, bad ids and oversized lists", () => {
    expect(() => heartbeatSchema.parse({ ...hb([]), protocol: 2 })).toThrow();
    expect(() => heartbeatSchema.parse(hb([{ printerId: "../etc", reachable: true, latencyMs: null, errorCode: null, error: null, telemetry: null }]))).toThrow();
    expect(() => heartbeatSchema.parse(hb(Array.from({ length: 51 }, () => ({})))) ).toThrow();
  });
  it("drops unknown keys and neutralises unsafe values", () => {
    const r = heartbeatSchema.parse(
      hb([
        {
          printerId: "7d6f6a4b-5d36-4b5e-9c3a-6e0f2f1d2c3b",
          reachable: true,
          latencyMs: 1,
          errorCode: "SOMETHING_ELSE",
          error: null,
          telemetry: { ...telemetry(), cameraStreamUrl: "javascript:alert(1)", printProgress: 7, evil: "x" },
          extra: true,
        },
      ]),
    );
    const t = r.printers[0].telemetry as Record<string, unknown>;
    expect(t.cameraStreamUrl).toBeNull();
    expect(t.printProgress).toBeNull();
    expect(t.evil).toBeUndefined();
    expect(r.printers[0].errorCode).toBe("ERROR");
  });
  it("validates pairing and results", () => {
    expect(() => pairSchema.parse({ code: "x", version: "1", platform: "p", driver: "flashforge_lan" })).toThrow();
    expect(() => pairSchema.parse({ code: "ABCD-EFGH-JKLM", version: "1", platform: "p", driver: "shell" })).toThrow();
    expect(commandResultSchema.parse({ status: "failed", errorCode: "AUTH_FAILED", error: "no" }).errorCode).toBe("AUTH_FAILED");
    expect(() => commandResultSchema.parse({ status: "maybe" })).toThrow();
  });
});
