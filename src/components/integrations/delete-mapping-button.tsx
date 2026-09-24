"use client";

import { Trash2Icon } from "lucide-react";
import { deleteMappingAction } from "@/actions/integrations";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";

export function DeleteMappingButton({ id }: { id: string }) {
  const { execute } = useAction();
  return (
    <ConfirmButton
      title="Remove this mapping?"
      description="Future orders for this listing will need a SKU match or a new mapping. Existing orders are not changed."
      confirmLabel="Remove"
      destructive
      onConfirm={() => execute(() => deleteMappingAction(id))}
      trigger={
        <Button size="icon-sm" variant="ghost" aria-label="Remove mapping">
          <Trash2Icon />
        </Button>
      }
    />
  );
}
