"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createFilament, deleteFilament, recordUsage, updateFilament } from "@/lib/services/filaments";
import { filamentSchema, filamentUsageSchema } from "@/lib/validation/schemas";
import { parse, run } from "./_run";

function refresh() {
  revalidatePath("/filament");
  revalidatePath("/dashboard");
}

export async function createFilamentAction(input: unknown) {
  return run(async (ctx) => {
    await createFilament(ctx, parse(filamentSchema, input));
    refresh();
  }, "Spool added");
}

export async function updateFilamentAction(id: string, input: unknown) {
  return run(async (ctx) => {
    await updateFilament(ctx, parse(z.uuid(), id), parse(filamentSchema, input));
    refresh();
  }, "Spool saved");
}

export async function recordFilamentUsageAction(input: unknown) {
  return run(async (ctx) => {
    const data = parse(filamentUsageSchema, input);
    const remaining = await recordUsage(ctx, data.filament_id, data.grams, data.note);
    refresh();
    return { remaining };
  }, "Usage recorded");
}

export async function deleteFilamentAction(id: string) {
  return run(async (ctx) => {
    await deleteFilament(ctx, parse(z.uuid(), id));
    refresh();
  }, "Spool deleted");
}
