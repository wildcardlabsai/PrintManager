import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runScheduledIntegrationWork } from "@/lib/services/integrations/scheduler";

export const maxDuration = 300;

function authorised(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Scheduled sync (Vercel Cron sends "Authorization: Bearer $CRON_SECRET"). */
export async function GET(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await runScheduledIntegrationWork();
  return NextResponse.json(summary);
}
