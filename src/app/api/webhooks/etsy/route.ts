import { NextResponse, type NextRequest } from "next/server";
import { handleEtsyWebhook } from "@/lib/services/integrations/webhooks";

/** Etsy webhook endpoint (register this URL in the Etsy developer portal). */
export async function POST(request: NextRequest) {
  // The signature covers the exact raw body, so read it as text before parsing.
  const raw = await request.text();
  try {
    const result = await handleEtsyWebhook(raw, request.headers);
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    console.error("[webhook:etsy]", e);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
