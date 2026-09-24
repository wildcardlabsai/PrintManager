"use client";

import { useCallback, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

/**
 * Runs a server action in a transition and reports the outcome with a toast.
 * Returns the result so callers can close dialogs or navigate.
 */
export function useAction() {
  const [pending, startTransition] = useTransition();

  const execute = useCallback(
    <T,>(
      fn: () => Promise<ActionResult<T>>,
      opts: { success?: string | ((data: T) => string); onSuccess?: (data: T) => void; onError?: (r: ActionResult<T>) => void } = {},
    ) =>
      new Promise<ActionResult<T>>((resolve) => {
        startTransition(async () => {
          let result: ActionResult<T>;
          try {
            result = await fn();
          } catch (e) {
            console.error(e);
            result = { ok: false, error: "Could not reach the server. Check your connection and try again." };
          }
          if (result.ok) {
            const message = typeof opts.success === "function" ? opts.success(result.data) : opts.success ?? result.message;
            if (message) toast.success(message);
            opts.onSuccess?.(result.data);
          } else {
            toast.error(result.error);
            opts.onError?.(result);
          }
          resolve(result);
        });
      }),
    [],
  );

  return { pending, execute };
}
