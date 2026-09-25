import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readJson, withAgent } from "@/lib/printers/agent-route";
import { applyCommandResult } from "@/lib/services/printers/telemetry";
import { commandResultSchema } from "@/lib/validation/agent";

/** The outcome of a command the agent carried out. Idempotent: repeats are ignored. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/agent/commands/[id]/result">) {
  return withAgent(request, async (agent) => {
    const id = z.uuid().parse((await ctx.params).id);
    const body = commandResultSchema.parse(await readJson(request));
    const res = await applyCommandResult(agent, id, body);
    if (!res.found) return NextResponse.json({ error: "Unknown command." }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}
