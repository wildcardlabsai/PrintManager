"use client";

import { TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Honest placeholder: no label is generated in Phase 1. */
export function CreateLabelButton({ size = "sm" }: { size?: "sm" | "xs" }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size={size}>
          <TagIcon /> Create shipping label
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Shipping labels arrive in Phase 2</DialogTitle>
          <DialogDescription>
            Shipping label integrations will be connected in Phase 2. No label has been created and no postage has been bought.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          For now, buy postage with your carrier (e.g. Royal Mail Click &amp; Drop) and use <strong>Add tracking</strong> to record
          the tracking number here.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Got it</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
