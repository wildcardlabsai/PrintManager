import { NextResponse, type NextRequest } from "next/server";
import { ebayConfig } from "@/lib/integrations/config";
import { ebayChallengeResponse } from "@/lib/integrations/ebay/notifications";
import { handleEbayAccountDeletion } from "@/lib/services/integrations/webhooks";

/** eBay Marketplace Account Deletion endpoint — endpoint validation challenge. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("challenge_code");
  const c = ebayConfig();
  if (!code) return NextResponse.json({ error: "challenge_code required" }, { status: 400 });
  if (!c.deletionVerificationToken || !c.deletionEndpoint) {
    return NextResponse.json({ error: "Account deletion endpoint is not configured" }, { status: 503 });
  }
  return NextResponse.json({ challengeResponse: ebayChallengeResponse(code, c.deletionVerificationToken, c.deletionEndpoint) });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  try {
    const result = await handleEbayAccountDeletion(raw, request.headers.get("x-ebay-signature"));
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    console.error("[webhook:ebay-deletion]", e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
