"use client";

import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react";
import { archiveCustomerAction } from "@/actions/customers";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";

export function CustomerArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const { execute } = useAction();
  if (archived) {
    return (
      <Button variant="outline" size="sm" onClick={() => execute(() => archiveCustomerAction(id, false))}>
        <ArchiveRestoreIcon /> Restore
      </Button>
    );
  }
  return (
    <ConfirmButton
      title="Archive this customer?"
      description="Archived customers are hidden from lists and the order form. Their order history is kept and you can restore them at any time."
      confirmLabel="Archive"
      destructive
      onConfirm={() => execute(() => archiveCustomerAction(id, true))}
      trigger={
        <Button variant="outline" size="sm">
          <ArchiveIcon /> Archive
        </Button>
      }
    />
  );
}
