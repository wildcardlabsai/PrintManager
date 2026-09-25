import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { Settings } from "@/types/db";
import type { AppContext } from "../context";

/**
 * Context for work that runs without a signed-in user (webhooks, scheduled
 * syncs). Uses the service-role client, so every query MUST be scoped to
 * orgId — the services all filter by ctx.orgId.
 */
export async function systemContext(orgId: string): Promise<AppContext> {
  const admin = createAdminClient();
  const { data: settings, error } = await admin.from("settings").select("*").eq("organization_id", orgId).single();
  if (error || !settings) throw new Error(`Settings not found for organization ${orgId}`);
  return {
    supabase: admin as unknown as SupabaseServerClient,
    userId: null,
    email: null,
    fullName: "System",
    orgId,
    role: "system",
    settings: settings as Settings,
  };
}
