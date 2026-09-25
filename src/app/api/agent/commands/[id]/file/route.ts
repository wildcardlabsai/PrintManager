import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAgent } from "@/lib/printers/agent-route";
import { fileTicketForCommand } from "@/lib/services/printers/telemetry";

/**
 * A short-lived download link for the file of a start-print command this
 * agent has claimed. There is no general file access for agents.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/agent/commands/[id]/file">) {
  return withAgent(request, async (agent) => {
    const id = z.uuid().parse((await ctx.params).id);
    const ticket = await fileTicketForCommand(agent, id);
    if (!ticket) return NextResponse.json({ error: "No file for this command." }, { status: 404 });
    return NextResponse.json(ticket);
  });
}
