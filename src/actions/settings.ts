"use server";

import { revalidatePath } from "next/cache";
import { clearDemoData, loadDemoData } from "@/lib/services/demo-data";
import { updateProductionSettings, updateSettings } from "@/lib/services/settings";
import { productionSettingsSchema, settingsSchema } from "@/lib/validation/schemas";
import { parse, run } from "./_run";

export async function updateSettingsAction(input: unknown) {
  return run(async (ctx) => {
    await updateSettings(ctx, parse(settingsSchema, input));
    revalidatePath("/", "layout");
  }, "Settings saved");
}

export async function loadDemoDataAction() {
  return run(async (ctx) => {
    await loadDemoData(ctx);
    revalidatePath("/", "layout");
  }, "Demo data loaded");
}

export async function clearDemoDataAction() {
  return run(async (ctx) => {
    await clearDemoData(ctx);
    revalidatePath("/", "layout");
  }, "Demo data removed");
}

export async function updateProductionSettingsAction(input: unknown) {
  return run(async (ctx) => {
    await updateProductionSettings(ctx, parse(productionSettingsSchema, input));
    revalidatePath("/", "layout");
  }, "Production settings saved");
}
