import "server-only";
import { productUnitCost } from "@/lib/domain/costing";
import type { ProductInput, VariantInput } from "@/lib/validation/schemas";
import type { Printer, Product, ProductImage, ProductVariant } from "@/types/db";
import { logAudit } from "./audit";
import type { AppContext } from "./context";
import { AppError, check, checkFound } from "./errors";
import { pageRange, paginated, searchPattern, type Paginated } from "./query";

export type ProductListFilter = "active" | "inactive" | "archived" | "all";

export interface ProductListRow extends Product {
  primary_image: string | null;
  variant_count: number;
}

export async function listProducts(
  ctx: AppContext,
  opts: { q?: string; page?: number; filter?: ProductListFilter } = {},
): Promise<Paginated<ProductListRow>> {
  const { page, from, to } = pageRange(opts.page ?? 1);
  let query = ctx.supabase
    .from("products")
    .select("*, product_images(url, position), product_variants(id)", { count: "exact" })
    .eq("organization_id", ctx.orgId)
    .order("name")
    .range(from, to);
  const filter = opts.filter ?? "active";
  if (filter === "archived") query = query.not("archived_at", "is", null);
  else if (filter !== "all") query = query.is("archived_at", null);
  if (filter === "active") query = query.eq("is_active", true);
  if (filter === "inactive") query = query.eq("is_active", false);
  const pattern = searchPattern(opts.q);
  if (pattern) query = query.or(`name.ilike.${pattern},sku.ilike.${pattern},material.ilike.${pattern}`);

  const { data, count, error } = await query;
  if (error) check({ data, error });
  type Raw = Product & { product_images: { url: string; position: number }[]; product_variants: { id: string }[] };
  const rows = ((data ?? []) as Raw[]).map(({ product_images, product_variants, ...p }) => ({
    ...p,
    primary_image: [...(product_images ?? [])].sort((a, b) => a.position - b.position)[0]?.url ?? null,
    variant_count: product_variants?.length ?? 0,
  }));
  return paginated(rows, count, page);
}

/** Products (with active variants) for the order form. */
export async function listProductOptions(ctx: AppContext) {
  const rows = check(
    await ctx.supabase
      .from("products")
      .select(
        "id, sku, name, selling_price, cost_price, material, default_colour, filament_grams, print_minutes, filament_cost_per_kg, packaging_cost, other_cost, default_printer_id, product_variants(id, sku, name, colour, material, selling_price, filament_grams, print_minutes, is_active)",
      )
      .eq("organization_id", ctx.orgId)
      .eq("is_active", true)
      .is("archived_at", null)
      .order("name")
      .limit(1000),
  ) as (Pick<
    Product,
    | "id"
    | "sku"
    | "name"
    | "selling_price"
    | "cost_price"
    | "material"
    | "default_colour"
    | "filament_grams"
    | "print_minutes"
    | "filament_cost_per_kg"
    | "packaging_cost"
    | "other_cost"
    | "default_printer_id"
  > & { product_variants: Pick<ProductVariant, "id" | "sku" | "name" | "colour" | "material" | "selling_price" | "filament_grams" | "print_minutes" | "is_active">[] })[];
  return rows.map((r) => ({ ...r, product_variants: r.product_variants.filter((v) => v.is_active) }));
}
export type ProductOption = Awaited<ReturnType<typeof listProductOptions>>[number];

export async function getProduct(ctx: AppContext, id: string) {
  const product = checkFound(
    await ctx.supabase.from("products").select("*").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle(),
    "Product",
  ) as Product;
  const [variants, images, compat, salesRows] = await Promise.all([
    ctx.supabase.from("product_variants").select("*").eq("product_id", id).order("name"),
    ctx.supabase.from("product_images").select("*").eq("product_id", id).order("position"),
    ctx.supabase.from("product_compatible_printers").select("printer_id").eq("product_id", id),
    ctx.supabase.from("order_items").select("quantity, line_total, orders!inner(status)").eq("product_id", id).neq("orders.status", "cancelled"),
  ]);
  const sales = (check(salesRows) ?? []) as unknown as { quantity: number; line_total: number }[];
  return {
    product,
    variants: check(variants) as ProductVariant[],
    images: check(images) as ProductImage[],
    compatiblePrinterIds: (check(compat) as { printer_id: string }[]).map((r) => r.printer_id),
    unitsSold: sales.reduce((s, r) => s + r.quantity, 0),
    revenue: Math.round(sales.reduce((s, r) => s + Number(r.line_total), 0) * 100) / 100,
  };
}

function productRow(ctx: AppContext, input: ProductInput) {
  const { compatible_printer_ids: _ignored, ...fields } = input;
  void _ignored;
  const cost = productUnitCost(fields, ctx.settings).total;
  return { ...fields, cost_price: cost };
}

async function setCompatiblePrinters(ctx: AppContext, productId: string, printerIds: string[]) {
  check(await ctx.supabase.from("product_compatible_printers").delete().eq("product_id", productId));
  const unique = [...new Set(printerIds)];
  if (unique.length) {
    check(
      await ctx.supabase
        .from("product_compatible_printers")
        .insert(unique.map((printer_id) => ({ product_id: productId, printer_id, organization_id: ctx.orgId }))),
    );
  }
}

export async function createProduct(ctx: AppContext, input: ProductInput, opts: { isDemo?: boolean } = {}) {
  const product = check(
    await ctx.supabase
      .from("products")
      .insert({ ...productRow(ctx, input), organization_id: ctx.orgId, is_demo: opts.isDemo ?? false })
      .select("*")
      .single(),
  ) as Product;
  await setCompatiblePrinters(ctx, product.id, input.compatible_printer_ids);
  await logAudit(ctx, "product.created", { type: "product", id: product.id }, `Product ${product.sku} created`, {
    sku: product.sku,
    cost_price: product.cost_price,
  });
  return product;
}

export async function updateProduct(ctx: AppContext, id: string, input: ProductInput) {
  const product = checkFound(
    await ctx.supabase
      .from("products")
      .update(productRow(ctx, input))
      .eq("id", id)
      .eq("organization_id", ctx.orgId)
      .select("*")
      .maybeSingle(),
    "Product",
  ) as Product;
  await setCompatiblePrinters(ctx, id, input.compatible_printer_ids);
  await logAudit(ctx, "product.updated", { type: "product", id }, `Product ${product.sku} updated`, {
    cost_price: product.cost_price,
    selling_price: product.selling_price,
  });
  return product;
}

export async function setProductArchived(ctx: AppContext, id: string, archived: boolean) {
  const product = checkFound(
    await ctx.supabase
      .from("products")
      .update({ archived_at: archived ? new Date().toISOString() : null, is_active: !archived })
      .eq("id", id)
      .eq("organization_id", ctx.orgId)
      .select("id, sku")
      .maybeSingle(),
    "Product",
  ) as Pick<Product, "id" | "sku">;
  await logAudit(
    ctx,
    archived ? "product.archived" : "product.restored",
    { type: "product", id },
    `Product ${product.sku} ${archived ? "archived" : "restored"}`,
  );
}

// ---------------------------------------------------------------- variants

export async function saveVariant(ctx: AppContext, productId: string, variantId: string | null, input: VariantInput) {
  if (variantId) {
    checkFound(
      await ctx.supabase
        .from("product_variants")
        .update(input)
        .eq("id", variantId)
        .eq("product_id", productId)
        .select("id")
        .maybeSingle(),
      "Variant",
    );
  } else {
    check(
      await ctx.supabase
        .from("product_variants")
        .insert({ ...input, product_id: productId, organization_id: ctx.orgId })
        .select("id")
        .single(),
    );
  }
  await logAudit(ctx, "product.updated", { type: "product", id: productId }, `Variant ${input.sku} ${variantId ? "updated" : "added"}`);
}

export async function deleteVariant(ctx: AppContext, productId: string, variantId: string) {
  // Variants referenced by orders are deactivated instead of deleted.
  const { count } = await ctx.supabase
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("variant_id", variantId);
  if (count && count > 0) {
    check(await ctx.supabase.from("product_variants").update({ is_active: false }).eq("id", variantId));
    await logAudit(ctx, "product.updated", { type: "product", id: productId }, "Variant deactivated (used by orders)");
    return "deactivated" as const;
  }
  check(await ctx.supabase.from("product_variants").delete().eq("id", variantId).eq("product_id", productId));
  await logAudit(ctx, "product.updated", { type: "product", id: productId }, "Variant deleted");
  return "deleted" as const;
}

// ---------------------------------------------------------------- images

const IMAGE_BUCKET = "product-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function addProductImageFromFile(ctx: AppContext, productId: string, file: File) {
  if (!IMAGE_TYPES.includes(file.type)) throw new AppError("Upload a JPEG, PNG, WebP or GIF image.", "validation");
  if (file.size > MAX_IMAGE_BYTES) throw new AppError("Images must be 5 MB or smaller.", "validation");
  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${ctx.orgId}/${productId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await ctx.supabase.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type });
  if (error) {
    console.error("[storage]", error);
    throw new AppError("The image could not be uploaded. Check that the product-images bucket exists.");
  }
  const { data } = ctx.supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return insertImage(ctx, productId, data.publicUrl, path);
}

export async function addProductImageFromUrl(ctx: AppContext, productId: string, url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("Enter a valid image URL.", "validation");
  }
  if (parsed.protocol !== "https:") throw new AppError("Image URLs must use https.", "validation");
  return insertImage(ctx, productId, parsed.toString(), null);
}

async function insertImage(ctx: AppContext, productId: string, url: string, storagePath: string | null) {
  const { count } = await ctx.supabase
    .from("product_images")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);
  check(
    await ctx.supabase.from("product_images").insert({
      organization_id: ctx.orgId,
      product_id: productId,
      url,
      storage_path: storagePath,
      position: count ?? 0,
    }),
  );
  await logAudit(ctx, "product.updated", { type: "product", id: productId }, "Product image added");
}

export async function removeProductImage(ctx: AppContext, productId: string, imageId: string) {
  const image = checkFound(
    await ctx.supabase.from("product_images").select("*").eq("id", imageId).eq("product_id", productId).maybeSingle(),
    "Image",
  ) as ProductImage;
  if (image.storage_path) await ctx.supabase.storage.from(IMAGE_BUCKET).remove([image.storage_path]);
  check(await ctx.supabase.from("product_images").delete().eq("id", imageId));
  await logAudit(ctx, "product.updated", { type: "product", id: productId }, "Product image removed");
}

export async function makePrimaryImage(ctx: AppContext, productId: string, imageId: string) {
  const images = check(
    await ctx.supabase.from("product_images").select("id, position").eq("product_id", productId).order("position"),
  ) as Pick<ProductImage, "id" | "position">[];
  const ordered = [imageId, ...images.map((i) => i.id).filter((id) => id !== imageId)];
  for (const [position, id] of ordered.entries()) {
    check(await ctx.supabase.from("product_images").update({ position }).eq("id", id));
  }
}

export async function listPrinterOptions(ctx: AppContext) {
  return check(
    await ctx.supabase
      .from("printers")
      .select("id, name, model, status, connection_mode")
      .eq("organization_id", ctx.orgId)
      .is("archived_at", null)
      .order("name"),
  ) as Pick<Printer, "id" | "name" | "model" | "status" | "connection_mode">[];
}
