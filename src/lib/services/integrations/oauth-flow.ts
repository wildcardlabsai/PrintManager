import "server-only";
import { ebayConfig, ebayMissingConfig, etsyMissingConfig, platformMissingConfig } from "@/lib/integrations/config";
import { describeIntegrationError } from "@/lib/integrations/errors";
import { ebayGetUser } from "@/lib/integrations/ebay/client";
import { ebayAuthorizeUrl, ebayExchangeCode } from "@/lib/integrations/ebay/oauth";
import { etsyRequestWithToken } from "@/lib/integrations/etsy/client";
import { etsyAuthorizeUrl, etsyExchangeCode } from "@/lib/integrations/etsy/oauth";
import { codeChallengeS256, createCodeVerifier } from "@/lib/integrations/oauth";
import type { MarketplaceProvider } from "@/lib/integrations/registry";
import { logAudit } from "../audit";
import type { AppContext } from "../context";
import { AppError } from "../errors";
import { consumeOAuthState, createOAuthState, saveOAuthConnection } from "./credentials";
import { emptyCounters, finishSyncLog, startSyncLog } from "./sync-log";

export function missingConfigFor(provider: MarketplaceProvider) {
  return [...platformMissingConfig(), ...(provider === "etsy" ? etsyMissingConfig() : ebayMissingConfig())];
}

/** Starts OAuth: stores a single-use state (+ PKCE verifier for Etsy) and returns the provider URL. */
export async function beginOAuth(ctx: AppContext, provider: MarketplaceProvider) {
  const missing = missingConfigFor(provider);
  if (missing.length) throw new AppError(`Missing server configuration: ${missing.join(", ")}`, "validation");
  if (!ctx.userId) throw new AppError("Sign in to connect an account.", "unauthenticated");
  if (provider === "etsy") {
    const verifier = createCodeVerifier();
    const state = await createOAuthState(ctx.orgId, ctx.userId, "etsy", verifier);
    return etsyAuthorizeUrl(state, codeChallengeS256(verifier));
  }
  const state = await createOAuthState(ctx.orgId, ctx.userId, "ebay");
  return ebayAuthorizeUrl(state);
}

const STATE_ERRORS: Record<string, string> = {
  missing: "The authorization response had no state parameter.",
  unknown: "This authorization link is not recognised. Start the connection again.",
  expired: "The authorization took too long. Start the connection again.",
  used: "This authorization response was already used.",
  wrong_user: "The authorization was started by a different user.",
  wrong_provider: "The authorization response was for a different integration.",
};

/** Completes OAuth: validates state, exchanges the code, identifies the account, stores encrypted tokens. */
export async function completeOAuth(ctx: AppContext, provider: MarketplaceProvider, params: URLSearchParams) {
  const name = provider === "etsy" ? "Etsy" : "eBay";
  if (!ctx.userId) throw new AppError("Sign in to finish connecting.", "unauthenticated");
  const providerError = params.get("error");
  // Validate state even on errors so a forged redirect can't be replayed.
  const state = await consumeOAuthState(params.get("state"), ctx.userId, provider);
  if (!state.ok) throw new AppError(STATE_ERRORS[state.reason], "validation");
  if (state.orgId !== ctx.orgId) throw new AppError("The authorization belongs to a different business.", "forbidden");
  if (providerError) {
    throw new AppError(
      providerError === "access_denied" ? `${name} access was declined.` : `${name} returned an error: ${params.get("error_description") ?? providerError}`,
      "validation",
    );
  }
  const code = params.get("code");
  if (!code) throw new AppError(`${name} did not return an authorization code.`, "validation");

  const logId = await startSyncLog(ctx, { connectionId: null, provider, operation: "connect", trigger: "manual" });
  const counters = emptyCounters();
  try {
    let conn;
    if (provider === "etsy") {
      if (!state.codeVerifier) throw new AppError("Missing PKCE verifier.", "validation");
      const tokens = await etsyExchangeCode(code, state.codeVerifier);
      const me = await etsyRequestWithToken<{ user_id?: number; shop_id?: number }>(tokens.accessToken, "/v3/application/users/me");
      if (!me?.shop_id) throw new AppError("This Etsy account has no shop. Connect the account that owns your shop.", "validation");
      const shop = await etsyRequestWithToken<{ shop_id?: number; shop_name?: string }>(tokens.accessToken, `/v3/application/shops/${me.shop_id}`);
      conn = await saveOAuthConnection({
        orgId: ctx.orgId,
        userId: ctx.userId,
        provider: "etsy",
        environment: "production",
        tokens,
        account: { id: String(me.shop_id), name: shop?.shop_name ?? null },
      });
    } else {
      const tokens = await ebayExchangeCode(code);
      const user = await ebayGetUser(tokens.accessToken);
      conn = await saveOAuthConnection({
        orgId: ctx.orgId,
        userId: ctx.userId,
        provider: "ebay",
        environment: ebayConfig().environment,
        tokens,
        account: { id: user.userId, name: user.username },
      });
    }
    await ctx.supabase.from("integration_sync_logs").update({ connection_id: conn.id }).eq("id", logId ?? "");
    counters.processed = 1;
    counters.created = 1;
    await finishSyncLog(ctx, logId, counters, { metadata: { account: conn.external_account_name ?? conn.external_account_id } });
    await logAudit(ctx, "settings.updated", { type: "integration", id: conn.id }, `${name} connected (${conn.external_account_name ?? conn.external_account_id})`, {
      provider,
    });
    return conn;
  } catch (e) {
    const message = e instanceof AppError ? e.message : describeIntegrationError(e, name);
    await finishSyncLog(ctx, logId, counters, { fatal: message });
    throw new AppError(message, "validation");
  }
}
