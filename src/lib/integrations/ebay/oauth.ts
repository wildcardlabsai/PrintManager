import { ebayConfig } from "../config";
import { IntegrationError } from "../errors";
import { requestJson } from "../http";
import type { TokenSet } from "../etsy/oauth";

interface EbayTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type?: string;
}

function basicAuth() {
  const c = ebayConfig();
  return `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;
}

export function ebayAuthorizeUrl(state: string) {
  const c = ebayConfig();
  const u = new URL(c.authorizeUrl);
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", c.ruName);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", c.scopes.join(" "));
  u.searchParams.set("state", state);
  return u.toString();
}

function toTokenSet(data: EbayTokenResponse, previousRefresh: string | null = null, now = Date.now()): TokenSet {
  if (!data?.access_token || !data.expires_in) {
    throw new IntegrationError("invalid_response", "eBay did not return an access token", { provider: "eBay" });
  }
  return {
    accessToken: data.access_token,
    // Refreshing does not issue a new refresh token; keep the existing one.
    refreshToken: data.refresh_token ?? previousRefresh,
    expiresAt: new Date(now + data.expires_in * 1000),
    refreshExpiresAt: data.refresh_token_expires_in ? new Date(now + data.refresh_token_expires_in * 1000) : null,
    scopes: ebayConfig().scopes,
  };
}

export async function ebayExchangeCode(code: string, fetchImpl?: typeof fetch): Promise<TokenSet> {
  const c = ebayConfig();
  const { data } = await requestJson<EbayTokenResponse>(c.tokenUrl, {
    provider: "eBay",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth() },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: c.ruName }).toString(),
    retries: 1,
    fetchImpl,
  });
  return toTokenSet(data);
}

export async function ebayRefresh(refreshToken: string, fetchImpl?: typeof fetch): Promise<TokenSet> {
  const c = ebayConfig();
  try {
    const { data } = await requestJson<EbayTokenResponse>(c.tokenUrl, {
      provider: "eBay",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth() },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, scope: c.scopes.join(" ") }).toString(),
      retries: 2,
      fetchImpl,
    });
    const set = toTokenSet(data, refreshToken);
    set.refreshExpiresAt = null; // unchanged; caller keeps the stored expiry
    return set;
  } catch (e) {
    if (e instanceof IntegrationError && e.details.status && e.details.status >= 400 && e.details.status < 500) {
      throw new IntegrationError("auth_required", "eBay refresh token was rejected", e.details);
    }
    throw e;
  }
}

/** Application token (client credentials) — used only to fetch notification public keys. */
export async function ebayApplicationToken(fetchImpl?: typeof fetch): Promise<string> {
  const c = ebayConfig();
  const { data } = await requestJson<EbayTokenResponse>(c.tokenUrl, {
    provider: "eBay",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth() },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }).toString(),
    fetchImpl,
  });
  if (!data?.access_token) throw new IntegrationError("invalid_response", "eBay did not return an application token", { provider: "eBay" });
  return data.access_token;
}
