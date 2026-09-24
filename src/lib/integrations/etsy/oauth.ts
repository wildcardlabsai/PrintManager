import { etsyConfig } from "../config";
import { IntegrationError } from "../errors";
import { requestJson } from "../http";

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  refreshExpiresAt: Date | null;
  scopes: string[];
}

/** Etsy refresh tokens are valid for 90 days. */
const ETSY_REFRESH_TTL_MS = 90 * 24 * 3600 * 1000;

export function etsyAuthorizeUrl(state: string, codeChallenge: string) {
  const c = etsyConfig();
  const u = new URL(c.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", c.redirectUri);
  u.searchParams.set("scope", c.scopes.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

interface EtsyTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
}

function toTokenSet(data: EtsyTokenResponse, now = Date.now()): TokenSet {
  if (!data?.access_token || !data.expires_in) {
    throw new IntegrationError("invalid_response", "Etsy did not return an access token", { provider: "Etsy" });
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(now + data.expires_in * 1000),
    refreshExpiresAt: data.refresh_token ? new Date(now + ETSY_REFRESH_TTL_MS) : null,
    scopes: etsyConfig().scopes,
  };
}

export async function etsyExchangeCode(code: string, codeVerifier: string, fetchImpl?: typeof fetch): Promise<TokenSet> {
  const c = etsyConfig();
  const { data } = await requestJson<EtsyTokenResponse>(c.tokenUrl, {
    provider: "Etsy",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: c.clientId,
      redirect_uri: c.redirectUri,
      code,
      code_verifier: codeVerifier,
    }).toString(),
    retries: 1,
    fetchImpl,
  });
  return toTokenSet(data);
}

export async function etsyRefresh(refreshToken: string, fetchImpl?: typeof fetch): Promise<TokenSet> {
  const c = etsyConfig();
  try {
    const { data } = await requestJson<EtsyTokenResponse>(c.tokenUrl, {
      provider: "Etsy",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: c.clientId, refresh_token: refreshToken }).toString(),
      retries: 2,
      fetchImpl,
    });
    return toTokenSet(data);
  } catch (e) {
    // A rejected refresh token (400 invalid_grant) means the seller must reconnect.
    if (e instanceof IntegrationError && e.details.status && e.details.status >= 400 && e.details.status < 500) {
      throw new IntegrationError("auth_required", "Etsy refresh token was rejected", e.details);
    }
    throw e;
  }
}
