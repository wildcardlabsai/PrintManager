"use client";

import { DatabaseIcon, Trash2Icon } from "lucide-react";
import { clearDemoDataAction, loadDemoDataAction } from "@/actions/settings";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";

export function DemoDataPanel({ loaded }: { loaded: boolean }) {
  const { execute } = useAction();
  return loaded ? (
    <ConfirmButton
      title="Remove all demo data?"
      description="Deletes every record marked Demo: sample orders (with their jobs and shipments), products, customers and filament spools. Your own records are not touched."
      confirmLabel="Remove demo data"
      destructive
      onConfirm={() => execute(() => clearDemoDataAction())}
      trigger={
        <Button variant="outline" size="sm">
          <Trash2Icon /> Remove demo data
        </Button>
      }
    />
  ) : (
    <ConfirmButton
      title="Load demo data?"
      description="Adds 13 sample products, 10 customers, 18 orders across Etsy, eBay, Facebook and manual, production jobs in every state, and 8 filament spools. All clearly marked Demo."
      confirmLabel="Load demo data"
      onConfirm={() => execute(() => loadDemoDataAction())}
      trigger={
        <Button variant="outline" size="sm">
          <DatabaseIcon /> Load demo data
        </Button>
      }
    />
  );
}
