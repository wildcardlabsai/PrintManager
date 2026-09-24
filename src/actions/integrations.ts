"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { describeIntegrationError } from "@/lib/integrations/errors";
import { platformMissingConfig } from "@/lib/integrations/config";
import { royalMailClickDrop } from "@/lib/integrations/shipping/royal-mail-click-drop";
import { logAudit } from "@/lib/services/audit";
import { requireAdminRole } from "@/lib/services/context";
import { AppError } from "@/lib/services/errors";
import { disconnect, getConnection, saveApiKeyConnection } from "@/lib/services/integrations/credentials";
import { pushOrderFulfillment } from "@/lib/services/integrations/fulfillment";
import { createShippingLabel, refreshLabelTracking } from "@/lib/services/integrations/labels";
import { deleteMapping, mapExternalLine, retryExternalImport } from "@/lib/services/integrations/mappings";
import { runMarketplaceSync } from "@/lib/services/integrations/sync";
import { PROVIDER_NAMES } from "@/lib/integrations/registry";
import { parse, run } from "./_run";

const marketplace = z.enum(["etsy", "ebay"]);
const anyProvider = z.enum(["etsy", "ebay", "royal_mail_click_drop"]);

function refreshIntegrationPages() {
  revalidatePath("/settings/integrations", "layout");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/production");
}

export async function syncNowAction(provider: string) {
  return run(async (ctx) => {
    const p = parse(marketplace, provider);
    const conn = await getConnection(ctx.orgId, p);
    if (!conn || conn.status === "disconnected") throw new AppError(`${PROVIDER_NAMES[p]} is not connected.`, "validation");
    const summary = await runMarketplaceSync(ctx, conn, "manual");
    refreshIntegrationPages();
    if (summary.status === "failed") throw new AppError(summary.message, "validation");
    return summary;
  });
}

export async function disconnectAction(provider: string) {
  return run(async (ctx) => {
    await requireAdminRole(ctx);
    const p = parse(anyProvider, provider);
    const conn = await disconnect(ctx.orgId, p);
    if (conn) {
      await ctx.supabase.from("integration_sync_logs").insert({
        organization_id: ctx.orgId,
        connection_id: conn.id,
        provider: p,
        operation: "disconnect",
        trigger: "manual",
        status: "success",
        completed_at: new Date().toISOString(),
        initiated_by: ctx.userId,
      });
      await logAudit(ctx, "settings.updated", { type: "integration", id: conn.id }, `${PROVIDER_NAMES[p]} disconnected`, { provider: p });
    }
    refreshIntegrationPages();
  }, "Disconnected. Stored credentials were deleted.");
}

const royalMailInput = z.object({
  apiKey: z.string().trim().min(10, "Paste your Click & Drop API key").max(500),
  oba: z.boolean().default(false),
});

export async function connectRoyalMailAction(input: unknown) {
  return run(async (ctx) => {
    await requireAdminRole(ctx);
    const missing = platformMissingConfig();
    if (missing.length) throw new AppError(`Missing server configuration: ${missing.join(", ")}`, "validation");
    const data = parse(royalMailInput, input);
    try {
      const { accountLabel } = await royalMailClickDrop.testConnection({ apiKey: data.apiKey, config: { oba: data.oba } });
      const conn = await saveApiKeyConnection({
        orgId: ctx.orgId,
        userId: ctx.userId!,
        provider: "royal_mail_click_drop",
        apiKey: data.apiKey,
        accountName: accountLabel,
        config: { oba: data.oba },
      });
      await logAudit(ctx, "settings.updated", { type: "integration", id: conn.id }, "Royal Mail Click & Drop connected", {});
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(describeIntegrationError(e, "Royal Mail"), "validation");
    }
    refreshIntegrationPages();
  }, "Royal Mail Click & Drop connected");
}

const mapInput = z.object({
  externalOrderRowId: z.uuid(),
  externalLineId: z.string().min(1).max(120),
  productId: z.uuid(),
  variantId: z
    .union([z.literal(""), z.null(), z.undefined(), z.uuid()])
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function mapLineAction(input: unknown) {
  return run(async (ctx) => {
    await mapExternalLine(ctx, parse(mapInput, input));
    refreshIntegrationPages();
  }, "Mapping saved");
}

export async function retryImportAction(externalOrderRowId: string) {
  return run(async (ctx) => {
    const outcome = await retryExternalImport(ctx, parse(z.uuid(), externalOrderRowId));
    refreshIntegrationPages();
    return outcome;
  });
}

export async function deleteMappingAction(id: string) {
  return run(async (ctx) => {
    await deleteMapping(ctx, parse(z.uuid(), id));
    refreshIntegrationPages();
  }, "Mapping removed");
}

export async function sendTrackingToMarketplaceAction(orderId: string) {
  return run(async (ctx) => {
    const res = await pushOrderFulfillment(ctx, parse(z.uuid(), orderId));
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/settings/integrations", "layout");
    if (res.status === "failed") throw new AppError(res.error, "validation");
    return res;
  });
}

const labelInput = z.object({
  orderId: z.uuid(),
  weightGrams: z.coerce.number({ error: "Enter the package weight" }).int().positive("Enter the package weight").max(30000),
  format: z.enum(["letter", "largeLetter", "smallParcel", "mediumParcel", "parcel"]),
  lengthMm: z.coerce.number().int().positive().max(2000).nullish().catch(null),
  widthMm: z.coerce.number().int().positive().max(2000).nullish().catch(null),
  heightMm: z.coerce.number().int().positive().max(2000).nullish().catch(null),
  serviceCode: z.string().trim().max(10).nullish().transform((v) => (v ? v : null)),
  confirmed: z.literal(true, { error: "Confirm that you want to create a real shipment with the carrier." }),
  allowAdditional: z.boolean().default(false),
});

export async function createLabelAction(input: unknown) {
  return run(async (ctx) => {
    const d = parse(labelInput, input);
    const result = await createShippingLabel(ctx, d.orderId, {
      weightGrams: d.weightGrams,
      format: d.format as never,
      lengthMm: d.lengthMm ?? null,
      widthMm: d.widthMm ?? null,
      heightMm: d.heightMm ?? null,
      serviceCode: d.serviceCode,
      allowAdditional: d.allowAdditional,
    });
    revalidatePath(`/orders/${d.orderId}`);
    revalidatePath("/shipping");
    return { labelStatus: result.labelStatus, trackingNumber: result.trackingNumber, message: result.message, externalShipmentId: result.externalShipmentId };
  });
}

export async function refreshTrackingAction(orderId: string) {
  return run(async (ctx) => {
    const t = await refreshLabelTracking(ctx, parse(z.uuid(), orderId));
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/shipping");
    return t;
  });
}
