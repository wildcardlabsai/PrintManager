import { NextResponse, type NextRequest } from "next/server";
import { clientIp, readJson, withAgent } from "@/lib/printers/agent-route";
import { processHeartbeat } from "@/lib/services/printers/telemetry";
import { heartbeatSchema } from "@/lib/validation/agent";

export const maxDuration = 30;

/** Agent → PrintFlow: telemetry in; printer configuration and queued commands out. */
export async function POST(request: NextRequest) {
  return withAgent(request, async (agent, token) => {
    const body = heartbeatSchema.parse(await readJson(request));
    return NextResponse.json(await processHeartbeat(agent, body, token, clientIp(request)));
  });
}
