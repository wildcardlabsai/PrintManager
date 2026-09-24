import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/lib/services/errors";
import { loadAppContext, requireAdminRole } from "@/lib/services/context";
import { completeOAuth } from "@/lib/services/integrations/oauth-flow";

/**
 * OAuth redirect target. Etsy: set ETSY_REDIRECT_URI to this URL.
 * eBay: set your RuName's "auth accepted URL" (and declined URL) to this URL.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/integrations/[provider]/callback">) {
  const { provider } = await params;
  const back = new URL("/settings/integrations", request.url);
  if (provider !== "etsy" && provider !== "ebay") return NextResponse.redirect(back);
  const ctx = await loadAppContext();
  if (!ctx) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", "/settings/integrations");
    return NextResponse.redirect(login);
  }
  try {
    await requireAdminRole(ctx);
    const conn = await completeOAuth(ctx, provider, request.nextUrl.searchParams);
    back.searchParams.set("connected", provider);
    back.searchParams.set("account", conn.external_account_name ?? conn.external_account_id ?? "");
  } catch (e) {
    back.searchParams.set("error", e instanceof AppError ? e.message : "The connection could not be completed.");
    if (!(e instanceof AppError)) console.error("[oauth] callback", e);
  }
  return NextResponse.redirect(back);
}
