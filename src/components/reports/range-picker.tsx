"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REPORT_RANGES, REPORT_RANGE_LABELS, type ReportRangeKey } from "@/lib/domain/dates";
import { cn } from "@/lib/utils";

export function RangePicker({ active, from, to }: { active: ReportRangeKey; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [custom, setCustom] = useState({ from, to });
  const [showCustom, setShowCustom] = useState(active === "custom");

  const go = (range: ReportRangeKey, extra: Record<string, string> = {}) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("range", range);
    sp.delete("from");
    sp.delete("to");
    for (const [k, v] of Object.entries(extra)) sp.set(k, v);
    start(() => router.replace(`${pathname}?${sp}`));
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div role="group" aria-label="Date range" className="flex flex-wrap gap-1">
        {REPORT_RANGES.map((r) => (
          <Button
            key={r}
            size="xs"
            variant={(r === "custom" ? showCustom : active === r && !showCustom) ? "secondary" : "ghost"}
            aria-pressed={active === r}
            className={cn(active === r && "font-semibold")}
            onClick={() => (r === "custom" ? setShowCustom(true) : (setShowCustom(false), go(r)))}
          >
            {REPORT_RANGE_LABELS[r]}
          </Button>
        ))}
      </div>
      {showCustom && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            go("custom", custom);
          }}
        >
          <Input type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="h-8 w-36" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" aria-label="To" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="h-8 w-36" />
          <Button type="submit" size="sm" disabled={!custom.from || !custom.to}>
            Apply
          </Button>
        </form>
      )}
      {pending && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />}
    </div>
  );
}
