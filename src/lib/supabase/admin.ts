import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses Row Level Security, so it is used ONLY for:
 *   - reading/writing encrypted integration credentials and OAuth state
 *   - work that runs without a signed-in user (webhooks, scheduled syncs)
 * Never import this from client components; never return its data unfiltered.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured. It is required for marketplace and shipping integrations.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function hasAdminClient() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export type AdminClient = ReturnType<typeof createAdminClient>;
