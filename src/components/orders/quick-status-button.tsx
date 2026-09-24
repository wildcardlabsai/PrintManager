"use client";

import { Loader2Icon } from "lucide-react";
import { changeOrderStatusAction } from "@/actions/orders";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import type { OrderStatus } from "@/types/db";

export function QuickStatusButton({
  orderId,
  to,
  label,
  variant = "outline",
}: {
  orderId: string;
  to: OrderStatus;
  label: string;
  variant?: "default" | "outline";
}) {
  const { pending, execute } = useAction();
  return (
    <Button size="sm" variant={variant} disabled={pending} onClick={() => execute(() => changeOrderStatusAction({ orderId, status: to }), { success: `${label} ✓` })}>
      {pending && <Loader2Icon className="animate-spin" />}
      {label}
    </Button>
  );
}
