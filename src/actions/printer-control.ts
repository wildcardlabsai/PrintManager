"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  acknowledgeFailure,
  cancelPendingStart,
  confirmBedClear,
  confirmChecklistStep,
  controlJobOnPrinter,
  dismissAttention,
  getCommand,
  markPrinterVerified,
  previewDispatch,
  requestPrinterCheck,
  resetPrinterVerification,
  retryJob,
  reviewPrint,
  sendJobToPrinter,
  sendTestPrint,
} from "@/lib/services/printers/control";
import { parse, run } from "./_run";

function refresh(ids: { jobId?: string | null; printerId?: string | null } = {}) {
  revalidatePath("/production");
  revalidatePath("/printers");
  revalidatePath("/dashboard");
  revalidatePath("/orders");
  if (ids.jobId) revalidatePath(`/production/${ids.jobId}`);
  if (ids.printerId) revalidatePath(`/printers/${ids.printerId}`);
}

const mapping = z.object({
  toolId: z.number().int().min(0).max(15),
  slotId: z.number().int().min(1).max(16),
  materialName: z.string().max(60),
  toolMaterialColor: z.string().max(40),
  slotMaterialColor: z.string().max(40),
});

const sendInput = z.object({
  printerId: z.uuid(),
  printFileId: z.uuid(),
  options: z.object({
    levelingBeforePrint: z.boolean(),
    flowCalibration: z.boolean(),
    firstLayerInspection: z.boolean(),
    timeLapseVideo: z.boolean(),
  }),
  materialMappings: z.array(mapping).max(16),
  acknowledgedWarnings: z.array(z.string().max(500)).max(30),
});

const previewInput = z.object({
  jobId: z.uuid().nullable(),
  printerId: z.uuid(),
  printFileId: z.uuid().nullable(),
  mappings: z.array(mapping).max(16),
  testPrint: z.boolean().optional(),
});

export async function previewDispatchAction(input: unknown) {
  return run((ctx) => {
    const i = parse(previewInput, input);
    return previewDispatch(ctx, { jobId: i.jobId, printerId: i.printerId, printFileId: i.printFileId, mappings: i.mappings, testPrint: i.testPrint });
  }, undefined, { allowViewer: true });
}

export async function sendJobToPrinterAction(jobId: string, input: unknown) {
  return run(async (ctx) => {
    const id = parse(z.uuid(), jobId);
    const i = parse(sendInput, input);
    const res = await sendJobToPrinter(ctx, id, i);
    refresh({ jobId: id, printerId: i.printerId });
    return res;
  }, "Sent to the Printer Agent — waiting for the printer");
}

export async function sendTestPrintAction(input: unknown) {
  return run(async (ctx) => {
    const i = parse(sendInput, input);
    const res = await sendTestPrint(ctx, i);
    refresh({ printerId: i.printerId });
    return res;
  }, "Test print sent to the Printer Agent");
}

export async function controlJobAction(jobId: string, action: string, confirmed: boolean) {
  return run(async (ctx) => {
    const id = parse(z.uuid(), jobId);
    const a = parse(z.enum(["pause", "resume", "stop"]), action);
    const res = await controlJobOnPrinter(ctx, id, a, confirmed === true);
    refresh({ jobId: id });
    return res;
  }, "Command sent to the printer");
}

export async function printerCheckAction(printerId: string, type: string) {
  return run(async (ctx) => {
    const id = parse(z.uuid(), printerId);
    const res = await requestPrinterCheck(ctx, id, parse(z.enum(["refresh", "test_connection"]), type));
    refresh({ printerId: id });
    return res;
  });
}

export async function commandStatusAction(commandId: string) {
  return run((ctx) => getCommand(ctx, parse(z.uuid(), commandId)), undefined, { allowViewer: true });
}

export async function cancelPendingStartAction(jobId: string) {
  return run(async (ctx) => {
    const id = parse(z.uuid(), jobId);
    await cancelPendingStart(ctx, id);
    refresh({ jobId: id });
  }, "Send cancelled");
}

export async function confirmBedClearAction(printerId: string, tellPrinter: boolean) {
  return run(async (ctx) => {
    const id = parse(z.uuid(), printerId);
    await confirmBedClear(ctx, id, tellPrinter === true);
    refresh({ printerId: id });
  }, "Build plate confirmed clear");
}

export async function retryJobAction(jobId: string, printerId: string | null) {
  return run(async (ctx) => {
    const id = parse(z.uuid(), jobId);
    await retryJob(ctx, id, printerId === null ? null : parse(z.uuid(), printerId));
    refresh({ jobId: id });
  }, "Job queued again — send it when the printer is ready");
}

const failInput = z.object({
  reason: z.string().trim().max(500).nullish().transform((v) => v || null),
  wasteGrams: z.coerce.number().min(0).max(100000).nullish().transform((v) => v ?? null),
  wasteFilamentId: z
    .union([z.literal(""), z.null(), z.undefined(), z.uuid()])
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function markFailedAction(jobId: string, input: unknown) {
  return run(async (ctx) => {
    const id = parse(z.uuid(), jobId);
    await acknowledgeFailure(ctx, id, parse(failInput, input));
    refresh({ jobId: id });
  }, "Marked failed");
}

export async function dismissAttentionAction(jobId: string) {
  return run(async (ctx) => {
    const id = parse(z.uuid(), jobId);
    await dismissAttention(ctx, id);
    refresh({ jobId: id });
  }, "Alert dismissed");
}

const reviewInput = z.object({
  filamentId: z
    .union([z.literal(""), z.null(), z.undefined(), z.uuid()])
    .optional()
    .transform((v) => (v ? v : null)),
  actualGrams: z.coerce.number().min(0).max(100000).nullish().transform((v) => v ?? null),
  printOk: z.boolean(),
  markFileProven: z.boolean(),
  notes: z.string().trim().max(2000).nullish().transform((v) => v || null),
});

export async function reviewPrintAction(jobId: string, input: unknown) {
  return run(async (ctx) => {
    const id = parse(z.uuid(), jobId);
    await reviewPrint(ctx, id, parse(reviewInput, input));
    refresh({ jobId: id });
    revalidatePath("/filament");
    revalidatePath("/print-files");
  }, "Print reviewed");
}

export async function confirmChecklistStepAction(printerId: string, key: string, note: string | null) {
  return run(async (ctx) => {
    const id = parse(z.uuid(), printerId);
    await confirmChecklistStep(ctx, id, parse(z.string().max(40), key), note ? parse(z.string().max(500), note) : null);
    refresh({ printerId: id });
  }, "Checklist updated");
}

export async function markPrinterVerifiedAction(printerId: string) {
  return run(async (ctx) => {
    const id = parse(z.uuid(), printerId);
    await markPrinterVerified(ctx, id);
    refresh({ printerId: id });
  }, "Printer verified for production");
}

export async function resetPrinterVerificationAction(printerId: string) {
  return run(async (ctx) => {
    const id = parse(z.uuid(), printerId);
    await resetPrinterVerification(ctx, id);
    refresh({ printerId: id });
  }, "Checklist reset");
}
