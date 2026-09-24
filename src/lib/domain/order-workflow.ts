import type { JobStatus, OrderStatus, PackingStatus, ShippingStatus } from "@/types/db";

/** The main fulfilment path, in order. */
export const ORDER_FLOW: OrderStatus[] = [
  "new",
  "confirmed",
  "awaiting_print",
  "printing",
  "printed",
  "packing",
  "ready_to_ship",
  "shipped",
  "completed",
];

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = ["completed", "cancelled"];

/** Orders that still need work (used by dashboards and queues). */
export const OPEN_ORDER_STATUSES: OrderStatus[] = [
  "new",
  "confirmed",
  "awaiting_print",
  "printing",
  "printed",
  "packing",
  "ready_to_ship",
  "on_hold",
];

export function isTerminal(status: OrderStatus) {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

/**
 * Statuses a user may manually move an order to. Completed and cancelled
 * orders are closed; everything else can move anywhere along the flow, or be
 * put on hold / cancelled.
 */
export function allowedOrderTransitions(from: OrderStatus): OrderStatus[] {
  if (isTerminal(from)) return [];
  const targets: OrderStatus[] = ORDER_FLOW.filter((s) => s !== from);
  if (from !== "on_hold") targets.push("on_hold");
  targets.push("cancelled");
  return targets;
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus) {
  return allowedOrderTransitions(from).includes(to);
}

/** Side-effect fields that accompany a status change. */
export function orderStatusSideEffects(to: OrderStatus): {
  packing_status?: PackingStatus;
  shipping_status?: ShippingStatus;
  setShippedAt?: boolean;
  setCompletedAt?: boolean;
} {
  switch (to) {
    case "packing":
      return { packing_status: "packing" };
    case "ready_to_ship":
      return { packing_status: "packed", shipping_status: "ready" };
    case "shipped":
      return { packing_status: "packed", shipping_status: "shipped", setShippedAt: true };
    case "completed":
      return { setCompletedAt: true };
    default:
      return {};
  }
}

export type OrderActionKey =
  | "confirm"
  | "queue"
  | "start_production"
  | "mark_printed"
  | "pack"
  | "mark_packed"
  | "add_tracking"
  | "mark_shipped"
  | "complete"
  | "resume";

export interface OrderActionContext {
  status: OrderStatus;
  jobs: { status: JobStatus }[];
  hasTracking: boolean;
}

/**
 * The next sensible actions for an order, most important first. Drives the
 * action bar on the order page and the quick actions on lists.
 */
export function nextOrderActions(ctx: OrderActionContext): OrderActionKey[] {
  const live = ctx.jobs.filter((j) => j.status !== "cancelled");
  const hasQueued = live.some((j) => j.status === "queued");
  const allPrinted = live.length === 0 || live.every((j) => j.status === "printed");
  const actions: OrderActionKey[] = [];

  switch (ctx.status) {
    case "new":
      actions.push("confirm");
      if (hasQueued) actions.push("start_production");
      break;
    case "confirmed":
      actions.push("queue");
      if (hasQueued) actions.push("start_production");
      break;
    case "awaiting_print":
    case "printing":
      if (hasQueued) actions.push("start_production");
      if (allPrinted) actions.push("mark_printed");
      break;
    case "printed":
      actions.push("pack");
      break;
    case "packing":
      actions.push("mark_packed");
      if (!ctx.hasTracking) actions.push("add_tracking");
      break;
    case "ready_to_ship":
      actions.push("mark_shipped");
      if (!ctx.hasTracking) actions.push("add_tracking");
      break;
    case "shipped":
      actions.push("complete");
      if (!ctx.hasTracking) actions.push("add_tracking");
      break;
    case "on_hold":
      actions.push("resume");
      break;
    default:
      break;
  }
  return actions;
}

export const ORDER_ACTION_TARGET: Partial<Record<OrderActionKey, OrderStatus>> = {
  confirm: "confirmed",
  queue: "awaiting_print",
  mark_printed: "printed",
  pack: "packing",
  mark_packed: "ready_to_ship",
  mark_shipped: "shipped",
  complete: "completed",
};
