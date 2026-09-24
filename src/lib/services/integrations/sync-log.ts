import "server-only";
import type { AppContext } from "../context";
import type { SyncLog } from "./types";

export interface SyncCounters {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { ref?: string; message: string }[];
}

export const emptyCounters = (): SyncCounters => ({ processed: 0, created: 0, updated: 0, skipped: 0, errors: [] });

export async function startSyncLog(
  ctx: AppContext,
  input: { connectionId: string | null; provider: string; operation: string; trigger: SyncLog["trigger"]; metadata?: Record<string, unknown> },
) {
  const { data, error } = await ctx.supabase
    .from("integration_sync_logs")
    .insert({
      organization_id: ctx.orgId,
      connection_id: input.connectionId,
      provider: input.provider,
      operation: input.operation,
      trigger: input.trigger,
      status: "running",
      metadata: input.metadata ?? {},
      initiated_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) console.error("[sync-log] could not start", error);
  return (data?.id as string | undefined) ?? null;
}

export async function finishSyncLog(ctx: AppContext, id: string | null, c: SyncCounters, extra: { fatal?: string; metadata?: Record<string, unknown> } = {}) {
  if (!id) return;
  const status: SyncLog["status"] = extra.fatal ? "failed" : c.errors.length ? (c.created + c.updated > 0 ? "partial" : c.processed > c.errors.length ? "partial" : "failed") : "success";
  const { error } = await ctx.supabase
    .from("integration_sync_logs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      records_processed: c.processed,
      records_created: c.created,
      records_updated: c.updated,
      records_skipped: c.skipped,
      error_count: c.errors.length + (extra.fatal ? 1 : 0),
      error_message: extra.fatal ?? (c.errors[0]?.message ?? null),
      metadata: { ...(extra.metadata ?? {}), errors: c.errors.slice(0, 25) },
    })
    .eq("id", id);
  if (error) console.error("[sync-log] could not finish", error);
  return status;
}
