import "server-only";
import { productUnitCost } from "@/lib/domain/costing";
import { calculateOrderTotals, mergeOrderLines } from "@/lib/domain/order-pricing";
import { canTransitionOrder, orderStatusSideEffects } from "@/lib/domain/order-workflow";
import { SALES_CHANNEL_LABELS } from "@/lib/domain/labels";
import type { OrderCreateData, OrderDetailsInput } from "@/lib/validation/schemas";
import type {
  Address,
  AuditLog,
  Customer,
  Order,
  OrderItem,
  OrderStatus,
  Printer,
  Product,
  ProductionJob,
  ProductVariant,
  SalesChannel,
  Shipment,
  StatusHistoryEntry,
} from "@/types/db";
import { logAudit, recordStatusChange } from "./audit";
import type { AppContext } from "./context";
import { AppError, check, checkFound, fromDbError } from "./errors";
import { pageRange, paginated, searchPattern, type Paginated } from "./query";

// ---------------------------------------------------------------- listing

export const ORDER_VIEWS = {
  all: { label: "All", statuses: null },
  open: {
    label: "Open",
    statuses: ["new", "confirmed", "awaiting_print", "printing", "printed", "packing", "ready_to_ship", "on_hold"],
  },
  new: { label: "New", statuses: ["new", "confirmed"] },
  production: { label: "In production", statuses: ["awaiting_print", "printing"] },
  pack: { label: "To pack", statuses: ["printed", "packing"] },
  ship: { label: "To ship", statuses: ["ready_to_ship"] },
  shipped: { label: "Shipped", statuses: ["shipped"] },
  completed: { label: "Completed", statuses: ["completed"] },
  closed: { label: "On hold / cancelled", statuses: ["on_hold", "cancelled"] },
} as const satisfies Record<string, { label: string; statuses: readonly OrderStatus[] | null }>;
export type OrderView = keyof typeof ORDER_VIEWS;

export interface OrderListRow extends Order {
  item_summary: string;
  item_count: number;
  tracking_number: string | null;
}

type OrderRowRaw = Order & {
  order_items: Pick<OrderItem, "product_name" | "variant_name" | "quantity">[];
  shipments: Pick<Shipment, "tracking_number"> | Pick<Shipment, "tracking_number">[] | null;
};

function summarise(raw: OrderRowRaw): OrderListRow {
  const { order_items, shipments, ...order } = raw;
  const items = order_items ?? [];
  const first = items[0];
  const units = items.reduce((s, i) => s + i.quantity, 0);
  const summary = first
    ? `${first.product_name}${first.variant_name ? ` (${first.variant_name})` : ""} × ${first.quantity}${
        items.length > 1 ? ` +${items.length - 1} more` : ""
      }`
    : "—";
  const shipment = Array.isArray(shipments) ? shipments[0] : shipments;
  return { ...order, item_summary: summary, item_count: units, tracking_number: shipment?.tracking_number ?? null };
}

const LIST_SELECT = "*, order_items(product_name, variant_name, quantity), shipments(tracking_number)";

export async function listOrders(
  ctx: AppContext,
  opts: { q?: string; view?: OrderView; channel?: SalesChannel | null; page?: number } = {},
): Promise<Paginated<OrderListRow>> {
  const { page, from, to } = pageRange(opts.page ?? 1);
  let query = ctx.supabase
    .from("orders")
    .select(LIST_SELECT, { count: "exact" })
    .eq("organization_id", ctx.orgId)
    .order("order_date", { ascending: false })
    .range(from, to);
  const statuses = ORDER_VIEWS[opts.view ?? "all"]?.statuses;
  if (statuses) query = query.in("status", [...statuses]);
  if (opts.channel) query = query.eq("sales_channel", opts.channel);
  const pattern = searchPattern(opts.q);
  if (pattern) {
    query = query.or(
      `order_number.ilike.${pattern},external_order_id.ilike.${pattern},customer_name.ilike.${pattern},customer_email.ilike.${pattern}`,
    );
  }
  const { data, count, error } = await query;
  if (error) throw fromDbError(error);
  return paginated(((data ?? []) as OrderRowRaw[]).map(summarise), count, page);
}

export async function listRecentOrders(ctx: AppContext, limit = 8): Promise<OrderListRow[]> {
  const rows = check(
    await ctx.supabase
      .from("orders")
      .select(LIST_SELECT)
      .eq("organization_id", ctx.orgId)
      .order("order_date", { ascending: false })
      .limit(limit),
  ) as OrderRowRaw[];
  return rows.map(summarise);
}

export async function countOrdersByView(ctx: AppContext): Promise<Record<OrderView, number>> {
  const rows = check(
    await ctx.supabase.from("orders").select("status").eq("organization_id", ctx.orgId).limit(10000),
  ) as Pick<Order, "status">[];
  const counts = Object.fromEntries(Object.keys(ORDER_VIEWS).map((k) => [k, 0])) as Record<OrderView, number>;
  for (const row of rows) {
    for (const [key, view] of Object.entries(ORDER_VIEWS) as [OrderView, (typeof ORDER_VIEWS)[OrderView]][]) {
      if (!view.statuses || (view.statuses as readonly OrderStatus[]).includes(row.status)) counts[key]++;
    }
  }
  return counts;
}

// ---------------------------------------------------------------- detail

export interface OrderJob extends ProductionJob {
  printer: Pick<Printer, "id" | "name"> | null;
}

export interface OrderDetail {
  order: Order;
  items: OrderItem[];
  jobs: OrderJob[];
  shipment: Shipment | null;
  history: (StatusHistoryEntry & { changed_by_name: string | null })[];
  activity: (AuditLog & { actor_name: string | null })[];
}

export async function getOrder(ctx: AppContext, id: string): Promise<OrderDetail> {
  const order = checkFound(
    await ctx.supabase.from("orders").select("*").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle(),
    "Order",
  ) as Order;

  const [items, jobs, shipment, history, activity] = await Promise.all([
    ctx.supabase.from("order_items").select("*").eq("order_id", id).order("created_at").order("id"),
    ctx.supabase.from("production_jobs").select("*, printer:printers(id, name)").eq("order_id", id).order("job_number"),
    ctx.supabase.from("shipments").select("*").eq("order_id", id).maybeSingle(),
    ctx.supabase
      .from("status_history")
      .select("*")
      .eq("entity_type", "order")
      .eq("entity_id", id)
      .order("created_at", { ascending: false }),
    ctx.supabase
      .from("audit_logs")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .or(`entity_id.eq.${id},metadata->>order_id.eq.${id}`)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const historyRows = check(history) as StatusHistoryEntry[];
  const activityRows = check(activity) as AuditLog[];
  const names = await resolveUserNames(ctx, [
    ...historyRows.map((h) => h.changed_by),
    ...activityRows.map((a) => a.actor_id),
  ]);

  return {
    order,
    items: check(items) as OrderItem[],
    jobs: check(jobs) as OrderJob[],
    shipment: check(shipment) as Shipment | null,
    history: historyRows.map((h) => ({ ...h, changed_by_name: h.changed_by ? names.get(h.changed_by) ?? null : null })),
    activity: activityRows.map((a) => ({ ...a, actor_name: a.actor_id ? names.get(a.actor_id) ?? null : null })),
  };
}

export async function resolveUserNames(ctx: AppContext, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data } = await ctx.supabase.from("profiles").select("id, full_name, email").in("id", unique);
  for (const p of (data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
    map.set(p.id, p.full_name || p.email || "User");
  }
  return map;
}

// ---------------------------------------------------------------- create

function addressFromCustomer(c: Pick<Customer, "address_line1" | "address_line2" | "city" | "region" | "postcode" | "country">): Address | null {
  const a: Address = {
    line1: c.address_line1,
    line2: c.address_line2,
    city: c.city,
    region: c.region,
    postcode: c.postcode,
    country: c.country,
  };
  return hasAddress(a) ? a : null;
}

export function hasAddress(a: Address | null | undefined): a is Address {
  return Boolean(a && (a.line1 || a.city || a.postcode));
}

export interface CreateOrderOptions {
  isDemo?: boolean;
  orderDate?: string;
}

export async function createOrder(ctx: AppContext, data: OrderCreateData, opts: CreateOrderOptions = {}) {
  // 1. Customer
  let customer: Customer;
  if (data.customer_id) {
    customer = checkFound(
      await ctx.supabase
        .from("customers")
        .select("*")
        .eq("id", data.customer_id)
        .eq("organization_id", ctx.orgId)
        .maybeSingle(),
      "Customer",
    ) as Customer;
  } else if (data.new_customer) {
    const addr = data.shipping_address;
    customer = check(
      await ctx.supabase
        .from("customers")
        .insert({
          organization_id: ctx.orgId,
          name: data.new_customer.name,
          email: data.new_customer.email,
          phone: data.new_customer.phone,
          address_line1: addr?.line1 ?? null,
          address_line2: addr?.line2 ?? null,
          city: addr?.city ?? null,
          region: addr?.region ?? null,
          postcode: addr?.postcode ?? null,
          country: addr?.country ?? "United Kingdom",
          is_demo: opts.isDemo ?? false,
        })
        .select("*")
        .single(),
    ) as Customer;
    await logAudit(ctx, "customer.created", { type: "customer", id: customer.id }, `Customer ${customer.name} created`, {
      via: "new_order",
    });
  } else {
    throw new AppError("Choose a customer or enter a new one.", "validation", { customer_id: "Choose a customer" });
  }

  // 2. Products and pricing — de-duplicated so each product/variant gets one job.
  const lines = mergeOrderLines(
    data.items.map((i) => ({ productId: i.product_id, variantId: i.variant_id, quantity: i.quantity, unitPrice: i.unit_price })),
  );
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = check(
    await ctx.supabase
      .from("products")
      .select("*, product_variants(*)")
      .eq("organization_id", ctx.orgId)
      .in("id", productIds),
  ) as (Product & { product_variants: ProductVariant[] })[];
  const byId = new Map(products.map((p) => [p.id, p]));

  const items = lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product || product.archived_at) throw new AppError("One of the selected products is no longer available.", "validation");
    const variant = line.variantId ? product.product_variants.find((v) => v.id === line.variantId) : undefined;
    if (line.variantId && !variant) throw new AppError(`The selected variant of ${product.name} no longer exists.`, "validation");
    const grams = Number(variant?.filament_grams ?? product.filament_grams);
    const minutes = Number(variant?.print_minutes ?? product.print_minutes);
    const unitCost = productUnitCost(
      { ...product, filament_grams: grams, print_minutes: minutes },
      ctx.settings,
    ).total;
    const unitPrice = line.unitPrice ?? Number(variant?.selling_price ?? product.selling_price);
    return {
      product_id: product.id,
      variant_id: variant?.id ?? null,
      sku: variant?.sku ?? product.sku,
      product_name: product.name,
      variant_name: variant?.name ?? null,
      quantity: line.quantity,
      unit_price: unitPrice,
      unit_cost: unitCost,
      material: variant?.material ?? product.material,
      colour: variant?.colour ?? product.default_colour,
      estimated_minutes: minutes * line.quantity,
      estimated_grams: Math.round(grams * line.quantity * 100) / 100,
      printer_id: product.default_printer_id,
    };
  });

  const totals = calculateOrderTotals({
    lines: items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price, unitCost: i.unit_cost })),
    shippingCharged: data.shipping_charged,
    discount: data.discount,
    fees: data.fees,
    postageCost: data.postage_cost,
  });
  if (data.discount > totals.subtotal + totals.shippingCharged) {
    throw new AppError("Discount cannot be more than the order value.", "validation", { discount: "Too large" });
  }

  const shippingAddress = hasAddress(data.shipping_address) ? data.shipping_address : addressFromCustomer(customer);

  // 3. Atomic insert: order + items + production jobs + shipment + history.
  const { data: orderId, error } = await ctx.supabase.rpc("create_order", {
    p_org: ctx.orgId,
    p_order: {
      sales_channel: data.sales_channel,
      external_order_id: data.external_order_id,
      order_date: opts.orderDate ?? data.order_date ?? new Date().toISOString(),
      customer_id: customer.id,
      customer_name: customer.name,
      customer_email: customer.email,
      customer_phone: customer.phone,
      billing_address: addressFromCustomer(customer) ?? shippingAddress,
      shipping_address: shippingAddress,
      subtotal: totals.subtotal,
      shipping_charged: totals.shippingCharged,
      discount: totals.discount,
      product_cost: totals.productCost,
      fees: totals.fees,
      estimated_profit: totals.estimatedProfit,
      payment_status: data.payment_status,
      priority: data.priority,
      customer_notes: data.customer_notes,
      internal_notes: data.internal_notes,
      is_demo: opts.isDemo ?? false,
    },
    p_items: items,
    p_shipment: {
      provider: data.shipping_provider,
      service: data.shipping_service,
      shipping_cost: totals.postageCost,
    },
  });
  if (error) throw fromDbError(error, "The order could not be created.");

  if (data.save_address_to_customer && data.customer_id && hasAddress(data.shipping_address)) {
    const a = data.shipping_address;
    await ctx.supabase
      .from("customers")
      .update({
        address_line1: a.line1,
        address_line2: a.line2,
        city: a.city,
        region: a.region,
        postcode: a.postcode,
        country: a.country,
      })
      .eq("id", customer.id);
  }

  const created = check(
    await ctx.supabase.from("orders").select("id, order_number").eq("id", orderId as string).single(),
  ) as Pick<Order, "id" | "order_number">;
  return { ...created, jobCount: items.length, channelLabel: SALES_CHANNEL_LABELS[data.sales_channel] };
}

// ---------------------------------------------------------------- status

async function previousStatusBeforeHold(ctx: AppContext, orderId: string): Promise<OrderStatus> {
  const { data } = await ctx.supabase
    .from("status_history")
    .select("from_status")
    .eq("entity_type", "order")
    .eq("entity_id", orderId)
    .eq("to_status", "on_hold")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prev = (data?.from_status as OrderStatus | null) ?? "confirmed";
  return prev === "on_hold" ? "confirmed" : prev;
}

/**
 * Moves an order to a new status, applying the workflow's side effects and
 * recording history. `to: "resume"` returns an on-hold order to where it was.
 */
export async function changeOrderStatus(ctx: AppContext, orderId: string, to: OrderStatus | "resume", note?: string | null) {
  const order = checkFound(
    await ctx.supabase.from("orders").select("*").eq("id", orderId).eq("organization_id", ctx.orgId).maybeSingle(),
    "Order",
  ) as Order;

  const target: OrderStatus = to === "resume" ? await previousStatusBeforeHold(ctx, orderId) : to;
  if (target === order.status) return order;
  if (!canTransitionOrder(order.status, target)) {
    throw new AppError(`An order that is ${order.status.replaceAll("_", " ")} can't be moved to ${target.replaceAll("_", " ")}.`, "validation");
  }

  const effects = orderStatusSideEffects(target);
  const now = new Date().toISOString();
  const patch: Partial<Order> = { status: target };
  if (effects.packing_status) patch.packing_status = effects.packing_status;
  if (effects.shipping_status) patch.shipping_status = effects.shipping_status;
  if (effects.setShippedAt && !order.shipped_at) patch.shipped_at = now;
  if (effects.setCompletedAt) patch.completed_at = now;

  if (target === "shipped") {
    const shipment = check(await ctx.supabase.from("shipments").select("*").eq("order_id", orderId).maybeSingle()) as Shipment | null;
    if (shipment) {
      check(
        await ctx.supabase
          .from("shipments")
          .update({
            shipped_at: shipment.shipped_at ?? now,
            label_status: shipment.label_status === "not_created" && shipment.tracking_number ? "manual" : shipment.label_status,
          })
          .eq("id", shipment.id),
      );
    }
  }

  if (target === "cancelled") {
    await cancelOpenJobsForOrder(ctx, orderId);
  }

  const updated = check(
    await ctx.supabase.from("orders").update(patch).eq("id", orderId).select("*").single(),
  ) as Order;
  await recordStatusChange(ctx, "order", orderId, order.status, target, note);
  await logAudit(
    ctx,
    "order.status_changed",
    { type: "order", id: orderId },
    `Order ${order.order_number}: ${order.status} → ${target}`,
    { from: order.status, to: target, note: note ?? null },
  );
  return updated;
}

async function cancelOpenJobsForOrder(ctx: AppContext, orderId: string) {
  const jobs = check(
    await ctx.supabase
      .from("production_jobs")
      .select("id, status, printer_id")
      .eq("order_id", orderId)
      .in("status", ["queued", "printing", "paused", "failed"]),
  ) as Pick<ProductionJob, "id" | "status" | "printer_id">[];
  for (const job of jobs) {
    check(await ctx.supabase.from("production_jobs").update({ status: "cancelled" }).eq("id", job.id));
    await recordStatusChange(ctx, "production_job", job.id, job.status, "cancelled", "Order cancelled");
    if (job.status === "printing" && job.printer_id) {
      await ctx.supabase
        .from("printers")
        .update({ status: "idle", status_updated_at: new Date().toISOString() })
        .eq("id", job.printer_id)
        .eq("status", "printing");
    }
  }
  if (jobs.length) {
    await ctx.supabase.from("orders").update({ production_status: "not_started" }).eq("id", orderId);
  }
}

// ---------------------------------------------------------------- edit

export async function updateOrderDetails(ctx: AppContext, orderId: string, input: OrderDetailsInput) {
  const order = checkFound(
    await ctx.supabase.from("orders").select("*").eq("id", orderId).eq("organization_id", ctx.orgId).maybeSingle(),
    "Order",
  ) as Order;
  const shipment = check(
    await ctx.supabase.from("shipments").select("shipping_cost").eq("order_id", orderId).maybeSingle(),
  ) as Pick<Shipment, "shipping_cost"> | null;

  const totals = calculateOrderTotals({
    lines: [{ quantity: 1, unitPrice: Number(order.subtotal), unitCost: Number(order.product_cost) }],
    shippingCharged: input.shipping_charged,
    discount: input.discount,
    fees: input.fees,
    postageCost: Number(shipment?.shipping_cost ?? 0),
  });
  if (input.discount > totals.subtotal + totals.shippingCharged) {
    throw new AppError("Discount cannot be more than the order value.", "validation", { discount: "Too large" });
  }

  const updated = check(
    await ctx.supabase
      .from("orders")
      .update({
        payment_status: input.payment_status,
        external_order_id: input.external_order_id,
        shipping_charged: totals.shippingCharged,
        discount: totals.discount,
        fees: totals.fees,
        estimated_profit: totals.estimatedProfit,
        shipping_address: hasAddress(input.shipping_address) ? input.shipping_address : null,
        customer_notes: input.customer_notes,
        internal_notes: input.internal_notes,
      })
      .eq("id", orderId)
      .select("*")
      .single(),
  ) as Order;
  await logAudit(ctx, "order.updated", { type: "order", id: orderId }, `Order ${order.order_number} updated`, {
    payment_status: input.payment_status,
    total: updated.total,
  });
  return updated;
}

/** Re-derive estimated profit after postage (shipment cost) changes. */
export async function recalculateOrderProfit(ctx: AppContext, orderId: string) {
  const order = check(await ctx.supabase.from("orders").select("*").eq("id", orderId).single()) as Order;
  const shipment = check(
    await ctx.supabase.from("shipments").select("shipping_cost").eq("order_id", orderId).maybeSingle(),
  ) as Pick<Shipment, "shipping_cost"> | null;
  const totals = calculateOrderTotals({
    lines: [{ quantity: 1, unitPrice: Number(order.subtotal), unitCost: Number(order.product_cost) }],
    shippingCharged: Number(order.shipping_charged),
    discount: Number(order.discount),
    fees: Number(order.fees),
    postageCost: Number(shipment?.shipping_cost ?? 0),
  });
  if (totals.estimatedProfit !== Number(order.estimated_profit)) {
    check(await ctx.supabase.from("orders").update({ estimated_profit: totals.estimatedProfit }).eq("id", orderId));
  }
}
