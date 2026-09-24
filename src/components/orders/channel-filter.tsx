"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SALES_CHANNEL_LABELS } from "@/lib/domain/labels";
import { SALES_CHANNELS } from "@/types/db";

export function ChannelFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get("channel") ?? "all";
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const sp = new URLSearchParams(params.toString());
        if (v === "all") sp.delete("channel");
        else sp.set("channel", v);
        sp.delete("page");
        router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`);
      }}
    >
      <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Sales channel">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All channels</SelectItem>
        {SALES_CHANNELS.map((c) => (
          <SelectItem key={c} value={c}>
            {SALES_CHANNEL_LABELS[c]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
