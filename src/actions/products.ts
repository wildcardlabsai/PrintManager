"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addProductImageFromFile,
  addProductImageFromUrl,
  createProduct,
  deleteVariant,
  makePrimaryImage,
  removeProductImage,
  saveVariant,
  setProductArchived,
  updateProduct,
} from "@/lib/services/products";
import { AppError } from "@/lib/services/errors";
import { productSchema, variantSchema } from "@/lib/validation/schemas";
import { parse, run } from "./_run";

const uuid = z.uuid();

function refresh(id?: string) {
  revalidatePath("/products");
  if (id) revalidatePath(`/products/${id}`);
}

export async function createProductAction(input: unknown) {
  return run(async (ctx) => {
    const product = await createProduct(ctx, parse(productSchema, input));
    refresh();
    return { id: product.id };
  }, "Product created");
}

export async function updateProductAction(id: string, input: unknown) {
  return run(async (ctx) => {
    await updateProduct(ctx, parse(uuid, id), parse(productSchema, input));
    refresh(id);
  }, "Product saved");
}

export async function archiveProductAction(id: string, archived: boolean) {
  return run(async (ctx) => {
    await setProductArchived(ctx, parse(uuid, id), archived);
    refresh(id);
  }, archived ? "Product archived" : "Product restored");
}

export async function saveVariantAction(productId: string, variantId: string | null, input: unknown) {
  return run(async (ctx) => {
    await saveVariant(ctx, parse(uuid, productId), variantId ? parse(uuid, variantId) : null, parse(variantSchema, input));
    refresh(productId);
  }, "Variant saved");
}

export async function deleteVariantAction(productId: string, variantId: string) {
  return run(async (ctx) => {
    const result = await deleteVariant(ctx, parse(uuid, productId), parse(uuid, variantId));
    refresh(productId);
    return result;
  });
}

export async function uploadProductImageAction(productId: string, formData: FormData) {
  return run(async (ctx) => {
    const file = formData.get("file");
    const url = formData.get("url");
    if (file instanceof File && file.size > 0) await addProductImageFromFile(ctx, parse(uuid, productId), file);
    else if (typeof url === "string" && url.trim()) await addProductImageFromUrl(ctx, parse(uuid, productId), url.trim());
    else throw new AppError("Choose an image file or enter an image URL.", "validation");
    refresh(productId);
  }, "Image added");
}

export async function removeProductImageAction(productId: string, imageId: string) {
  return run(async (ctx) => {
    await removeProductImage(ctx, parse(uuid, productId), parse(uuid, imageId));
    refresh(productId);
  }, "Image removed");
}

export async function makePrimaryImageAction(productId: string, imageId: string) {
  return run(async (ctx) => {
    await makePrimaryImage(ctx, parse(uuid, productId), parse(uuid, imageId));
    refresh(productId);
  }, "Primary image updated");
}
