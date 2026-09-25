"use server";

import { z } from "zod";
import { listNotifications, markNotificationsRead } from "@/lib/services/notifications";
import { parse, run } from "./_run";

export async function notificationsAction() {
  return run((ctx) => listNotifications(ctx), undefined, { allowViewer: true });
}

export async function markNotificationsReadAction(ids: string[]) {
  return run((ctx) => markNotificationsRead(ctx, parse(z.array(z.uuid()).max(100), ids)), undefined, { allowViewer: true });
}
