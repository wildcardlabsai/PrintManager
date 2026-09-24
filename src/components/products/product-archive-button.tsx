"use client";

import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react";
import { archiveProductAction } from "@/actions/products";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";

export function ProductArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const { execute } = useAction();
  if (archived)
    return (
      <Button variant="outline" size="sm" onClick={() => execute(() => archiveProductAction(id, false))}>
        <ArchiveRestoreIcon /> Restore
      </Button>
    );
  return (
    <ConfirmButton
      title="Archive this product?"
      description="It will be hidden from the order form and product list. Existing orders keep their details. You can restore it later."
      confirmLabel="Archive"
      destructive
      onConfirm={() => execute(() => archiveProductAction(id, true))}
      trigger={
        <Button variant="outline" size="sm">
          <ArchiveIcon /> Archive
        </Button>
      }
    />
  );
}
