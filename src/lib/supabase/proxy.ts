import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/env";

/** Routes reachable without a session. Webhooks and cron authenticate with their own signatures/secrets. */
// /api/agent authenticates Printer Agents by bearer token (or one-time pairing code) itself.
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/auth", "/api/health", "/api/webhooks", "/api/cron", "/api/agent"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session cookie on every request and redirects
 * unauthenticated visitors to /login.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Do not run code between createServerClient and getClaims: it validates and
  // refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!isAuthenticated && !isPublic(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
    return copyCookies(response, NextResponse.redirect(loginUrl));
  }

  if (isAuthenticated && (pathname === "/login" || pathname === "/signup")) {
    const appUrl = request.nextUrl.clone();
    appUrl.pathname = "/dashboard";
    appUrl.search = "";
    return copyCookies(response, NextResponse.redirect(appUrl));
  }

  return response;
}

function copyCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((c) => to.cookies.set(c));
  return to;
}
