"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAgent, regeneratePairingCode, revokeAgent } from "@/lib/services/printers/agents";
import { parse, run } from "./_run";

export async function createAgentAction(name: string) {
  return run(async (ctx) => {
    const res = await createAgent(ctx, parse(z.string().trim().min(1, "Name is required").max(120), name));
    revalidatePath("/printers/agents");
    return { code: res.code, expiresAt: res.agent.pairing_expires_at, agentId: res.agent.id };
  });
}

export async function regeneratePairingCodeAction(agentId: string) {
  return run(async (ctx) => {
    const res = await regeneratePairingCode(ctx, parse(z.uuid(), agentId));
    revalidatePath("/printers/agents");
    return res;
  });
}

export async function revokeAgentAction(agentId: string) {
  return run(async (ctx) => {
    await revokeAgent(ctx, parse(z.uuid(), agentId));
    revalidatePath("/printers/agents");
    revalidatePath("/printers");
  }, "Agent revoked — it can no longer connect");
}
