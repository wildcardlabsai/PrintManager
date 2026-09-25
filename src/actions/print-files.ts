"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createPrintFile, printFileDownloadUrl, setPrintFileArchived, setPrintFileProven, updatePrintFile } from "@/lib/services/print-files";
import { printFileMetaSchema } from "@/lib/validation/schemas";
import { parse, run } from "./_run";

function refresh(productId?: string | null) {
  revalidatePath("/print-files");
  revalidatePath("/production");
  if (productId) revalidatePath(`/products/${productId}`);
}

export async function createPrintFileAction(upload: unknown, meta: unknown) {
  return run(async (ctx) => {
    const m = parse(printFileMetaSchema, meta);
    const file = await createPrintFile(ctx, upload, m);
    refresh(file.product_id);
    return { id: file.id };
  }, "Print file added");
}

export async function updatePrintFileAction(id: string, meta: unknown) {
  return run(async (ctx) => {
    const m = parse(printFileMetaSchema, meta);
    await updatePrintFile(ctx, parse(z.uuid(), id), m);
    refresh(m.product_id);
  }, "Print file saved");
}

export async function archivePrintFileAction(id: string, archived: boolean) {
  return run(async (ctx) => {
    await setPrintFileArchived(ctx, parse(z.uuid(), id), archived);
    refresh();
  }, archived ? "Print file archived" : "Print file restored");
}

export async function setPrintFileProvenAction(id: string, proven: boolean) {
  return run(async (ctx) => {
    await setPrintFileProven(ctx, parse(z.uuid(), id), proven);
    refresh();
  }, proven ? "Marked as proven" : "No longer marked proven");
}

export async function printFileDownloadAction(id: string) {
  return run((ctx) => printFileDownloadUrl(ctx, parse(z.uuid(), id)), undefined, { allowViewer: true });
}
