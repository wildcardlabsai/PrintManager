import "server-only";
import type { PairRequest, PairResponse } from "../../../../agent/src/protocol";
import {
  PAIRING_CODE_TTL_MINUTES,
  TOKEN_ROTATE_AFTER_DAYS,
  generateAgentToken,
  generatePairingCode,
  hashSecret,
  normalisePairingCode,
} from "@/lib/printers/agent-auth";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import type { Printer, PrinterAgent } from "@/types/db";
import { logAudit } from "../audit";
import { requirePermission, type AppContext } from "../context";
import { AppError, check, checkFound } from "../errors";
import { systemContext } from "../integrations/system";

export const AGENT_COLUMNS =
  "id, organization_id, name, status, pairing_expires_at, token_issued_at, version, platform, driver, library_version, last_seen_at, last_ip, created_by, revoked_at, revoked_by, created_at, updated_at";

export interface AgentWithPrinters extends PrinterAgent {
  printers: Pick<Printer, "id" | "name" | "model" | "connection_state">[];
}

export async function listAgents(ctx: AppContext): Promise<AgentWithPrinters[]> {
  const [agents, printers] = await Promise.all([
    ctx.supabase.from("printer_agents").select(AGENT_COLUMNS).eq("organization_id", ctx.orgId).order("created_at"),
    ctx.supabase.from("printers").select("id, name, model, connection_state, agent_id").eq("organization_id", ctx.orgId).is("archived_at", null),
  ]);
  const ps = check(printers) as (AgentWithPrinters["printers"][number] & { agent_id: string | null })[];
  return (check(agents) as unknown as PrinterAgent[]).map((a) => ({ ...a, printers: ps.filter((p) => p.agent_id === a.id) }));
}

/** Creates an agent record and returns its one-time pairing code (shown once, stored hashed). */
export async function createAgent(ctx: AppContext, name: string) {
  requirePermission(ctx, "manage_agents");
  const code = generatePairingCode();
  const admin = createAdminClient();
  const agent = check(
    await admin
      .from("printer_agents")
      .insert({
        organization_id: ctx.orgId,
        name,
        status: "pending",
        pairing_code_hash: hashSecret(code),
        pairing_expires_at: new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60000).toISOString(),
        created_by: ctx.userId,
      })
      .select("id, name, pairing_expires_at")
      .single(),
  ) as Pick<PrinterAgent, "id" | "name" | "pairing_expires_at">;
  await logAudit(ctx, "printer_agent.created", { type: "printer_agent", id: agent.id }, `Printer Agent "${name}" created`);
  return { agent, code };
}

/**
 * Issues a fresh pairing code. For an active agent this also invalidates its
 * current token: re-pairing replaces the agent's credentials.
 */
export async function regeneratePairingCode(ctx: AppContext, agentId: string) {
  requirePermission(ctx, "manage_agents");
  const admin = createAdminClient();
  const existing = checkFound(
    await admin.from("printer_agents").select("id, name, status").eq("id", agentId).eq("organization_id", ctx.orgId).maybeSingle(),
    "Printer Agent",
  ) as Pick<PrinterAgent, "id" | "name" | "status">;
  const code = generatePairingCode();
  check(
    await admin
      .from("printer_agents")
      .update({
        status: "pending",
        pairing_code_hash: hashSecret(code),
        pairing_expires_at: new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60000).toISOString(),
        token_hash: null,
        token_prev_hash: null,
        token_issued_at: null,
        revoked_at: null,
        revoked_by: null,
      })
      .eq("id", agentId),
  );
  await logAudit(ctx, "printer_agent.pairing_code_regenerated", { type: "printer_agent", id: agentId }, `New pairing code for "${existing.name}" (previous credentials revoked)`);
  return { code };
}

export async function revokeAgent(ctx: AppContext, agentId: string) {
  requirePermission(ctx, "manage_agents");
  const admin = createAdminClient();
  const agent = checkFound(
    await admin.from("printer_agents").select("id, name").eq("id", agentId).eq("organization_id", ctx.orgId).maybeSingle(),
    "Printer Agent",
  ) as Pick<PrinterAgent, "id" | "name">;
  const now = new Date().toISOString();
  check(
    await admin
      .from("printer_agents")
      .update({ status: "revoked", token_hash: null, token_prev_hash: null, pairing_code_hash: null, revoked_at: now, revoked_by: ctx.userId })
      .eq("id", agentId),
  );
  // Nothing queued for it may run later.
  await admin
    .from("printer_commands")
    .update({ status: "cancelled", completed_at: now, error: "Agent revoked" })
    .eq("agent_id", agentId)
    .eq("status", "pending");
  await admin
    .from("printers")
    .update({ connection_state: "not_configured", status: "unknown", status_updated_at: now })
    .eq("agent_id", agentId)
    .eq("organization_id", ctx.orgId);
  await logAudit(ctx, "printer_agent.revoked", { type: "printer_agent", id: agentId }, `Printer Agent "${agent.name}" revoked`);
}

// ---------------------------------------------------------------------------
// Agent-facing (API routes; no user session)
// ---------------------------------------------------------------------------

export class AgentAuthError extends Error {}

export async function pairAgent(req: PairRequest, ip: string | null): Promise<PairResponse> {
  const code = normalisePairingCode(req.code);
  if (!code) throw new AgentAuthError("Invalid pairing code.");
  const admin = createAdminClient();
  const { data: agent } = await admin
    .from("printer_agents")
    .select("id, organization_id, name, status, pairing_expires_at")
    .eq("pairing_code_hash", hashSecret(code))
    .maybeSingle();
  if (!agent || agent.status !== "pending" || !agent.pairing_expires_at || new Date(agent.pairing_expires_at) < new Date()) {
    throw new AgentAuthError("This pairing code is invalid or has expired. Create a new one in PrintFlow.");
  }
  const token = generateAgentToken();
  const now = new Date().toISOString();
  // Single use: only succeeds if the code is still the current one.
  const { data: updated } = await admin
    .from("printer_agents")
    .update({
      status: "active",
      pairing_code_hash: null,
      pairing_expires_at: null,
      token_hash: hashSecret(token),
      token_prev_hash: null,
      token_issued_at: now,
      version: req.version.slice(0, 40),
      platform: req.platform.slice(0, 60),
      driver: req.driver,
      last_ip: ip,
      ...(req.name ? { name: req.name.slice(0, 120) } : {}),
    })
    .eq("id", agent.id)
    .eq("pairing_code_hash", hashSecret(code))
    .select("id")
    .maybeSingle();
  if (!updated) throw new AgentAuthError("This pairing code has already been used.");
  const { data: org } = await admin.from("organizations").select("name").eq("id", agent.organization_id).single();
  const ctx = await systemContext(agent.organization_id);
  await logAudit(ctx, "printer_agent.paired", { type: "printer_agent", id: agent.id }, `Printer Agent "${agent.name}" paired (${req.platform}, ${req.driver})`, {
    driver: req.driver,
    version: req.version,
  });
  return { agentId: agent.id, token, organizationName: org?.name ?? "PrintFlow" };
}

export interface AuthenticatedAgent {
  id: string;
  organization_id: string;
  name: string;
  driver: PrinterAgent["driver"];
  token_issued_at: string | null;
  /** The agent used its previous token: it hasn't received the rotated one yet. */
  usedPreviousToken: boolean;
}

export async function authenticateAgent(admin: AdminClient, token: string): Promise<AuthenticatedAgent> {
  const hash = hashSecret(token);
  const { data } = await admin
    .from("printer_agents")
    .select("id, organization_id, name, status, driver, token_hash, token_prev_hash, token_issued_at")
    .or(`token_hash.eq.${hash},token_prev_hash.eq.${hash}`)
    .limit(1)
    .maybeSingle();
  if (!data || data.status !== "active") throw new AgentAuthError("Unknown or revoked agent token.");
  const usedPreviousToken = data.token_prev_hash === hash;
  if (!usedPreviousToken && data.token_prev_hash) {
    // The agent is using the new token, so the old one is retired.
    await admin.from("printer_agents").update({ token_prev_hash: null }).eq("id", data.id);
  }
  return {
    id: data.id,
    organization_id: data.organization_id,
    name: data.name,
    driver: data.driver,
    token_issued_at: data.token_issued_at,
    usedPreviousToken,
  };
}

/** Rotates the token when it's old (or re-issues if the agent missed a rotation). Returns the new token or null. */
export async function maybeRotateToken(admin: AdminClient, agent: AuthenticatedAgent, currentToken: string): Promise<string | null> {
  const age = agent.token_issued_at ? Date.now() - new Date(agent.token_issued_at).getTime() : Infinity;
  const due = age > TOKEN_ROTATE_AFTER_DAYS * 86400000;
  if (!due && !agent.usedPreviousToken) return null;
  const token = generateAgentToken();
  const { error } = await admin
    .from("printer_agents")
    .update({ token_hash: hashSecret(token), token_prev_hash: hashSecret(currentToken), token_issued_at: new Date().toISOString() })
    .eq("id", agent.id);
  if (error) {
    console.error("[agents] token rotation failed", error);
    return null;
  }
  const ctx = await systemContext(agent.organization_id);
  await logAudit(ctx, "printer_agent.token_rotated", { type: "printer_agent", id: agent.id }, `Printer Agent "${agent.name}" token rotated`);
  return token;
}

export function assertAgentOwnsPrinter(printer: Pick<Printer, "agent_id" | "organization_id">, agent: AuthenticatedAgent) {
  if (printer.agent_id !== agent.id || printer.organization_id !== agent.organization_id) {
    throw new AppError("This agent does not manage that printer.", "forbidden");
  }
}
