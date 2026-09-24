"use client";

import { useRouter } from "next/navigation";
import {
  BoxIcon,
  CheckCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  PackageCheckIcon,
  PlayIcon,
  TruckIcon,
  ListOrderedIcon,
} from "lucide-react";
import { changeOrderStatusAction } from "@/actions/orders";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAction } from "@/hooks/use-action";
import { ORDER_STATUS_META } from "@/lib/domain/labels";
import {
  ORDER_ACTION_TARGET,
  allowedOrderTransitions,
  nextOrderActions,
  type OrderActionKey,
} from "@/lib/domain/order-workflow";
import type { JobStatus, OrderStatus, Shipment } from "@/types/db";
import { ShipmentDialog } from "./shipment-dialog";

const ACTION_UI: Record<OrderActionKey, { label: string; icon: React.ReactNode }> = {
  confirm: { label: "Confirm order", icon: <CheckIcon /> },
  queue: { label: "Send to production", icon: <ListOrderedIcon /> },
  start_production: { label: "Start production", icon: <PlayIcon /> },
  mark_printed: { label: "Mark printed", icon: <CheckCheckIcon /> },
  pack: { label: "Pack order", icon: <BoxIcon /> },
  mark_packed: { label: "Mark packed", icon: <PackageCheckIcon /> },
  add_tracking: { label: "Add tracking", icon: <TruckIcon /> },
  mark_shipped: { label: "Mark shipped", icon: <TruckIcon /> },
  complete: { label: "Complete order", icon: <CheckCheckIcon /> },
  resume: { label: "Resume order", icon: <PlayIcon /> },
};

export function OrderActions({
  orderId,
  orderNumber,
  status,
  jobs,
  shipment,
  marketplaceName = null,
}: {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  jobs: { id: string; status: JobStatus }[];
  shipment: Pick<Shipment, "provider" | "service" | "shipping_cost" | "tracking_number" | "notes"> | null;
  /** Set when tracking can be sent to a connected marketplace. */
  marketplaceName?: string | null;
}) {
  const router = useRouter();
  const { pending, execute } = useAction();
  const actions = nextOrderActions({ status, jobs, hasTracking: Boolean(shipment?.tracking_number) });
  const transitions = allowedOrderTransitions(status);

  const setStatus = (to: OrderStatus | "resume") =>
    execute(() => changeOrderStatusAction({ orderId, status: to }), {
      success: (d) => `Order ${orderNumber} is now ${ORDER_STATUS_META[d.status].label.toLowerCase()}`,
    });

  const render = (key: OrderActionKey, primary: boolean) => {
    const ui = ACTION_UI[key];
    const variant = primary ? "default" : "outline";
    if (key === "start_production") {
      const firstQueued = jobs.find((j) => j.status === "queued");
      return (
        <Button key={key} size="sm" variant={variant} onClick={() => router.push(firstQueued ? `#job-${firstQueued.id}` : "#production")}>
          {ui.icon} {ui.label}
        </Button>
      );
    }
    if (key === "add_tracking" || key === "mark_shipped") {
      return (
        <ShipmentDialog
          key={key}
          orderId={orderId}
          orderNumber={orderNumber}
          shipment={shipment}
          markShipped={key === "mark_shipped"}
          marketplaceName={marketplaceName}
          trigger={
            <Button size="sm" variant={variant}>
              {ui.icon} {ui.label}
            </Button>
          }
        />
      );
    }
    const target = key === "resume" ? "resume" : ORDER_ACTION_TARGET[key]!;
    return (
      <Button key={key} size="sm" variant={variant} disabled={pending} onClick={() => setStatus(target)}>
        {pending ? <Loader2Icon className="animate-spin" /> : ui.icon} {ui.label}
      </Button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((a, i) => render(a, i === 0))}
      {transitions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={pending}>
              Status <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Move order to…</DropdownMenuLabel>
            {transitions
              .filter((t) => t !== "cancelled")
              .map((t) => (
                <DropdownMenuItem key={t} onSelect={() => setStatus(t)}>
                  {ORDER_STATUS_META[t].label}
                </DropdownMenuItem>
              ))}
            {transitions.includes("cancelled") && (
              <>
                <DropdownMenuSeparator />
                <ConfirmButton
                  title={`Cancel order ${orderNumber}?`}
                  description="Open production jobs for this order will be cancelled. Printed items and history are kept. This can't be undone."
                  confirmLabel="Cancel order"
                  destructive
                  onConfirm={() => setStatus("cancelled")}
                  trigger={
                    <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                      Cancel order
                    </DropdownMenuItem>
                  }
                />
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
