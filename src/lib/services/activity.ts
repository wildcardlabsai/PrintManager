import "server-only";
import type { AuditLog } from "@/types/db";
import type { AppContext } from "./context";
import { fromDbError } from "./errors";
import { resolveUserNames } from "./orders";
import { pageRange, paginated } from "./query";

export async function listActivity(ctx: AppContext, opts: { page?: number; entity?: string | null } = {}) {
  const { page, from, to } = pageRange(opts.page ?? 1, 50);
  let q = ctx.supabase
    .from("audit_logs")
    .select("*", { count: "exact" })
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (opts.entity) q = q.eq("entity_type", opts.entity);
  const { data, count, error } = await q;
  if (error) throw fromDbError(error);
  const rows = (data ?? []) as AuditLog[];
  const names = await resolveUserNames(ctx, rows.map((r) => r.actor_id));
  return paginated(
    rows.map((r) => ({ ...r, actor_name: r.actor_id ? names.get(r.actor_id) ?? null : null })),
    count,
    page,
    50,
  );
}
