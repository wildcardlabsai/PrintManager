import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/lib/services/errors";
import { loadAppContext, requireAdminRole } from "@/lib/services/context";
import { beginOAuth } from "@/lib/services/integrations/oauth-flow";

const PROVIDERS = ["etsy", "ebay"] as const;

export async function GET(request: NextRequest, { params }: RouteContext<"/api/integrations/[provider]/connect">) {
  const { provider } = await params;
  const back = new URL("/settings/integrations", request.url);
  if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) return NextResponse.redirect(back);
  const ctx = await loadAppContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", request.url));
  try {
    await requireAdminRole(ctx);
    const url = await beginOAuth(ctx, provider as "etsy" | "ebay");
    return NextResponse.redirect(url);
  } catch (e) {
    back.searchParams.set("error", e instanceof AppError ? e.message : "Could not start the connection.");
    if (!(e instanceof AppError)) console.error("[oauth] begin", e);
    return NextResponse.redirect(back);
  }
}
