"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { JOB_PRIORITIES } from "@/types/db";
import {
  assignPrinter,
  moveJob,
  performJobAction,
  setJobPriority,
  updateJob,
} from "@/lib/services/production";
import { jobCompleteSchema, jobUpdateSchema } from "@/lib/validation/schemas";
import { parse, run } from "./_run";

function refresh(jobId?: string, orderId?: string | null) {
  revalidatePath("/production");
  revalidatePath("/dashboard");
  revalidatePath("/printers");
  revalidatePath("/orders");
  revalidatePath("/filament");
  if (jobId) revalidatePath(`/production/${jobId}`);
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

const actionInput = z.object({
  jobId: z.uuid(),
  orderId: z.uuid().nullish(),
  action: z.enum(["start", "pause", "resume", "complete", "fail", "cancel", "requeue"]),
  printerId: z.uuid().nullish(),
  complete: jobCompleteSchema.nullish(),
  failureReason: z.string().trim().max(500).nullish(),
  wasteGrams: z.coerce.number().min(0).max(100000).nullish(),
  wasteFilamentId: z
    .union([z.literal(""), z.null(), z.undefined(), z.uuid()]).optional()
    .transform((v) => (v ? v : null)),
});

const MESSAGES = {
  start: "Job started",
  pause: "Job paused",
  resume: "Job resumed",
  complete: "Job completed",
  fail: "Job marked as failed",
  cancel: "Job cancelled",
  requeue: "Job returned to the queue",
} as const;

export async function jobAction(input: unknown) {
  const parsed = actionInput.safeParse(input);
  const action = parsed.success ? parsed.data.action : "start";
  return run(async (ctx) => {
    const data = parse(actionInput, input);
    await performJobAction(ctx, data.jobId, data.action, {
      printerId: data.printerId ?? null,
      complete: data.complete ?? undefined,
      failureReason: data.failureReason ?? null,
      wasteGrams: data.wasteGrams ?? null,
      wasteFilamentId: data.wasteFilamentId,
    });
    refresh(data.jobId, data.orderId);
  }, MESSAGES[action]);
}

export async function assignPrinterAction(jobId: string, printerId: string | null) {
  return run(async (ctx) => {
    await assignPrinter(ctx, parse(z.uuid(), jobId), printerId ? parse(z.uuid(), printerId) : null);
    refresh(jobId);
  }, printerId ? "Printer assigned" : "Printer unassigned");
}

export async function updateJobAction(jobId: string, input: unknown) {
  return run(async (ctx) => {
    await updateJob(ctx, parse(z.uuid(), jobId), parse(jobUpdateSchema, input));
    refresh(jobId);
  }, "Job updated");
}

export async function setJobPriorityAction(jobId: string, priority: string) {
  return run(async (ctx) => {
    await setJobPriority(ctx, parse(z.uuid(), jobId), parse(z.enum(JOB_PRIORITIES), priority));
    refresh(jobId);
  }, "Priority updated");
}

export async function moveJobAction(jobId: string, direction: string) {
  return run(async (ctx) => {
    await moveJob(ctx, parse(z.uuid(), jobId), parse(z.enum(["up", "down", "next"]), direction));
    refresh(jobId);
  }, direction === "next" ? "Moved to the front of the queue" : "Queue updated");
}
