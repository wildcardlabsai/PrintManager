import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient, type SupabaseServerClient } from "@/lib/supabase/server";
import type { Settings } from "@/types/db";
import { AppError } from "./errors";

export interface AppContext {
  supabase: SupabaseServerClient;
  /** Null for system work (webhooks, scheduled syncs) that runs without a signed-in user. */
  userId: string | null;
  email: string | null;
  fullName: string | null;
  orgId: string;
  settings: Settings;
}

/** The signed-in user, or null. Cached for the duration of a request. */
export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return {
    supabase,
    userId: data.claims.sub as string,
    email: (data.claims.email as string | undefined) ?? null,
  };
});

/**
 * Loads the user's active organization and its settings. Returns null when
 * the user has not created a business yet (onboarding).
 */
export const loadAppContext = cache(async (): Promise<AppContext | null> => {
  const session = await getSessionUser();
  if (!session) return null;
  const { supabase, userId, email } = session;

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_organization_id, full_name")
    .eq("id", userId)
    .maybeSingle();

  let orgId: string | null = profile?.active_organization_id ?? null;
  if (!orgId) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    orgId = membership?.organization_id ?? null;
  }
  if (!orgId) return null;

  const { data: settings, error } = await supabase.from("settings").select("*").eq("organization_id", orgId).maybeSingle();
  if (error || !settings) return null;

  return { supabase, userId, email, fullName: profile?.full_name ?? null, orgId, settings: settings as Settings };
});

/** For pages: redirects to login/onboarding when needed. */
export async function requirePageContext(): Promise<AppContext> {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  const ctx = await loadAppContext();
  if (!ctx) redirect("/onboarding");
  return ctx;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function requireActionContext(): Promise<AppContext> {
  const session = await getSessionUser();
  if (!session) throw new AppError("Your session has expired. Please sign in again.", "unauthenticated");
  const ctx = await loadAppContext();
  if (!ctx) throw new AppError("Set up your business before continuing.", "forbidden");
  return ctx;
}

/** Integrations and other account-level changes are limited to owners/admins. */
export async function requireAdminRole(ctx: AppContext) {
  const { data } = await ctx.supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", ctx.orgId)
    .eq("user_id", ctx.userId ?? "")
    .maybeSingle();
  if (!data || (data.role !== "owner" && data.role !== "admin")) {
    throw new AppError("Only the business owner or an admin can manage integrations.", "forbidden");
  }
}
