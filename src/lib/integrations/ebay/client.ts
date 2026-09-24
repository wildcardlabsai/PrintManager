import { ebayConfig } from "../config";
import { IntegrationError } from "../errors";
import { requestJson, type RequestOptions } from "../http";
import type { MarketplaceAuth } from "../marketplace/types";

export async function ebayRequest<T>(
  auth: Pick<MarketplaceAuth, "getAccessToken" | "refreshAccessToken">,
  url: string,
  init: Omit<RequestOptions, "provider"> = {},
): Promise<{ data: T; response: Response }> {
  const call = async (token: string) =>
    requestJson<T>(url, {
      provider: "eBay",
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.headers ?? {}) },
    });
  try {
    return await call(await auth.getAccessToken());
  } catch (e) {
    if (e instanceof IntegrationError && e.kind === "auth_required") return call(await auth.refreshAccessToken());
    throw e;
  }
}

/** Commerce Identity API: the connected seller's user id and username. */
export async function ebayGetUser(token: string, fetchImpl?: typeof fetch) {
  const c = ebayConfig();
  const { data } = await requestJson<{ userId?: string; username?: string }>(`${c.identityBase}/commerce/identity/v1/user/`, {
    provider: "eBay",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    fetchImpl,
  });
  if (!data?.userId) throw new IntegrationError("invalid_response", "eBay did not return the seller account", { provider: "eBay" });
  return { userId: data.userId, username: data.username ?? null };
}
