import "server-only";
import type { CustomerInput } from "@/lib/validation/schemas";
import type { Customer, Order } from "@/types/db";
import { logAudit } from "./audit";
import type { AppContext } from "./context";
import { check, checkFound } from "./errors";
import { pageRange, paginated, searchPattern, type Paginated } from "./query";

export interface CustomerWithStats extends Customer {
  order_count: number;
  total_spent: number;
  first_order_at: string | null;
  last_order_at: string | null;
}

type OrderStatRow = Pick<Order, "customer_id" | "total" | "order_date" | "status">;

function applyStats(customers: Customer[], orders: OrderStatRow[]): CustomerWithStats[] {
  const stats = new Map<string, { count: number; spent: number; first: string | null; last: string | null }>();
  for (const o of orders) {
    if (!o.customer_id || o.status === "cancelled") continue;
    const s = stats.get(o.customer_id) ?? { count: 0, spent: 0, first: null, last: null };
    s.count++;
    s.spent += Number(o.total);
    if (!s.first || o.order_date < s.first) s.first = o.order_date;
    if (!s.last || o.order_date > s.last) s.last = o.order_date;
    stats.set(o.customer_id, s);
  }
  return customers.map((c) => {
    const s = stats.get(c.id);
    return {
      ...c,
      order_count: s?.count ?? 0,
      total_spent: Math.round((s?.spent ?? 0) * 100) / 100,
      first_order_at: s?.first ?? null,
      last_order_at: s?.last ?? null,
    };
  });
}

export async function listCustomers(
  ctx: AppContext,
  opts: { q?: string; page?: number; includeArchived?: boolean } = {},
): Promise<Paginated<CustomerWithStats>> {
  const { page, from, to } = pageRange(opts.page ?? 1);
  let query = ctx.supabase
    .from("customers")
    .select("*", { count: "exact" })
    .eq("organization_id", ctx.orgId)
    .order("name")
    .range(from, to);
  if (!opts.includeArchived) query = query.is("archived_at", null);
  const pattern = searchPattern(opts.q);
  if (pattern) query = query.or(`name.ilike.${pattern},email.ilike.${pattern},postcode.ilike.${pattern},phone.ilike.${pattern}`);
  const { data, count, error } = await query;
  if (error) check({ data, error });
  const customers = (data ?? []) as Customer[];

  // Stats only for the customers on this page.
  let orders: OrderStatRow[] = [];
  if (customers.length) {
    orders = check(
      await ctx.supabase
        .from("orders")
        .select("customer_id, total, order_date, status")
        .in(
          "customer_id",
          customers.map((c) => c.id),
        ),
    ) as OrderStatRow[];
  }
  return paginated(applyStats(customers, orders), count, page);
}

/** Lightweight list for pickers (e.g. the new order form). */
export async function listCustomerOptions(ctx: AppContext) {
  return check(
    await ctx.supabase
      .from("customers")
      .select("id, name, email, phone, address_line1, address_line2, city, region, postcode, country")
      .eq("organization_id", ctx.orgId)
      .is("archived_at", null)
      .order("name")
      .limit(1000),
  ) as Pick<
    Customer,
    "id" | "name" | "email" | "phone" | "address_line1" | "address_line2" | "city" | "region" | "postcode" | "country"
  >[];
}

export async function getCustomer(ctx: AppContext, id: string) {
  const customer = checkFound(
    await ctx.supabase.from("customers").select("*").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle(),
    "Customer",
  ) as Customer;
  const orders = check(
    await ctx.supabase
      .from("orders")
      .select("id, order_number, sales_channel, order_date, total, estimated_profit, status, customer_id")
      .eq("customer_id", id)
      .order("order_date", { ascending: false }),
  ) as Pick<Order, "id" | "order_number" | "sales_channel" | "order_date" | "total" | "estimated_profit" | "status" | "customer_id">[];
  const [withStats] = applyStats([customer], orders);
  return { customer: withStats, orders };
}

export async function createCustomer(ctx: AppContext, input: CustomerInput, opts: { isDemo?: boolean } = {}) {
  const customer = check(
    await ctx.supabase
      .from("customers")
      .insert({ ...input, organization_id: ctx.orgId, is_demo: opts.isDemo ?? false })
      .select("*")
      .single(),
  ) as Customer;
  await logAudit(ctx, "customer.created", { type: "customer", id: customer.id }, `Customer ${customer.name} created`);
  return customer;
}

export async function updateCustomer(ctx: AppContext, id: string, input: CustomerInput) {
  const customer = checkFound(
    await ctx.supabase
      .from("customers")
      .update(input)
      .eq("id", id)
      .eq("organization_id", ctx.orgId)
      .select("*")
      .maybeSingle(),
    "Customer",
  ) as Customer;
  await logAudit(ctx, "customer.updated", { type: "customer", id }, `Customer ${customer.name} updated`);
  return customer;
}

export async function setCustomerArchived(ctx: AppContext, id: string, archived: boolean) {
  const customer = checkFound(
    await ctx.supabase
      .from("customers")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("organization_id", ctx.orgId)
      .select("id, name")
      .maybeSingle(),
    "Customer",
  ) as Pick<Customer, "id" | "name">;
  await logAudit(
    ctx,
    archived ? "customer.archived" : "customer.updated",
    { type: "customer", id },
    `Customer ${customer.name} ${archived ? "archived" : "restored"}`,
  );
}
