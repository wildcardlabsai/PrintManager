import "server-only";
import { monthRange, todayRange, weekRange } from "@/lib/domain/dates";
import { roundMoney } from "@/lib/domain/money";
import { elapsedPrintMinutes } from "@/lib/domain/production";
import type { Filament, Order, ProductionJob } from "@/types/db";
import type { AppContext } from "./context";
import { check } from "./errors";
import { listRecentOrders } from "./orders";
import { listPrinters } from "./printers";
import { getProductionBoard } from "./production";

async function countOrders(ctx: AppContext, build: (q: ReturnType<typeof base>) => ReturnType<typeof base>) {
  const { count, error } = await build(base(ctx));
  if (error) check({ data: null, error });
  return count ?? 0;
}
function base(ctx: AppContext) {
  return ctx.supabase.from("orders").select("id", { count: "exact", head: true }).eq("organization_id", ctx.orgId);
}

export async function getDashboard(ctx: AppContext) {
  const tz = ctx.settings.timezone;
  const today = todayRange(tz);
  const week = weekRange(tz);
  const month = monthRange(tz);
  const financeFrom = week.from < month.from ? week.from : month.from;

  const [
    ordersToday,
    newOrders,
    awaitingPrint,
    printing,
    toPack,
    toShip,
    onHold,
    finance,
    completedToday,
    board,
    printers,
    recentOrders,
    lowSpools,
  ] = await Promise.all([
    countOrders(ctx, (q) => q.gte("order_date", today.from.toISOString()).lte("order_date", today.to.toISOString())),
    countOrders(ctx, (q) => q.in("status", ["new", "confirmed"])),
    countOrders(ctx, (q) => q.eq("status", "awaiting_print")),
    countOrders(ctx, (q) => q.eq("status", "printing")),
    countOrders(ctx, (q) => q.in("status", ["printed", "packing"])),
    countOrders(ctx, (q) => q.eq("status", "ready_to_ship")),
    countOrders(ctx, (q) => q.eq("status", "on_hold")),
    ctx.supabase
      .from("orders")
      .select("order_date, total, estimated_profit")
      .eq("organization_id", ctx.orgId)
      .neq("status", "cancelled")
      .gte("order_date", financeFrom.toISOString())
      .lte("order_date", today.to.toISOString())
      .limit(5000),
    ctx.supabase
      .from("production_jobs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .eq("status", "printed")
      .gte("completed_at", today.from.toISOString()),
    getProductionBoard(ctx, { printedLimit: 5 }),
    listPrinters(ctx),
    listRecentOrders(ctx, 8),
    ctx.supabase
      .from("filaments")
      .select("id, brand, material, colour, remaining_g, status")
      .eq("organization_id", ctx.orgId)
      .in("status", ["low", "empty"])
      .limit(10),
  ]);

  const rows = check(finance) as Pick<Order, "order_date" | "total" | "estimated_profit">[];
  const sum = (from: Date, key: "total" | "estimated_profit") =>
    roundMoney(rows.filter((r) => new Date(r.order_date) >= from).reduce((s, r) => s + Number(r[key]), 0));

  const now = new Date();
  const remainingMinutes =
    board.queued.reduce((s, j) => s + j.estimated_minutes, 0) +
    board.active.reduce(
      (s, j) => s + Math.max(0, j.estimated_minutes - elapsedPrintMinutes(j as ProductionJob, now)),
      0,
    );

  return {
    orders: { today: ordersToday, new: newOrders, awaitingPrint, printing, toPack, toShip, onHold },
    production: {
      queued: board.queued.length,
      printing: board.active.length,
      failed: board.failed.length,
      completedToday: completedToday.count ?? 0,
      remainingMinutes,
    },
    finance: {
      revenueToday: sum(today.from, "total"),
      revenueWeek: sum(week.from, "total"),
      revenueMonth: sum(month.from, "total"),
      profitToday: sum(today.from, "estimated_profit"),
      profitWeek: sum(week.from, "estimated_profit"),
      profitMonth: sum(month.from, "estimated_profit"),
    },
    board,
    printers,
    recentOrders,
    lowSpools: check(lowSpools) as Pick<Filament, "id" | "brand" | "material" | "colour" | "remaining_g" | "status">[],
  };
}
export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
