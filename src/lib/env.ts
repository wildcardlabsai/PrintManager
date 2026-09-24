/**
 * Public Supabase configuration. Only values that are safe to expose to the
 * browser belong here. Server-only secrets (service role key, future
 * marketplace/shipping/printer credentials) are read in server modules only.
 */
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).",
    );
  }
  return { url, anonKey };
}
