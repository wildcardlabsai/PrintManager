"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { commandStatusAction } from "@/actions/printer-control";

const LABELS: Record<string, string> = {
  start_print: "Start print",
  pause: "Pause",
  resume: "Resume",
  stop: "Stop",
  refresh: "Refresh",
  test_connection: "Connection test",
  clear_platform: "Clear plate",
};

/**
 * Follows a queued printer command until the Printer Agent reports back, then
 * tells the user what actually happened on the printer.
 */
export function useCommandWatch() {
  const router = useRouter();
  const [watching, setWatching] = useState<string | null>(null);

  const watch = useCallback(
    async (commandId: string, opts: { timeoutMs?: number; quietSuccess?: boolean } = {}) => {
      setWatching(commandId);
      const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
      try {
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          const r = await commandStatusAction(commandId);
          if (!r.ok) break;
          const c = r.data;
          const label = LABELS[c.type] ?? c.type;
          if (c.status === "succeeded") {
            if (!opts.quietSuccess) {
              const latency = typeof c.result?.latencyMs === "number" ? ` (${c.result.latencyMs} ms)` : "";
              toast.success(`${label}: done on the printer${latency}`);
            }
            router.refresh();
            return c;
          }
          if (c.status === "failed" || c.status === "expired" || c.status === "cancelled") {
            toast.error(`${label} ${c.status === "failed" ? "failed" : c.status}: ${c.error ?? c.error_code ?? "no details"}`);
            router.refresh();
            return c;
          }
        }
        toast.message("Still waiting for the Printer Agent. The page will update when it reports back.");
        router.refresh();
        return null;
      } finally {
        setWatching(null);
      }
    },
    [router],
  );

  return { watch, watching };
}
