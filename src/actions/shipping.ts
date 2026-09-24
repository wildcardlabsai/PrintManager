"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { pushOrderFulfillment } from "@/lib/services/integrations/fulfillment";
import { markOrderShipped, updateShipment } from "@/lib/services/shipping";
import { shipmentSchema } from "@/lib/validation/schemas";
import { parse, run } from "./_run";

function refresh(orderId: string) {
  revalidatePath("/shipping");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath(`/orders/${orderId}`);
}

export async function updateShipmentAction(orderId: string, input: unknown) {
  return run(async (ctx) => {
    await updateShipment(ctx, parse(z.uuid(), orderId), parse(shipmentSchema, input));
    refresh(orderId);
  }, "Shipping details saved");
}

/**
 * Marks the order shipped. When `sendToMarketplace` is set (the user ticked the
 * box in the dialog), tracking is then pushed to Etsy/eBay; the result is
 * reported separately so a marketplace failure never hides the local update.
 */
export async function markShippedAction(orderId: string, input: unknown, sendToMarketplace = false) {
  return run(async (ctx) => {
    const id = parse(z.uuid(), orderId);
    await markOrderShipped(ctx, id, parse(shipmentSchema, input));
    let marketplace: { status: "synced" | "failed" | "not_sent"; error?: string } = { status: "not_sent" };
    if (sendToMarketplace) {
      try {
        const res = await pushOrderFulfillment(ctx, id);
        marketplace = res.status === "synced" ? { status: "synced" } : { status: "failed", error: res.error };
      } catch (e) {
        marketplace = { status: "failed", error: e instanceof Error ? e.message : "Could not send tracking" };
      }
    }
    refresh(id);
    return { marketplace };
  });
}
