"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createCustomer, setCustomerArchived, updateCustomer } from "@/lib/services/customers";
import { customerSchema } from "@/lib/validation/schemas";
import { parse, run } from "./_run";

export async function createCustomerAction(input: unknown) {
  return run(async (ctx) => {
    const customer = await createCustomer(ctx, parse(customerSchema, input));
    revalidatePath("/customers");
    return { id: customer.id, name: customer.name };
  }, "Customer created");
}

export async function updateCustomerAction(id: string, input: unknown) {
  return run(async (ctx) => {
    await updateCustomer(ctx, parse(z.uuid(), id), parse(customerSchema, input));
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
  }, "Customer saved");
}

export async function archiveCustomerAction(id: string, archived: boolean) {
  return run(async (ctx) => {
    await setCustomerArchived(ctx, parse(z.uuid(), id), archived);
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
  }, archived ? "Customer archived" : "Customer restored");
}
