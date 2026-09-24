import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import { requestJson } from "@/lib/integrations/http";

describe("secret encryption", () => {
  const prev = process.env.INTEGRATION_ENCRYPTION_KEY;
  afterEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = prev;
  });
  it("round-trips and detects tampering", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const enc = encryptSecret("refresh-token-value");
    expect(enc).not.toContain("refresh-token-value");
    expect(decryptSecret(enc)).toBe("refresh-token-value");
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
  it("refuses weak keys", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.from("short").toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});

describe("requestJson retry/backoff", () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  const seq = (responses: (() => Response | Promise<Response>)[]) => {
    let i = 0;
    return (async () => responses[Math.min(i++, responses.length - 1)]()) as unknown as typeof fetch;
  };

  it("honours Retry-After on 429 then succeeds", async () => {
    sleeps.length = 0;
    const f = seq([
      () => new Response("{}", { status: 429, headers: { "retry-after": "2" } }),
      () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    ]);
    const { data } = await requestJson<{ ok: number }>("https://x", { provider: "T", fetchImpl: f, sleep });
    expect(data.ok).toBe(1);
    expect(sleeps).toEqual([2000]);
  });

  it("backs off exponentially on 5xx and gives up with a typed error", async () => {
    sleeps.length = 0;
    const f = seq([() => new Response('{"error":"boom"}', { status: 503 })]);
    await expect(requestJson("https://x", { provider: "T", fetchImpl: f, sleep, retries: 3, backoffMs: 100 })).rejects.toMatchObject({ kind: "api_error" });
    expect(sleeps).toEqual([100, 200, 400]);
  });

  it("never retries 4xx and classifies 401/403", async () => {
    sleeps.length = 0;
    await expect(requestJson("https://x", { provider: "T", fetchImpl: seq([() => new Response("{}", { status: 401 })]), sleep })).rejects.toMatchObject({
      kind: "auth_required",
    });
    await expect(requestJson("https://x", { provider: "T", fetchImpl: seq([() => new Response("{}", { status: 403 })]), sleep })).rejects.toMatchObject({
      kind: "forbidden",
    });
    expect(sleeps).toEqual([]);
  });

  it("times out slow requests", async () => {
    const slow = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch;
    await expect(requestJson("https://x", { provider: "T", fetchImpl: slow, timeoutMs: 20, retries: 0 })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("rejects invalid JSON bodies", async () => {
    await expect(requestJson("https://x", { provider: "T", fetchImpl: seq([() => new Response("<html>", { status: 200 })]) })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
});
