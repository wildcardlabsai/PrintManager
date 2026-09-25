"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setMemberRole } from "@/lib/services/team";
import { parse, run } from "./_run";

export async function setMemberRoleAction(userId: string, role: string) {
  return run(async (ctx) => {
    await setMemberRole(ctx, parse(z.uuid(), userId), parse(z.enum(["admin", "staff", "viewer"]), role));
    revalidatePath("/settings/team");
  }, "Role updated");
}
