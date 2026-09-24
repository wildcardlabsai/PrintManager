import "server-only";
import { productUnitCost } from "@/lib/domain/costing";
import type { SettingsInput } from "@/lib/validation/schemas";
import type { Product, Settings } from "@/types/db";
import { logAudit } from "./audit";
import type { AppContext } from "./context";
import { check } from "./errors";

export async function updateSettings(ctx: AppContext, input: SettingsInput): Promise<Settings> {
  const updated = check(
    await ctx.supabase.from("settings").update(input).eq("organization_id", ctx.orgId).select("*").single(),
  ) as Settings;

  if (input.business_name !== ctx.settings.business_name) {
    await ctx.supabase.from("organizations").update({ name: input.business_name }).eq("id", ctx.orgId);
  }

  const costingChanged =
    Number(updated.electricity_cost_per_hour) !== Number(ctx.settings.electricity_cost_per_hour) ||
    Number(updated.default_filament_cost_per_kg) !== Number(ctx.settings.default_filament_cost_per_kg) ||
    Number(updated.default_packaging_cost) !== Number(ctx.settings.default_packaging_cost);

  let recalculated = 0;
  if (costingChanged) recalculated = await recalculateProductCosts({ ...ctx, settings: updated });

  await logAudit(ctx, "settings.updated", { type: "settings", id: ctx.orgId }, "Settings updated", {
    recalculated_products: recalculated,
  });
  return updated;
}

/**
 * Re-derives the stored cost_price of every product after costing settings
 * change. Existing orders keep the costs they were placed with.
 */
export async function recalculateProductCosts(ctx: AppContext): Promise<number> {
  const products = check(
    await ctx.supabase
      .from("products")
      .select("id, filament_grams, print_minutes, filament_cost_per_kg, packaging_cost, other_cost, cost_price")
      .eq("organization_id", ctx.orgId),
  ) as Pick<Product, "id" | "filament_grams" | "print_minutes" | "filament_cost_per_kg" | "packaging_cost" | "other_cost" | "cost_price">[];

  let changed = 0;
  for (const p of products) {
    const cost = productUnitCost(p, ctx.settings).total;
    if (cost !== Number(p.cost_price)) {
      check(await ctx.supabase.from("products").update({ cost_price: cost }).eq("id", p.id));
      changed++;
    }
  }
  return changed;
}
