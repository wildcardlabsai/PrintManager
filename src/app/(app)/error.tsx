"use client";

import { AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-20 text-center">
      <span className="inline-flex size-10 items-center justify-center rounded-full bg-red-50 text-red-700">
        <AlertTriangleIcon className="size-5" aria-hidden />
      </span>
      <h1 className="text-base font-semibold">Something went wrong loading this page</h1>
      <p className="text-sm text-muted-foreground">
        {/fetch failed|network/i.test(error.message)
          ? "We couldn't reach the database. Check your connection and try again."
          : "Please try again. If it keeps happening, reload the app."}
      </p>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">Ref {error.digest}</p>}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
