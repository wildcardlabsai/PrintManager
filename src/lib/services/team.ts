import "server-only";
import type { MemberRole } from "@/types/db";
import { logAudit } from "./audit";
import { requirePermission, type AppContext } from "./context";
import { AppError, check } from "./errors";
import { resolveUserNames } from "./orders";

export interface TeamMember {
  user_id: string;
  role: MemberRole;
  name: string | null;
  created_at: string;
}

export async function listTeam(ctx: AppContext): Promise<TeamMember[]> {
  const rows = check(
    await ctx.supabase.from("organization_members").select("user_id, role, created_at").eq("organization_id", ctx.orgId).order("created_at"),
  ) as { user_id: string; role: MemberRole; created_at: string }[];
  const names = await resolveUserNames(ctx, rows.map((r) => r.user_id));
  return rows.map((r) => ({ ...r, name: names.get(r.user_id) ?? null }));
}

export async function setMemberRole(ctx: AppContext, userId: string, role: Exclude<MemberRole, "owner">) {
  requirePermission(ctx, "manage_team");
  if (userId === ctx.userId) throw new AppError("You can't change your own role.", "validation");
  const members = await listTeam(ctx);
  const target = members.find((m) => m.user_id === userId);
  if (!target) throw new AppError("That person isn't in this business.", "not_found");
  if (target.role === "owner") throw new AppError("The owner's role can't be changed here.", "validation");
  check(await ctx.supabase.from("organization_members").update({ role }).eq("organization_id", ctx.orgId).eq("user_id", userId));
  await logAudit(ctx, "team.role_changed", { type: "member", id: null }, `${target.name ?? "A team member"}: ${target.role} → ${role}`, {
    user_id: userId,
    from: target.role,
    to: role,
  });
}
