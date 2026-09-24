import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codeChallengeS256, createCodeVerifier, createState } from "@/lib/integrations/oauth";
import { etsyAuthorizeUrl, etsyExchangeCode, etsyRefresh } from "@/lib/integrations/etsy/oauth";
import { ebayAuthorizeUrl, ebayExchangeCode, ebayRefresh } from "@/lib/integrations/ebay/oauth";
import { IntegrationError } from "@/lib/integrations/errors";

const ENV = { ...process.env };
beforeEach(() => {
  Object.assign(process.env, {
    ETSY_CLIENT_ID: "etsy-key",
    ETSY_CLIENT_SECRET: "etsy-secret",
    ETSY_REDIRECT_URI: "https://app.example.com/api/integrations/etsy/callback",
    EBAY_CLIENT_ID: "ebay-id",
    EBAY_CLIENT_SECRET: "ebay-secret",
    EBAY_REDIRECT_URI: "Printflow-Printflo-SBX-abc",
    EBAY_ENVIRONMENT: "sandbox",
  });
});
afterEach(() => {
  process.env = { ...ENV };
});

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("PKCE and state", () => {
  it("matches the RFC 7636 appendix B test vector", () => {
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("creates verifiers of legal length and unguessable states", () => {
    const v = createCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(createState()).not.toBe(createState());
  });
});

describe("Etsy OAuth", () => {
  it("builds the authorize URL with PKCE S256, state and scopes", () => {
    const u = new URL(etsyAuthorizeUrl("st4te", "chall"));
    expect(u.origin + u.pathname).toBe("https://www.etsy.com/oauth/connect");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("etsy-key");
    expect(u.searchParams.get("state")).toBe("st4te");
    expect(u.searchParams.get("code_challenge")).toBe("chall");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toContain("transactions_r");
    expect(u.searchParams.get("scope")).toContain("transactions_w");
  });

  it("exchanges the code with the verifier and computes expiry", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: { access_token: "123.abc", refresh_token: "123.ref", expires_in: 3600, token_type: "Bearer" } }));
    const t = await etsyExchangeCode("the-code", "the-verifier", f);
    expect(calls[0].url).toBe("https://api.etsy.com/v3/public/oauth/token");
    const body = new URLSearchParams(String(calls[0].init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("the-verifier");
    expect(body.get("redirect_uri")).toBe(process.env.ETSY_REDIRECT_URI);
    expect(t.accessToken).toBe("123.abc");
    expect(t.expiresAt.getTime() - Date.now()).toBeGreaterThan(3500_000);
    expect(t.refreshExpiresAt!.getTime() - Date.now()).toBeGreaterThan(89 * 86400_000);
  });

  it("maps a rejected refresh token to auth_required", async () => {
    const { f } = fakeFetch(() => ({ status: 400, body: { error: "invalid_grant", error_description: "refresh token expired" } }));
    await expect(etsyRefresh("old", f)).rejects.toMatchObject({ kind: "auth_required" });
  });

  it("rejects a token response without an access token", async () => {
    const { f } = fakeFetch(() => ({ status: 200, body: { token_type: "Bearer" } }));
    await expect(etsyExchangeCode("c", "v", f)).rejects.toBeInstanceOf(IntegrationError);
  });
});

describe("eBay OAuth", () => {
  it("uses the sandbox authorize endpoint and RuName as redirect_uri", () => {
    const u = new URL(ebayAuthorizeUrl("xyz"));
    expect(u.origin).toBe("https://auth.sandbox.ebay.com");
    expect(u.searchParams.get("redirect_uri")).toBe("Printflow-Printflo-SBX-abc");
    expect(u.searchParams.get("scope")).toContain("https://api.ebay.com/oauth/api_scope/sell.fulfillment");
    expect(u.searchParams.get("state")).toBe("xyz");
  });

  it("exchanges the code with HTTP Basic client authentication", async () => {
    const { f, calls } = fakeFetch(() => ({
      status: 200,
      body: { access_token: "v^1.1#at", expires_in: 7200, refresh_token: "v^1.1#rt", refresh_token_expires_in: 47304000 },
    }));
    const t = await ebayExchangeCode("code", f);
    expect(calls[0].url).toBe("https://api.sandbox.ebay.com/identity/v1/oauth2/token");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("ebay-id:ebay-secret").toString("base64")}`);
    expect(t.refreshExpiresAt!.getTime() - Date.now()).toBeGreaterThan(500 * 86400_000);
  });

  it("keeps the existing refresh token after a refresh (eBay does not rotate it)", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: { access_token: "new", expires_in: 7200 } }));
    const t = await ebayRefresh("keep-me", f);
    expect(t.refreshToken).toBe("keep-me");
    expect(new URLSearchParams(String(calls[0].init.body)).get("grant_type")).toBe("refresh_token");
  });
});
