import { NextResponse, type NextRequest } from "next/server";
import { agentError, clientIp, readJson } from "@/lib/printers/agent-route";
import { pairAgent } from "@/lib/services/printers/agents";
import { hasAdminClient } from "@/lib/supabase/admin";
import { pairSchema } from "@/lib/validation/agent";

/** Exchanges a one-time pairing code (created in Printers → Agents) for an agent token. */
export async function POST(request: NextRequest) {
  if (!hasAdminClient()) return NextResponse.json({ error: "Printer integration is not configured on this server." }, { status: 503 });
  try {
    const body = pairSchema.parse(await readJson(request));
    const res = await pairAgent(body, clientIp(request));
    return NextResponse.json(res, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return agentError(error);
  }
}
