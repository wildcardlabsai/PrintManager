"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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

export async function markShippedAction(orderId: string, input: unknown) {
  return run(async (ctx) => {
    await markOrderShipped(ctx, parse(z.uuid(), orderId), parse(shipmentSchema, input));
    refresh(orderId);
  }, "Order marked as shipped");
}
