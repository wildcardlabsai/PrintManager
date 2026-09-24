import { etsyConfig } from "../config";
import { IntegrationError } from "../errors";
import { requestJson, type RequestOptions } from "../http";
import type { MarketplaceAuth } from "../marketplace/types";

/**
 * Minimal Etsy Open API v3 client. Every call sends x-api-key
 * ("keystring:shared_secret") and the seller's OAuth bearer token, and retries
 * exactly once with a refreshed token after a 401.
 */
export async function etsyRequest<T>(
  auth: Pick<MarketplaceAuth, "getAccessToken" | "refreshAccessToken">,
  path: string,
  init: Omit<RequestOptions, "provider"> = {},
): Promise<T> {
  const c = etsyConfig();
  const call = async (token: string) =>
    (
      await requestJson<T>(`${c.apiBase}${path}`, {
        provider: "Etsy",
        ...init,
        headers: {
          "x-api-key": `${c.clientId}:${c.clientSecret}`,
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
      })
    ).data;
  try {
    return await call(await auth.getAccessToken());
  } catch (e) {
    if (e instanceof IntegrationError && e.kind === "auth_required") {
      return call(await auth.refreshAccessToken());
    }
    throw e;
  }
}

/** Calls made during OAuth, before an auth provider exists. */
export async function etsyRequestWithToken<T>(token: string, path: string, fetchImpl?: typeof fetch): Promise<T> {
  const c = etsyConfig();
  return (
    await requestJson<T>(`${c.apiBase}${path}`, {
      provider: "Etsy",
      headers: { "x-api-key": `${c.clientId}:${c.clientSecret}`, Authorization: `Bearer ${token}`, Accept: "application/json" },
      fetchImpl,
    })
  ).data;
}
