"use client";

import { setPrinterStatusAction } from "@/actions/printers";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { PRINTER_STATUS_META } from "@/lib/domain/labels";
import { MANUAL_PRINTER_STATUSES, type PrinterStatus } from "@/types/db";

export function PrinterStatusSelect({ id, status, name }: { id: string; status: PrinterStatus; name: string }) {
  const { pending, execute } = useAction();
  return (
    <Select value={status} disabled={pending} onValueChange={(v) => execute(() => setPrinterStatusAction(id, v))}>
      <SelectTrigger size="sm" className="w-36" aria-label={`Set status for ${name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MANUAL_PRINTER_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {PRINTER_STATUS_META[s].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
