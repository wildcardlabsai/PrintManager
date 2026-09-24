"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ORDER_STATUSES } from "@/types/db";
import { changeOrderStatus, createOrder, updateOrderDetails } from "@/lib/services/orders";
import { orderCreateSchema, orderDetailsSchema } from "@/lib/validation/schemas";
import { parse, run } from "./_run";

function refresh(orderId?: string) {
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/production");
  revalidatePath("/shipping");
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

export async function createOrderAction(input: unknown) {
  return run(async (ctx) => {
    const order = await createOrder(ctx, parse(orderCreateSchema, input));
    refresh();
    revalidatePath("/customers");
    return order;
  });
}

const statusInput = z.object({
  orderId: z.uuid(),
  status: z.union([z.enum(ORDER_STATUSES), z.literal("resume")]),
  note: z.string().trim().max(500).nullish(),
});

export async function changeOrderStatusAction(input: unknown) {
  return run(async (ctx) => {
    const { orderId, status, note } = parse(statusInput, input);
    const order = await changeOrderStatus(ctx, orderId, status, note ?? null);
    refresh(orderId);
    return { status: order.status };
  });
}

export async function updateOrderDetailsAction(orderId: string, input: unknown) {
  return run(async (ctx) => {
    await updateOrderDetails(ctx, parse(z.uuid(), orderId), parse(orderDetailsSchema, input));
    refresh(orderId);
  }, "Order updated");
}
