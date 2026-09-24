import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_AUTOMATIC_ATTEMPTS, nextRetryDelayMinutes, pushOrderFulfillment } from "./fulfillment";
import { runMarketplaceSync } from "./sync";
import { systemContext } from "./system";
import type { IntegrationConnection, MarketplaceFulfillment } from "./types";

/**
 * Scheduled work: incremental order sync for every connected marketplace, and
 * retries (with exponential backoff) of fulfilment updates that failed.
 */
export async function runScheduledIntegrationWork() {
  const admin = createAdminClient();
  const summary = { syncs: [] as { connection: string; message: string }[], fulfillmentRetries: 0, fulfillmentSynced: 0 };

  const { data: conns } = await admin
    .from("integration_connections")
    .select("*")
    .eq("kind", "marketplace")
    .in("status", ["connected", "error"]);
  for (const conn of (conns ?? []) as IntegrationConnection[]) {
    try {
      const ctx = await systemContext(conn.organization_id);
      const res = await runMarketplaceSync(ctx, conn, "schedule");
      summary.syncs.push({ connection: conn.id, message: res.message });
    } catch (e) {
      summary.syncs.push({ connection: conn.id, message: e instanceof Error ? e.message : "failed" });
    }
  }

  const { data: failed } = await admin
    .from("marketplace_fulfillments")
    .select("id, organization_id, order_id, attempts, last_attempt_at, status")
    .eq("status", "failed")
    .lt("attempts", MAX_AUTOMATIC_ATTEMPTS)
    .limit(50);
  for (const f of (failed ?? []) as (MarketplaceFulfillment & { organization_id: string })[]) {
    const due = !f.last_attempt_at || Date.now() - Date.parse(f.last_attempt_at) >= nextRetryDelayMinutes(f.attempts) * 60_000;
    if (!due) continue;
    summary.fulfillmentRetries++;
    try {
      const ctx = await systemContext(f.organization_id);
      const res = await pushOrderFulfillment(ctx, f.order_id, "schedule");
      if (res.status === "synced") summary.fulfillmentSynced++;
    } catch (e) {
      console.error("[scheduler] fulfilment retry", e);
    }
  }

  await admin.from("oauth_states").delete().lt("expires_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  return summary;
}
