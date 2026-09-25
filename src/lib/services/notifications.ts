import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { AppNotification } from "@/types/db";
import type { AppContext } from "./context";
import { check } from "./errors";

export interface NotificationInput {
  type: string;
  severity: AppNotification["severity"];
  title: string;
  body?: string | null;
  link?: string | null;
  entity?: { type: string; id: string } | null;
  userId?: string | null;
}

/** Notification preferences in Settings that can silence a type. */
const PREFERENCE_FOR_TYPE: Record<string, string> = {
  print_completed: "print_completed",
  print_failed: "job_failed",
  print_stopped: "job_failed",
  dispatch_failed: "job_failed",
  printer_offline: "printer_offline",
  printer_error: "printer_offline",
};

/** Writes an in-app notification (server-side; the service role bypasses RLS). */
export async function notify(admin: AdminClient, orgId: string, prefs: Record<string, boolean> | null, n: NotificationInput) {
  const pref = PREFERENCE_FOR_TYPE[n.type];
  if (pref && prefs && prefs[pref] === false) return;
  const { error } = await admin.from("notifications").insert({
    organization_id: orgId,
    user_id: n.userId ?? null,
    type: n.type,
    severity: n.severity,
    title: n.title,
    body: n.body ?? null,
    link: n.link ?? null,
    entity_type: n.entity?.type ?? null,
    entity_id: n.entity?.id ?? null,
  });
  if (error) console.error("[notifications] insert failed", error);
}

export interface NotificationWithRead extends AppNotification {
  read: boolean;
}

export async function listNotifications(ctx: AppContext, limit = 30): Promise<{ items: NotificationWithRead[]; unread: number }> {
  const rows = check(
    await ctx.supabase.from("notifications").select("*").eq("organization_id", ctx.orgId).order("created_at", { ascending: false }).limit(limit),
  ) as AppNotification[];
  if (!rows.length) return { items: [], unread: 0 };
  const reads = check(
    await ctx.supabase
      .from("notification_reads")
      .select("notification_id")
      .eq("user_id", ctx.userId ?? "")
      .in(
        "notification_id",
        rows.map((r) => r.id),
      ),
  ) as { notification_id: string }[];
  const readSet = new Set(reads.map((r) => r.notification_id));
  const items = rows.map((r) => ({ ...r, read: readSet.has(r.id) }));
  return { items, unread: items.filter((i) => !i.read).length };
}

export async function markNotificationsRead(ctx: AppContext, ids: string[]) {
  if (!ids.length || !ctx.userId) return;
  const { error } = await ctx.supabase
    .from("notification_reads")
    .upsert(
      ids.map((id) => ({ notification_id: id, user_id: ctx.userId! })),
      { onConflict: "notification_id,user_id", ignoreDuplicates: true },
    );
  if (error) console.error("[notifications] mark read failed", error);
}
