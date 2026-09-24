"use client";

import { useState } from "react";
import { Loader2Icon, RotateCwIcon } from "lucide-react";
import { toast } from "sonner";
import { mapLineAction, retryImportAction } from "@/actions/integrations";
import { Combobox, type ComboboxOption } from "@/components/shared/combobox";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";

export function MapLineForm({ rowId, lineId, options, label }: { rowId: string; lineId: string; options: ComboboxOption[]; label: string }) {
  const [value, setValue] = useState<string | null>(null);
  const { pending, execute } = useAction();
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Combobox
        id={`map-${rowId}-${lineId}`}
        options={options}
        value={value}
        onChange={setValue}
        placeholder="Choose PrintFlow product…"
        searchPlaceholder="Product name or SKU"
        className="sm:w-80"
      />
      <Button
        size="sm"
        disabled={!value || pending}
        aria-label={`Save mapping for ${label}`}
        onClick={() => {
          const [productId, variantId] = value!.split("|");
          execute(() => mapLineAction({ externalOrderRowId: rowId, externalLineId: lineId, productId, variantId: variantId || null }));
        }}
      >
        {pending && <Loader2Icon className="animate-spin" />} Save mapping
      </Button>
    </div>
  );
}

export function RetryImportButton({ rowId }: { rowId: string }) {
  const { pending, execute } = useAction();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        execute(() => retryImportAction(rowId), {
          onSuccess: (o) => {
            if (o.outcome === "created") toast.success(`Order ${o.orderNumber} created with production jobs`);
            else if (o.outcome === "skipped") toast.warning(o.note);
            else toast.success("Order is up to date");
          },
        })
      }
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />} Retry import
    </Button>
  );
}
