import "server-only";
import { ebayConfig, ebayMissingConfig, etsyMissingConfig, platformMissingConfig } from "@/lib/integrations/config";
import type { AppContext } from "../context";
import { check } from "../errors";
import { resolveUserNames } from "../orders";
import { pageRange, paginated } from "../query";
import type { IntegrationConnection, SyncLog } from "./types";

/** Connection metadata for the Settings UI (no secrets — those live in integration_credentials). */
export async function listConnections(ctx: AppContext) {
  const rows = check(
    await ctx.supabase.from("integration_connections").select("*").eq("organization_id", ctx.orgId),
  ) as IntegrationConnection[];
  return Object.fromEntries(rows.map((r) => [r.provider, r])) as Partial<Record<IntegrationConnection["provider"], IntegrationConnection>>;
}

export function integrationSetup() {
  const platform = platformMissingConfig();
  return {
    platformMissing: platform,
    etsyMissing: [...platform, ...etsyMissingConfig()],
    ebayMissing: [...platform, ...ebayMissingConfig()],
    ebayEnvironment: ebayConfig().environment,
    etsyWebhookConfigured: Boolean(process.env.ETSY_WEBHOOK_SECRET),
    ebayDeletionConfigured: Boolean(process.env.EBAY_DELETION_VERIFICATION_TOKEN && process.env.EBAY_DELETION_ENDPOINT_URL),
    cronConfigured: Boolean(process.env.CRON_SECRET),
  };
}

export async function listSyncLogs(ctx: AppContext, opts: { page?: number; provider?: string | null } = {}) {
  const { page, from, to } = pageRange(opts.page ?? 1, 50);
  let q = ctx.supabase
    .from("integration_sync_logs")
    .select("*", { count: "exact" })
    .eq("organization_id", ctx.orgId)
    .order("started_at", { ascending: false })
    .range(from, to);
  if (opts.provider) q = q.eq("provider", opts.provider);
  const { data, count, error } = await q;
  if (error) check({ data, error });
  const rows = (data ?? []) as SyncLog[];
  const names = await resolveUserNames(ctx, rows.map((r) => r.initiated_by));
  return paginated(
    rows.map((r) => ({ ...r, initiated_by_name: r.initiated_by ? names.get(r.initiated_by) ?? null : null })),
    count,
    page,
    50,
  );
}
