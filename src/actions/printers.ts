"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PRINTER_STATUSES } from "@/types/db";
import { createPrinter, setPrinterArchived, setPrinterStatusManual, updatePrinter } from "@/lib/services/printers";
import { printerSchema } from "@/lib/validation/schemas";
import { parse, run } from "./_run";

function refresh() {
  revalidatePath("/printers");
  revalidatePath("/dashboard");
  revalidatePath("/production");
}

export async function createPrinterAction(input: unknown) {
  return run(async (ctx) => {
    await createPrinter(ctx, parse(printerSchema, input));
    refresh();
  }, "Printer added");
}

export async function updatePrinterAction(id: string, input: unknown) {
  return run(async (ctx) => {
    await updatePrinter(ctx, parse(z.uuid(), id), parse(printerSchema, input));
    refresh();
  }, "Printer saved");
}

export async function setPrinterStatusAction(id: string, status: string) {
  return run(async (ctx) => {
    await setPrinterStatusManual(ctx, parse(z.uuid(), id), parse(z.enum(PRINTER_STATUSES), status));
    refresh();
  }, "Printer status updated");
}

export async function archivePrinterAction(id: string, archived: boolean) {
  return run(async (ctx) => {
    await setPrinterArchived(ctx, parse(z.uuid(), id), archived);
    refresh();
  }, archived ? "Printer archived" : "Printer restored");
}
