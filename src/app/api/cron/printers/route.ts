import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { systemContext } from "@/lib/services/integrations/system";
import { expireCommands, sweepStalePrinters } from "@/lib/services/printers/telemetry";

function authorised(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * Marks printers offline whose agent has gone silent and expires commands
 * nobody picked up. (The same checks also run on every heartbeat and when
 * printer pages load; this catches the case where every agent is down.)
 */
export async function GET(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data } = await admin.from("printers").select("organization_id").eq("connection_mode", "agent_lan").is("archived_at", null);
  const orgs = [...new Set((data ?? []).map((r) => r.organization_id as string))];
  for (const orgId of orgs) {
    const ctx = await systemContext(orgId);
    const withAdmin = { ...ctx, admin };
    await expireCommands(withAdmin);
    await sweepStalePrinters(withAdmin);
  }
  return NextResponse.json({ organizations: orgs.length });
}
