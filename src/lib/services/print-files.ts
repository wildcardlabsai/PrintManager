import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { printFileUploadSchema, type PrintFileMetaInput } from "@/lib/validation/schemas";
import type { PrintFile, Product } from "@/types/db";
import { logAudit } from "./audit";
import { requirePermission, type AppContext } from "./context";
import { AppError, check, checkFound } from "./errors";

export const PRINT_FILE_BUCKET = "print-files";

export interface PrintFileRow extends PrintFile {
  product: Pick<Product, "id" | "name" | "sku"> | null;
}

export async function listPrintFiles(ctx: AppContext, opts: { productId?: string; includeArchived?: boolean } = {}): Promise<PrintFileRow[]> {
  let q = ctx.supabase
    .from("print_files")
    .select("*, product:products(id, name, sku)")
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (opts.productId) q = q.eq("product_id", opts.productId);
  if (!opts.includeArchived) q = q.is("archived_at", null);
  return check(await q) as PrintFileRow[];
}

export async function getPrintFile(ctx: AppContext, id: string) {
  return checkFound(
    await ctx.supabase.from("print_files").select("*, product:products(id, name, sku)").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle(),
    "Print file",
  ) as PrintFileRow;
}

/** One default file per product (and variant) per printer model. */
async function clearOtherDefaults(ctx: AppContext, productId: string, variantId: string | null, exceptId: string, models: string[]) {
  let q = ctx.supabase
    .from("print_files")
    .update({ is_default: false })
    .eq("product_id", productId)
    .eq("is_default", true)
    .neq("id", exceptId)
    .overlaps("compatible_models", models);
  q = variantId ? q.eq("variant_id", variantId) : q.is("variant_id", null);
  check(await q);
}

async function assertProduct(ctx: AppContext, productId: string | null, variantId: string | null) {
  if (!productId) {
    if (variantId) throw new AppError("Choose the product for this variant.", "validation");
    return;
  }
  checkFound(await ctx.supabase.from("products").select("id").eq("id", productId).eq("organization_id", ctx.orgId).maybeSingle(), "Product");
  if (variantId) {
    checkFound(
      await ctx.supabase.from("product_variants").select("id").eq("id", variantId).eq("product_id", productId).maybeSingle(),
      "Variant",
    );
  }
}

/**
 * Registers a file the browser uploaded straight to private storage (large
 * files never pass through a server action). The object must exist under this
 * organization's folder.
 */
export async function createPrintFile(ctx: AppContext, upload: unknown, meta: PrintFileMetaInput) {
  requirePermission(ctx, "manage_production");
  const u = printFileUploadSchema.parse(upload);
  if (u.storage_path.split("/")[0] !== ctx.orgId) throw new AppError("Invalid upload location.", "forbidden");
  await assertProduct(ctx, meta.product_id, meta.variant_id);
  const admin = createAdminClient();
  const { data: info, error: infoError } = await admin.storage.from(PRINT_FILE_BUCKET).info(u.storage_path);
  if (infoError || !info) throw new AppError("The upload didn't finish. Please upload the file again.", "validation");
  if (typeof info.size === "number" && info.size !== u.size_bytes) throw new AppError("The uploaded file size doesn't match. Please upload it again.", "validation");

  const file = check(
    await ctx.supabase
      .from("print_files")
      .insert({
        organization_id: ctx.orgId,
        ...meta,
        storage_path: u.storage_path,
        file_name: u.file_name,
        file_type: u.file_type,
        size_bytes: u.size_bytes,
        sha256: u.sha256,
        metadata: u.metadata,
        created_by: ctx.userId,
      })
      .select("*")
      .single(),
  ) as PrintFile;
  if (file.is_default && file.product_id) await clearOtherDefaults(ctx, file.product_id, file.variant_id, file.id, file.compatible_models);
  await logAudit(ctx, "print_file.created", { type: "print_file", id: file.id }, `Print file "${file.name}" uploaded (${u.file_name})`, {
    product_id: file.product_id,
    compatible_models: file.compatible_models,
    sha256: file.sha256,
  });
  return file;
}

export async function updatePrintFile(ctx: AppContext, id: string, meta: PrintFileMetaInput) {
  requirePermission(ctx, "manage_production");
  const before = await getPrintFile(ctx, id);
  await assertProduct(ctx, meta.product_id, meta.variant_id);
  // Changing how a file prints means it has to be proven again.
  const reprove =
    before.multi_colour !== meta.multi_colour ||
    before.ifs_required !== meta.ifs_required ||
    before.material !== meta.material ||
    before.colour !== meta.colour ||
    before.compatible_models.join() !== meta.compatible_models.join();
  check(
    await ctx.supabase
      .from("print_files")
      .update({ ...meta, ...(reprove ? { verified_at: null, verified_by: null } : {}) })
      .eq("id", id),
  );
  if (meta.is_default && meta.product_id) await clearOtherDefaults(ctx, meta.product_id, meta.variant_id, id, meta.compatible_models);
  await logAudit(ctx, "print_file.updated", { type: "print_file", id }, `Print file "${meta.name}" updated`, { reproved: reprove });
}

export async function setPrintFileArchived(ctx: AppContext, id: string, archived: boolean) {
  requirePermission(ctx, "manage_production");
  const file = await getPrintFile(ctx, id);
  if (archived) {
    const { count } = await ctx.supabase
      .from("production_jobs")
      .select("id", { count: "exact", head: true })
      .eq("print_file_id", id)
      .in("status", ["sending", "sent", "printing", "paused"]);
    if ((count ?? 0) > 0) throw new AppError("This file is being printed right now.", "conflict");
  }
  check(
    await ctx.supabase
      .from("print_files")
      .update({ archived_at: archived ? new Date().toISOString() : null, ...(archived ? { is_default: false } : {}) })
      .eq("id", id),
  );
  await logAudit(ctx, "print_file.archived", { type: "print_file", id }, `Print file "${file.name}" ${archived ? "archived" : "restored"}`);
}

export async function setPrintFileProven(ctx: AppContext, id: string, proven: boolean) {
  requirePermission(ctx, "manage_production");
  const file = await getPrintFile(ctx, id);
  check(
    await ctx.supabase
      .from("print_files")
      .update(proven ? { verified_at: new Date().toISOString(), verified_by: ctx.userId } : { verified_at: null, verified_by: null })
      .eq("id", id),
  );
  await logAudit(ctx, "print_file.verified", { type: "print_file", id }, `Print file "${file.name}" ${proven ? "marked proven" : "no longer marked proven"}`);
}

/** A short-lived download link for a signed-in member. */
export async function printFileDownloadUrl(ctx: AppContext, id: string) {
  const file = await getPrintFile(ctx, id);
  const { data, error } = await ctx.supabase.storage.from(PRINT_FILE_BUCKET).createSignedUrl(file.storage_path, 300, { download: file.file_name });
  if (error || !data) throw new AppError("Could not create a download link.");
  return data.signedUrl;
}
