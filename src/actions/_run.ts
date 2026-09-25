import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError, type ZodType } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireActionContext, type AppContext } from "@/lib/services/context";
import { AppError } from "@/lib/services/errors";

function zodFieldErrors(error: ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/**
 * Runs a server action body with the user's context and converts failures
 * into a user-friendly ActionResult. Framework control flow (redirect,
 * notFound) is re-thrown.
 */
export async function run<T>(
  fn: (ctx: AppContext) => Promise<T>,
  message?: string,
  opts: { allowViewer?: boolean } = {},
): Promise<ActionResult<T>> {
  try {
    const ctx = await requireActionContext();
    // Viewers are read-only everywhere (RLS enforces the same in the database).
    if (ctx.role === "viewer" && !opts.allowViewer) {
      throw new AppError("You have view-only access. Ask an operator or admin to make this change.", "forbidden");
    }
    const data = await fn(ctx);
    return { ok: true, data, message };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ZodError) {
      const fieldErrors = zodFieldErrors(error);
      return { ok: false, error: Object.values(fieldErrors)[0] ?? "Check the form and try again.", fieldErrors };
    }
    if (error instanceof AppError) return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    console.error("[action]", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export function parse<S extends ZodType>(schema: S, input: unknown) {
  return schema.parse(input) as ReturnType<S["parse"]>;
}
