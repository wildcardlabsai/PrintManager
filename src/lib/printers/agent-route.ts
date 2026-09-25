import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { bearerToken } from "@/lib/printers/agent-auth";
import { AgentAuthError, authenticateAgent, type AuthenticatedAgent } from "@/lib/services/printers/agents";
import { hasAdminClient, createAdminClient } from "@/lib/supabase/admin";

const MAX_BODY = 256 * 1024;

export function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64) || null;
}

export async function readJson(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new AgentAuthError("Request too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ZodError([]);
  }
}

/**
 * Wraps an agent endpoint: bearer-token authentication, JSON errors, and no
 * caching. Errors never echo internal details back to the agent.
 */
export async function withAgent(
  request: NextRequest,
  handler: (agent: AuthenticatedAgent, token: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  if (!hasAdminClient()) return NextResponse.json({ error: "Printer integration is not configured on this server." }, { status: 503 });
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return NextResponse.json({ error: "Missing agent token." }, { status: 401 });
  try {
    const agent = await authenticateAgent(createAdminClient(), token);
    const res = await handler(agent, token);
    res.headers.set("cache-control", "no-store");
    return res;
  } catch (error) {
    return agentError(error);
  }
}

export function agentError(error: unknown) {
  if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof ZodError) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  console.error("[agent api]", error);
  return NextResponse.json({ error: "Server error." }, { status: 500 });
}
