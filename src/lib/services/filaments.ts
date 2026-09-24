import "server-only";
import type { FilamentInput } from "@/lib/validation/schemas";
import type { Filament, FilamentUsage } from "@/types/db";
import { logAudit } from "./audit";
import type { AppContext } from "./context";
import { AppError, check, checkFound, fromDbError } from "./errors";

export async function listFilaments(ctx: AppContext, opts: { includeArchived?: boolean } = {}) {
  let q = ctx.supabase
    .from("filaments")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .order("material")
    .order("colour");
  if (!opts.includeArchived) q = q.neq("status", "archived");
  return check(await q) as Filament[];
}

/** Spools that can be picked when recording usage. */
export async function listUsableFilaments(ctx: AppContext) {
  return check(
    await ctx.supabase
      .from("filaments")
      .select("id, brand, material, colour, colour_hex, remaining_g, status")
      .eq("organization_id", ctx.orgId)
      .in("status", ["sealed", "in_use", "low"])
      .order("material")
      .order("colour"),
  ) as Pick<Filament, "id" | "brand" | "material" | "colour" | "colour_hex" | "remaining_g" | "status">[];
}
export type FilamentOption = Awaited<ReturnType<typeof listUsableFilaments>>[number];

export async function listRecentUsage(ctx: AppContext, limit = 20) {
  return check(
    await ctx.supabase
      .from("filament_usage")
      .select("*, filament:filaments(brand, material, colour), job:production_jobs(id, job_number, product_name)")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ) as (FilamentUsage & {
    filament: Pick<Filament, "brand" | "material" | "colour"> | null;
    job: { id: string; job_number: number; product_name: string } | null;
  })[];
}

export async function createFilament(ctx: AppContext, input: FilamentInput, opts: { isDemo?: boolean } = {}) {
  const spool = check(
    await ctx.supabase
      .from("filaments")
      .insert({ ...input, organization_id: ctx.orgId, is_demo: opts.isDemo ?? false })
      .select("*")
      .single(),
  ) as Filament;
  await logAudit(ctx, "filament.created", { type: "filament", id: spool.id }, `Spool added: ${describe(spool)}`);
  return spool;
}

export async function updateFilament(ctx: AppContext, id: string, input: FilamentInput) {
  const spool = checkFound(
    await ctx.supabase
      .from("filaments")
      .update(input)
      .eq("id", id)
      .eq("organization_id", ctx.orgId)
      .select("*")
      .maybeSingle(),
    "Filament spool",
  ) as Filament;
  await logAudit(ctx, "filament.updated", { type: "filament", id }, `Spool updated: ${describe(spool)}`, {
    remaining_g: spool.remaining_g,
  });
  return spool;
}

export async function recordUsage(ctx: AppContext, filamentId: string, grams: number, note: string | null) {
  const { data, error } = await ctx.supabase.rpc("record_filament_usage", {
    p_filament: filamentId,
    p_grams: grams,
    p_job: null,
    p_note: note,
  });
  if (error) throw fromDbError(error, "Filament usage could not be recorded.");
  await logAudit(ctx, "filament.usage_recorded", { type: "filament", id: filamentId }, `${grams} g used${note ? ` — ${note}` : ""}`, {
    grams,
    remaining_g: data,
  });
  return data as number;
}

export async function deleteFilament(ctx: AppContext, id: string) {
  const { count } = await ctx.supabase
    .from("filament_usage")
    .select("id", { count: "exact", head: true })
    .eq("filament_id", id);
  if (count && count > 0) {
    throw new AppError("This spool has recorded usage, so it can't be deleted. Archive it instead to keep your history.", "conflict");
  }
  const spool = checkFound(
    await ctx.supabase.from("filaments").delete().eq("id", id).eq("organization_id", ctx.orgId).select("*").maybeSingle(),
    "Filament spool",
  ) as Filament;
  await logAudit(ctx, "filament.deleted", { type: "filament", id }, `Spool deleted: ${describe(spool)}`);
}

function describe(s: Pick<Filament, "brand" | "material" | "colour">) {
  return [s.brand, s.material, s.colour].filter(Boolean).join(" ");
}
