import "server-only";
import { dayKey, eachDayKey, type DateRange } from "@/lib/domain/dates";
import { roundMoney } from "@/lib/domain/money";
import type { Order, OrderItem, ProductionJob, SalesChannel } from "@/types/db";
import type { AppContext } from "./context";
import { check } from "./errors";

export interface DailyPoint {
  day: string;
  revenue: number;
  profit: number;
  orders: number;
}

export async function getReport(ctx: AppContext, range: DateRange) {
  const tz = ctx.settings.timezone;
  const from = range.from.toISOString();
  const to = range.to.toISOString();

  const [ordersRes, itemsRes, jobsRes, usageRes] = await Promise.all([
    ctx.supabase
      .from("orders")
      .select("id, order_date, status, sales_channel, subtotal, shipping_charged, discount, total, product_cost, fees, estimated_profit")
      .eq("organization_id", ctx.orgId)
      .gte("order_date", from)
      .lte("order_date", to)
      .limit(20000),
    ctx.supabase
      .from("order_items")
      .select("product_id, product_name, quantity, line_total, line_cost, orders!inner(order_date, status)")
      .eq("organization_id", ctx.orgId)
      .gte("orders.order_date", from)
      .lte("orders.order_date", to)
      .neq("orders.status", "cancelled")
      .limit(50000),
    ctx.supabase
      .from("production_jobs")
      .select("status, quantity, actual_minutes, estimated_minutes, actual_grams, completed_at, failed_at")
      .eq("organization_id", ctx.orgId)
      .or(`and(completed_at.gte.${from},completed_at.lte.${to}),and(failed_at.gte.${from},failed_at.lte.${to})`)
      .limit(20000),
    ctx.supabase
      .from("filament_usage")
      .select("grams, cost, created_at, filament:filaments(material, colour, brand)")
      .eq("organization_id", ctx.orgId)
      .gte("created_at", from)
      .lte("created_at", to)
      .limit(20000),
  ]);

  const allOrders = check(ordersRes) as Pick<
    Order,
    "id" | "order_date" | "status" | "sales_channel" | "subtotal" | "shipping_charged" | "discount" | "total" | "product_cost" | "fees" | "estimated_profit"
  >[];
  const orders = allOrders.filter((o) => o.status !== "cancelled");

  // Daily series
  const days = eachDayKey(range, tz);
  const byDay = new Map<string, DailyPoint>(days.map((d) => [d, { day: d, revenue: 0, profit: 0, orders: 0 }]));
  for (const o of orders) {
    const p = byDay.get(dayKey(o.order_date, tz));
    if (!p) continue;
    p.revenue += Number(o.total);
    p.profit += Number(o.estimated_profit);
    p.orders += 1;
  }
  const daily = [...byDay.values()].map((p) => ({ ...p, revenue: roundMoney(p.revenue), profit: roundMoney(p.profit) }));

  // Channels
  const channelMap = new Map<SalesChannel, { channel: SalesChannel; revenue: number; profit: number; orders: number }>();
  for (const o of orders) {
    const c = channelMap.get(o.sales_channel) ?? { channel: o.sales_channel, revenue: 0, profit: 0, orders: 0 };
    c.revenue += Number(o.total);
    c.profit += Number(o.estimated_profit);
    c.orders += 1;
    channelMap.set(o.sales_channel, c);
  }
  const channels = [...channelMap.values()]
    .map((c) => ({ ...c, revenue: roundMoney(c.revenue), profit: roundMoney(c.profit) }))
    .sort((a, b) => b.revenue - a.revenue);

  // Products
  const items = check(itemsRes) as unknown as Pick<OrderItem, "product_id" | "product_name" | "quantity" | "line_total" | "line_cost">[];
  const productMap = new Map<string, { name: string; units: number; revenue: number; cost: number }>();
  for (const i of items) {
    const key = i.product_id ?? i.product_name;
    const p = productMap.get(key) ?? { name: i.product_name, units: 0, revenue: 0, cost: 0 };
    p.units += i.quantity;
    p.revenue += Number(i.line_total);
    p.cost += Number(i.line_cost);
    productMap.set(key, p);
  }
  const products = [...productMap.values()]
    .map((p) => ({ ...p, revenue: roundMoney(p.revenue), cost: roundMoney(p.cost), margin: roundMoney(p.revenue - p.cost) }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Production
  const jobs = check(jobsRes) as Pick<
    ProductionJob,
    "status" | "quantity" | "actual_minutes" | "estimated_minutes" | "actual_grams" | "completed_at" | "failed_at"
  >[];
  const inRange = (d: string | null) => d != null && d >= from && d <= to;
  const printed = jobs.filter((j) => j.status === "printed" && inRange(j.completed_at));
  const failedJobs = jobs.filter((j) => j.failed_at && inRange(j.failed_at));
  const productionDaily = new Map<string, { day: string; printed: number; failed: number }>(
    days.map((d) => [d, { day: d, printed: 0, failed: 0 }]),
  );
  for (const j of printed) {
    const p = productionDaily.get(dayKey(j.completed_at!, tz));
    if (p) p.printed += 1;
  }
  for (const j of failedJobs) {
    const p = productionDaily.get(dayKey(j.failed_at!, tz));
    if (p) p.failed += 1;
  }

  // Filament
  const usage = check(usageRes) as unknown as {
    grams: number;
    cost: number;
    created_at: string;
    filament: { material: string; colour: string; brand: string } | null;
  }[];
  const materialMap = new Map<string, { material: string; grams: number; cost: number }>();
  for (const u of usage) {
    const key = u.filament?.material ?? "Unknown";
    const m = materialMap.get(key) ?? { material: key, grams: 0, cost: 0 };
    m.grams += Number(u.grams);
    m.cost += Number(u.cost);
    materialMap.set(key, m);
  }
  const filamentDaily = new Map<string, { day: string; grams: number }>(days.map((d) => [d, { day: d, grams: 0 }]));
  for (const u of usage) {
    const p = filamentDaily.get(dayKey(u.created_at, tz));
    if (p) p.grams += Number(u.grams);
  }

  const revenue = roundMoney(orders.reduce((s, o) => s + Number(o.total), 0));
  const profit = roundMoney(orders.reduce((s, o) => s + Number(o.estimated_profit), 0));

  return {
    summary: {
      revenue,
      profit,
      margin: revenue > 0 ? profit / revenue : null,
      orders: orders.length,
      cancelled: allOrders.length - orders.length,
      averageOrderValue: orders.length ? roundMoney(revenue / orders.length) : 0,
      productCost: roundMoney(orders.reduce((s, o) => s + Number(o.product_cost), 0)),
      fees: roundMoney(orders.reduce((s, o) => s + Number(o.fees), 0)),
      unitsSold: items.reduce((s, i) => s + i.quantity, 0),
    },
    daily,
    channels,
    products,
    production: {
      jobsPrinted: printed.length,
      unitsPrinted: printed.reduce((s, j) => s + j.quantity, 0),
      jobsFailed: failedJobs.length,
      failureRate: printed.length + failedJobs.length > 0 ? failedJobs.length / (printed.length + failedJobs.length) : null,
      printMinutes: printed.reduce((s, j) => s + (j.actual_minutes ?? j.estimated_minutes), 0),
      daily: [...productionDaily.values()],
    },
    filament: {
      grams: Math.round(usage.reduce((s, u) => s + Number(u.grams), 0) * 10) / 10,
      cost: roundMoney(usage.reduce((s, u) => s + Number(u.cost), 0)),
      byMaterial: [...materialMap.values()]
        .map((m) => ({ ...m, grams: Math.round(m.grams * 10) / 10, cost: roundMoney(m.cost) }))
        .sort((a, b) => b.grams - a.grams),
      daily: [...filamentDaily.values()].map((d) => ({ ...d, grams: Math.round(d.grams * 10) / 10 })),
    },
  };
}
export type ReportData = Awaited<ReturnType<typeof getReport>>;
