import "server-only";
import { decryptSecret, encryptSecret, sha256Hex } from "@/lib/integrations/crypto";
import { IntegrationError } from "@/lib/integrations/errors";
import { etsyRefresh, type TokenSet } from "@/lib/integrations/etsy/oauth";
import { ebayRefresh } from "@/lib/integrations/ebay/oauth";
import type { MarketplaceAuth } from "@/lib/integrations/marketplace/types";
import { OAUTH_STATE_TTL_MINUTES, createState } from "@/lib/integrations/oauth";
import type { IntegrationProvider } from "@/lib/integrations/registry";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import type { IntegrationConnection } from "./types";

/** Refresh access tokens this long before they expire. */
const REFRESH_SKEW_MS = 2 * 60 * 1000;
const LOCK_MS = 30 * 1000;

interface CredentialRow {
  connection_id: string;
  organization_id: string;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  api_key_encrypted: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  refresh_lock_until: string | null;
}

// ---------------------------------------------------------------- OAuth state

/** Stores a one-time OAuth state (hashed) and optional PKCE verifier (encrypted). */
export async function createOAuthState(orgId: string, userId: string, provider: IntegrationProvider, codeVerifier?: string) {
  const admin = createAdminClient();
  const state = createState();
  const { error } = await admin.from("oauth_states").insert({
    state_hash: sha256Hex(state),
    organization_id: orgId,
    user_id: userId,
    provider,
    code_verifier_encrypted: codeVerifier ? encryptSecret(codeVerifier) : null,
    expires_at: new Date(Date.now() + OAUTH_STATE_TTL_MINUTES * 60_000).toISOString(),
  });
  if (error) throw new Error(`Could not store OAuth state: ${error.message}`);
  // Opportunistic cleanup of old states.
  await admin.from("oauth_states").delete().lt("expires_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  return state;
}

export type OAuthStateResult =
  | { ok: true; orgId: string; codeVerifier: string | null }
  | { ok: false; reason: "missing" | "unknown" | "expired" | "used" | "wrong_user" | "wrong_provider" };

/**
 * Validates and consumes an OAuth state exactly once. The callback must come
 * from the same signed-in user who started the flow, for the same provider.
 */
export async function consumeOAuthState(state: string | null, userId: string, provider: IntegrationProvider): Promise<OAuthStateResult> {
  if (!state) return { ok: false, reason: "missing" };
  const admin = createAdminClient();
  const hash = sha256Hex(state);
  const { data: row } = await admin.from("oauth_states").select("*").eq("state_hash", hash).maybeSingle();
  if (!row) return { ok: false, reason: "unknown" };
  if (row.provider !== provider) return { ok: false, reason: "wrong_provider" };
  if (row.user_id !== userId) return { ok: false, reason: "wrong_user" };
  if (row.used_at) return { ok: false, reason: "used" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  // Atomic single use: only one request can flip used_at from null.
  const { data: claimed } = await admin
    .from("oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("state_hash", hash)
    .is("used_at", null)
    .select("organization_id, code_verifier_encrypted")
    .maybeSingle();
  if (!claimed) return { ok: false, reason: "used" };
  return {
    ok: true,
    orgId: claimed.organization_id,
    codeVerifier: claimed.code_verifier_encrypted ? decryptSecret(claimed.code_verifier_encrypted) : null,
  };
}

// ---------------------------------------------------------------- connections

export async function getConnection(orgId: string, provider: IntegrationProvider, admin: AdminClient = createAdminClient()) {
  const { data } = await admin.from("integration_connections").select("*").eq("organization_id", orgId).eq("provider", provider).maybeSingle();
  return (data as IntegrationConnection | null) ?? null;
}

export async function saveOAuthConnection(input: {
  orgId: string;
  userId: string;
  provider: "etsy" | "ebay";
  environment: "production" | "sandbox";
  tokens: TokenSet;
  account: { id: string; name: string | null };
}) {
  const admin = createAdminClient();
  const existing = await getConnection(input.orgId, input.provider, admin);
  const accountChanged = existing?.external_account_id && existing.external_account_id !== input.account.id;
  const { data: conn, error } = await admin
    .from("integration_connections")
    .upsert(
      {
        organization_id: input.orgId,
        provider: input.provider,
        kind: "marketplace",
        environment: input.environment,
        status: "connected",
        external_account_id: input.account.id,
        external_account_name: input.account.name,
        scopes: input.tokens.scopes,
        connected_by: input.userId,
        connected_at: new Date().toISOString(),
        last_error: null,
        // A different shop/account starts a fresh sync window.
        config: accountChanged ? {} : existing?.config ?? {},
      },
      { onConflict: "organization_id,provider" },
    )
    .select("*")
    .single();
  if (error || !conn) throw new Error(`Could not save connection: ${error?.message}`);
  await storeTokens(admin, conn.id, input.orgId, input.tokens);
  return conn as IntegrationConnection;
}

export async function saveApiKeyConnection(input: {
  orgId: string;
  userId: string;
  provider: "royal_mail_click_drop";
  apiKey: string;
  accountName: string | null;
  config: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { data: conn, error } = await admin
    .from("integration_connections")
    .upsert(
      {
        organization_id: input.orgId,
        provider: input.provider,
        kind: "shipping",
        environment: "production",
        status: "connected",
        external_account_name: input.accountName,
        connected_by: input.userId,
        connected_at: new Date().toISOString(),
        last_error: null,
        config: input.config,
      },
      { onConflict: "organization_id,provider" },
    )
    .select("*")
    .single();
  if (error || !conn) throw new Error(`Could not save connection: ${error?.message}`);
  const { error: credError } = await admin.from("integration_credentials").upsert({
    connection_id: conn.id,
    organization_id: input.orgId,
    api_key_encrypted: encryptSecret(input.apiKey),
    access_token_encrypted: null,
    refresh_token_encrypted: null,
  });
  if (credError) throw new Error(`Could not store credentials: ${credError.message}`);
  return conn as IntegrationConnection;
}

async function storeTokens(admin: AdminClient, connectionId: string, orgId: string, tokens: TokenSet) {
  const row: Record<string, unknown> = {
    connection_id: connectionId,
    organization_id: orgId,
    access_token_encrypted: encryptSecret(tokens.accessToken),
    access_token_expires_at: tokens.expiresAt.toISOString(),
    refresh_lock_until: null,
  };
  if (tokens.refreshToken) row.refresh_token_encrypted = encryptSecret(tokens.refreshToken);
  if (tokens.refreshExpiresAt) row.refresh_token_expires_at = tokens.refreshExpiresAt.toISOString();
  const { error } = await admin.from("integration_credentials").upsert(row);
  if (error) throw new Error(`Could not store tokens: ${error.message}`);
}

export async function markConnectionStatus(
  connectionId: string,
  patch: { status?: IntegrationConnection["status"]; last_error?: string | null; last_failure_at?: string; last_success_at?: string; last_sync_at?: string; config?: Record<string, unknown> },
) {
  const admin = createAdminClient();
  await admin.from("integration_connections").update(patch).eq("id", connectionId);
}

export async function disconnect(orgId: string, provider: IntegrationProvider) {
  const admin = createAdminClient();
  const conn = await getConnection(orgId, provider, admin);
  if (!conn) return null;
  await admin.from("integration_credentials").delete().eq("connection_id", conn.id);
  await admin.from("integration_connections").update({ status: "disconnected", last_error: null }).eq("id", conn.id);
  return conn;
}

export async function getApiKey(connectionId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("integration_credentials").select("api_key_encrypted").eq("connection_id", connectionId).maybeSingle();
  if (!data?.api_key_encrypted) throw new IntegrationError("auth_required", "No API key stored for this connection.");
  return decryptSecret(data.api_key_encrypted);
}

// ---------------------------------------------------------------- tokens

type Refresher = (refreshToken: string) => Promise<TokenSet>;
const REFRESHERS: Record<"etsy" | "ebay", Refresher> = { etsy: (t) => etsyRefresh(t), ebay: (t) => ebayRefresh(t) };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns a MarketplaceAuth that hands out a valid access token, refreshing
 * (under a short database lease, so concurrent requests never both rotate the
 * refresh token) when it is about to expire.
 */
export function marketplaceAuth(conn: IntegrationConnection, deps: { refresher?: Refresher; admin?: AdminClient } = {}): MarketplaceAuth {
  if (conn.provider !== "etsy" && conn.provider !== "ebay") throw new Error("Not a marketplace connection");
  if (!conn.external_account_id) throw new IntegrationError("auth_required", "Connection has no account id.");
  const provider = conn.provider;
  const admin = deps.admin ?? createAdminClient();
  const refresher = deps.refresher ?? REFRESHERS[provider];
  let cached: { token: string; expiresAt: number } | null = null;

  async function load(): Promise<CredentialRow> {
    const { data } = await admin.from("integration_credentials").select("*").eq("connection_id", conn.id).maybeSingle();
    if (!data?.access_token_encrypted) {
      await markConnectionStatus(conn.id, { status: "auth_required", last_error: "No stored credentials. Reconnect." });
      throw new IntegrationError("auth_required", "No stored credentials. Reconnect the account.");
    }
    return data as CredentialRow;
  }

  async function refresh(force: boolean): Promise<string> {
    // When forced (after a 401), the token that was rejected must never be handed out again.
    const rejected = force ? cached?.token ?? null : null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const row = await load();
      const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
      const current = decryptSecret(row.access_token_encrypted!);
      const usable = expiresAt - Date.now() > REFRESH_SKEW_MS && (!force || (rejected !== null && current !== rejected));
      if (usable) {
        cached = { token: current, expiresAt };
        return cached.token;
      }
      if (!row.refresh_token_encrypted) {
        await markConnectionStatus(conn.id, { status: "auth_required", last_error: "Access expired and no refresh token is stored. Reconnect." });
        throw new IntegrationError("auth_required", "Access expired. Reconnect the account.");
      }
      if (row.refresh_token_expires_at && new Date(row.refresh_token_expires_at).getTime() < Date.now()) {
        await markConnectionStatus(conn.id, { status: "auth_required", last_error: "Refresh token expired. Reconnect." });
        throw new IntegrationError("auth_required", "Authorization expired. Reconnect the account.");
      }
      const leaseUntil = new Date(Date.now() + LOCK_MS).toISOString();
      // Take the lease if it's free or expired (two simple conditional updates; only one caller can win).
      const takeLease = (expired: boolean) => {
        const q = admin.from("integration_credentials").update({ refresh_lock_until: leaseUntil }).eq("connection_id", conn.id);
        return (expired ? q.lt("refresh_lock_until", new Date().toISOString()) : q.is("refresh_lock_until", null)).select("connection_id").maybeSingle();
      };
      const lease = (await takeLease(false)).data ?? (await takeLease(true)).data;
      if (!lease) {
        // Someone else is refreshing; wait and re-read (a new token will differ from the rejected one).
        await sleep(750);
        continue;
      }
      try {
        const tokens = await refresher(decryptSecret(row.refresh_token_encrypted));
        await storeTokens(admin, conn.id, conn.organization_id, tokens);
        cached = { token: tokens.accessToken, expiresAt: tokens.expiresAt.getTime() };
        if (conn.status !== "connected") await markConnectionStatus(conn.id, { status: "connected", last_error: null });
        return tokens.accessToken;
      } catch (e) {
        await admin.from("integration_credentials").update({ refresh_lock_until: null }).eq("connection_id", conn.id);
        if (e instanceof IntegrationError && e.kind === "auth_required") {
          await markConnectionStatus(conn.id, { status: "auth_required", last_error: "The marketplace rejected the stored authorization. Reconnect.", last_failure_at: new Date().toISOString() });
        }
        throw e;
      }
    }
    throw new IntegrationError("timeout", "Timed out waiting for a token refresh in progress.");
  }

  return {
    accountId: conn.external_account_id,
    async getAccessToken() {
      if (cached && cached.expiresAt - Date.now() > REFRESH_SKEW_MS) return cached.token;
      return refresh(false);
    },
    refreshAccessToken() {
      return refresh(true);
    },
  };
}
