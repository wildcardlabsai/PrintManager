import "server-only";
import { describeIntegrationError, IntegrationError } from "@/lib/integrations/errors";
import { MARKETPLACES, PROVIDER_NAMES, type MarketplaceProvider } from "@/lib/integrations/registry";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppContext } from "../context";
import { markConnectionStatus, marketplaceAuth } from "./credentials";
import { loadImportCatalog, processNormalizedOrder } from "./import";
import { emptyCounters, finishSyncLog, startSyncLog } from "./sync-log";
import type { IntegrationConnection, SyncLog } from "./types";

/** First sync looks back this far. */
export const DEFAULT_INITIAL_DAYS = 30;
/** Each sync re-reads a small overlap so nothing modified mid-sync is missed. */
const CURSOR_OVERLAP_MS = 15 * 60 * 1000;
/** A sync marked running for longer than this is considered dead. */
const STALE_RUN_MS = 10 * 60 * 1000;

export interface SyncSummary {
  logId: string | null;
  status: SyncLog["status"] | "skipped";
  found: number;
  created: number;
  updated: number;
  skipped: number;
  mappingRequired: number;
  errors: number;
  message: string;
}

export function syncWindowStart(conn: Pick<IntegrationConnection, "config">, now = Date.now()) {
  const cursor = typeof conn.config?.sync_cursor === "string" ? Date.parse(conn.config.sync_cursor) : NaN;
  if (Number.isFinite(cursor)) return new Date(cursor - CURSOR_OVERLAP_MS);
  const days = Number(conn.config?.initial_days) > 0 ? Number(conn.config.initial_days) : DEFAULT_INITIAL_DAYS;
  return new Date(now - days * 86400_000);
}

/**
 * Pulls orders modified since the last cursor and runs each through the shared
 * import pipeline. Safe to run repeatedly: imports are idempotent.
 */
export async function runMarketplaceSync(ctx: AppContext, conn: IntegrationConnection, trigger: SyncLog["trigger"]): Promise<SyncSummary> {
  const provider = conn.provider as MarketplaceProvider;
  const name = PROVIDER_NAMES[provider];
  const adapter = MARKETPLACES[provider];
  const admin = createAdminClient();

  if (conn.status === "disconnected") {
    return { logId: null, status: "skipped", found: 0, created: 0, updated: 0, skipped: 0, mappingRequired: 0, errors: 0, message: `${name} is not connected.` };
  }

  // One sync per connection at a time.
  const { data: running } = await admin
    .from("integration_sync_logs")
    .select("id, started_at")
    .eq("connection_id", conn.id)
    .eq("operation", "order_sync")
    .eq("status", "running")
    .gt("started_at", new Date(Date.now() - STALE_RUN_MS).toISOString())
    .limit(1)
    .maybeSingle();
  if (running) {
    return { logId: running.id, status: "skipped", found: 0, created: 0, updated: 0, skipped: 0, mappingRequired: 0, errors: 0, message: `A ${name} sync is already running.` };
  }

  const startedAt = new Date();
  const since = syncWindowStart(conn, startedAt.getTime());
  const logId = await startSyncLog(ctx, { connectionId: conn.id, provider, operation: "order_sync", trigger, metadata: { since: since.toISOString() } });
  const c = emptyCounters();
  let mappingRequired = 0;

  try {
    const auth = marketplaceAuth(conn, { admin });
    const { orders, truncated } = await adapter.listOrdersSince(auth, since);
    const catalog = await loadImportCatalog(ctx, provider);
    let maxUpdated = 0;
    for (const order of orders) {
      c.processed++;
      try {
        const res = await processNormalizedOrder(ctx, conn, order, catalog);
        if (res.outcome === "created") c.created++;
        else if (res.outcome === "updated") c.updated++;
        else {
          c.skipped++;
          if (res.outcome === "skipped" && res.importStatus === "mapping_required") mappingRequired++;
        }
      } catch (e) {
        c.errors.push({ ref: order.externalOrderId, message: describeIntegrationError(e, name) });
      }
      const u = order.updatedAt ? Date.parse(order.updatedAt) : NaN;
      if (Number.isFinite(u)) maxUpdated = Math.max(maxUpdated, u);
    }
    // Advance the cursor. If the page limit truncated the run, continue from the newest order seen.
    const cursor = truncated && maxUpdated ? new Date(maxUpdated) : startedAt;
    const status = await finishSyncLog(ctx, logId, c, { metadata: { since: since.toISOString(), truncated, mapping_required: mappingRequired } });
    const nowIso = new Date().toISOString();
    await markConnectionStatus(conn.id, {
      status: "connected",
      last_sync_at: nowIso,
      ...(c.errors.length ? { last_failure_at: nowIso, last_error: c.errors[0].message } : { last_success_at: nowIso, last_error: null }),
      config: { ...conn.config, sync_cursor: cursor.toISOString() },
    });
    return {
      logId,
      status: status ?? "success",
      found: orders.length,
      created: c.created,
      updated: c.updated,
      skipped: c.skipped,
      mappingRequired,
      errors: c.errors.length,
      message: `${name}: ${orders.length} found, ${c.created} created, ${c.updated} updated, ${c.skipped} skipped${c.errors.length ? `, ${c.errors.length} errors` : ""}.`,
    };
  } catch (e) {
    const message = describeIntegrationError(e, name);
    await finishSyncLog(ctx, logId, c, { fatal: message });
    const authProblem = e instanceof IntegrationError && e.kind === "auth_required";
    const restricted = e instanceof IntegrationError && e.kind === "forbidden";
    await markConnectionStatus(conn.id, {
      status: authProblem ? "auth_required" : restricted ? "restricted" : "error",
      last_sync_at: new Date().toISOString(),
      last_failure_at: new Date().toISOString(),
      last_error: message,
    });
    return { logId, status: "failed", found: 0, created: c.created, updated: c.updated, skipped: c.skipped, mappingRequired, errors: c.errors.length + 1, message };
  }
}
