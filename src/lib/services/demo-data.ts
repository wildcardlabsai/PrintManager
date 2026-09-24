import "server-only";
import { orderCreateSchema } from "@/lib/validation/schemas";
import type { Filament, JobStatus, OrderStatus, Printer, Product, ProductionJob, SalesChannel, ShippingProvider } from "@/types/db";
import { logAudit, recordStatusChange } from "./audit";
import type { AppContext } from "./context";
import { AppError, check } from "./errors";
import { createOrder } from "./orders";
import { createProduct } from "./products";
import { createFilament } from "./filaments";

/**
 * Demo data for trying PrintFlow. Every record is flagged is_demo = true, is
 * shown with a "Demo" badge, and can be removed from Settings. Orders are
 * created through the normal order service so totals, costs and production
 * jobs are calculated exactly as they are for real orders.
 */

const PRODUCTS: {
  sku: string;
  name: string;
  description: string;
  price: number;
  grams: number;
  minutes: number;
  material: string;
  colour: string;
  packaging: string;
  packagingCost?: number;
  printer: "AD5X" | "Adventurer 5M";
  variants?: { sku: string; name: string; colour: string; price?: number }[];
}[] = [
  { sku: "PKM-STAND-1", name: "Pokémon Card Stand — Single", description: "Angled stand for a single toploader or slab.", price: 4.99, grams: 18, minutes: 45, material: "PLA", colour: "Black", packaging: "Large letter", packagingCost: 0.25, printer: "Adventurer 5M" },
  { sku: "PKM-STAND-3", name: "Pokémon Card Stand — 3 Pack", description: "Set of three angled card stands.", price: 12.99, grams: 80, minutes: 180, material: "PLA", colour: "Black", packaging: "Padded envelope", printer: "Adventurer 5M",
    variants: [
      { sku: "PKM-STAND-3-BLK", name: "Black", colour: "Black" },
      { sku: "PKM-STAND-3-WHT", name: "White", colour: "White" },
      { sku: "PKM-STAND-3-RED", name: "Pokéball Red", colour: "Red" },
    ] },
  { sku: "TCG-DECKBOX-100", name: "Trading Card Deck Box (100)", description: "Magnetic-lid deck box for 100 sleeved cards.", price: 9.99, grams: 95, minutes: 240, material: "PETG", colour: "Grey", packaging: "Small parcel box", printer: "AD5X" },
  { sku: "TCG-SLAB-9", name: "Graded Slab Display — 9 Slot", description: "Tiered display for PSA/CGC graded slabs.", price: 18.5, grams: 210, minutes: 420, material: "PLA", colour: "Black", packaging: "Medium parcel box", packagingCost: 0.9, printer: "AD5X" },
  { sku: "DESK-ORG-MOD", name: "Modular Desk Organiser", description: "Stackable organiser with pen, phone and card slots.", price: 16.0, grams: 260, minutes: 480, material: "PLA", colour: "White", packaging: "Medium parcel box", packagingCost: 0.9, printer: "AD5X" },
  { sku: "DESK-PEN-HEX", name: "Hexagon Pen Pot", description: "Hexagonal pen pot with vase-mode walls.", price: 7.5, grams: 70, minutes: 150, material: "PLA", colour: "Sage Green", packaging: "Small parcel box", printer: "Adventurer 5M" },
  { sku: "KEY-NAME", name: "Custom Name Keyring", description: "Two-colour personalised name keyring.", price: 3.99, grams: 8, minutes: 25, material: "PLA", colour: "White/Black", packaging: "Large letter", packagingCost: 0.2, printer: "AD5X" },
  { sku: "KEY-PKBALL", name: "Pokéball Keyring", description: "Multi-colour Pokéball keyring.", price: 3.5, grams: 10, minutes: 30, material: "PLA", colour: "Red/White", packaging: "Large letter", packagingCost: 0.2, printer: "AD5X" },
  { sku: "FIG-DRAGON", name: "Articulated Dragon Mini", description: "Print-in-place articulated dragon, 25 cm.", price: 14.99, grams: 120, minutes: 360, material: "PLA", colour: "Silk Gold", packaging: "Bubble wrap + box", packagingCost: 0.7, printer: "AD5X",
    variants: [
      { sku: "FIG-DRAGON-GLD", name: "Silk Gold", colour: "Silk Gold" },
      { sku: "FIG-DRAGON-RBW", name: "Rainbow", colour: "Rainbow", price: 16.99 },
    ] },
  { sku: "FIG-OCTO", name: "Flexi Octopus", description: "Small print-in-place flexi octopus.", price: 6.99, grams: 35, minutes: 90, material: "PLA", colour: "Teal", packaging: "Padded envelope", printer: "Adventurer 5M" },
  { sku: "STAND-HEADPHONE", name: "Headphone Stand", description: "Weighted-base headphone stand.", price: 15.99, grams: 180, minutes: 330, material: "PETG", colour: "Black", packaging: "Medium parcel box", packagingCost: 0.9, printer: "Adventurer 5M" },
  { sku: "STAND-CTRL-2", name: "Controller Display Stand (2 pack)", description: "Stands for PlayStation/Xbox controllers.", price: 8.99, grams: 60, minutes: 140, material: "PLA", colour: "Black", packaging: "Padded envelope", printer: "Adventurer 5M" },
  { sku: "STAND-FUNKO-3", name: "Funko Pop Riser — 3 Step", description: "Three-step riser for collectible figures.", price: 11.5, grams: 150, minutes: 300, material: "PLA", colour: "White", packaging: "Medium parcel box", packagingCost: 0.9, printer: "AD5X" },
];

const CUSTOMERS = [
  { name: "Sophie Turner", email: "sophie.turner@example.com", phone: "07700 900101", address_line1: "14 Mill Lane", city: "Leeds", postcode: "LS6 2AB" },
  { name: "James Whitfield", email: "j.whitfield@example.com", phone: "07700 900102", address_line1: "3 Station Road", city: "Bristol", postcode: "BS1 4DJ" },
  { name: "Aisha Rahman", email: "aisha.r@example.com", phone: null, address_line1: "Flat 2, 88 Queen Street", city: "Glasgow", postcode: "G1 3DN" },
  { name: "Tom Hughes", email: "tomhughes@example.com", phone: "07700 900104", address_line1: "22 Castle View", city: "Cardiff", postcode: "CF10 1BH" },
  { name: "Emily Clarke", email: "emily.clarke@example.com", phone: null, address_line1: "7 Orchard Close", city: "Norwich", postcode: "NR2 3PL" },
  { name: "Daniel O'Brien", email: "dob@example.com", phone: "07700 900106", address_line1: "51 Harbour Street", city: "Liverpool", postcode: "L3 4AE" },
  { name: "Priya Patel", email: "priya.patel@example.com", phone: "07700 900107", address_line1: "9 Beech Avenue", city: "Leicester", postcode: "LE2 1TF" },
  { name: "Oliver Grant", email: "oliver.g@example.com", phone: null, address_line1: "120 High Street", city: "Oxford", postcode: "OX1 4BG" },
  { name: "Chloe Evans", email: "chloe.evans@example.com", phone: "07700 900109", address_line1: "4 Rose Terrace", city: "Swansea", postcode: "SA1 5EN" },
  { name: "Marcus Reid", email: "marcus.reid@example.com", phone: "07700 900110", address_line1: "33 Kingsway", city: "Manchester", postcode: "M20 5PQ" },
];

const FILAMENTS = [
  { brand: "eSun", material: "PLA", colour: "Black", colour_hex: "#1C1C1C", weight_purchased_g: 1000, remaining_g: 720, cost: 19.99, status: "in_use" as const },
  { brand: "eSun", material: "PLA", colour: "White", colour_hex: "#F4F4F2", weight_purchased_g: 1000, remaining_g: 540, cost: 19.99, status: "in_use" as const },
  { brand: "Sunlu", material: "PLA", colour: "Red", colour_hex: "#C62828", weight_purchased_g: 1000, remaining_g: 130, cost: 17.49, status: "low" as const },
  { brand: "Polymaker", material: "PLA", colour: "Silk Gold", colour_hex: "#C9A43A", weight_purchased_g: 1000, remaining_g: 860, cost: 24.99, status: "in_use" as const },
  { brand: "Elegoo", material: "PETG", colour: "Black", colour_hex: "#202020", weight_purchased_g: 1000, remaining_g: 1000, cost: 18.99, status: "sealed" as const },
  { brand: "Elegoo", material: "PETG", colour: "Grey", colour_hex: "#8A8D91", weight_purchased_g: 1000, remaining_g: 610, cost: 18.99, status: "in_use" as const },
  { brand: "Flashforge", material: "PLA", colour: "Teal", colour_hex: "#1F8A8A", weight_purchased_g: 1000, remaining_g: 900, cost: 18.0, status: "in_use" as const },
  { brand: "Sunlu", material: "TPU", colour: "Clear", colour_hex: "#E6EEF2", weight_purchased_g: 500, remaining_g: 500, cost: 15.99, status: "sealed" as const },
];

type Stage =
  | "new"
  | "confirmed"
  | "awaiting_print"
  | "failed"
  | "printing"
  | "printed"
  | "packing"
  | "ready_to_ship"
  | "shipped"
  | "completed"
  | "cancelled";

const ORDERS: {
  daysAgo: number;
  hour: number;
  customer: number;
  channel: SalesChannel;
  ext?: string;
  items: { sku: string; variant?: string; qty: number }[];
  shipping: number;
  postage: number;
  provider: ShippingProvider;
  service: string;
  fees?: number;
  discount?: number;
  stage: Stage;
  priority?: "low" | "normal" | "high" | "urgent";
  note?: string;
}[] = [
  { daysAgo: 38, hour: 10, customer: 0, channel: "etsy", ext: "DEMO-ETSY-3011", items: [{ sku: "PKM-STAND-3", variant: "PKM-STAND-3-BLK", qty: 2 }], shipping: 2.99, postage: 2.7, provider: "royal_mail", service: "Tracked 48", fees: 1.62, stage: "completed" },
  { daysAgo: 34, hour: 14, customer: 1, channel: "ebay", ext: "DEMO-EBAY-11-0402", items: [{ sku: "TCG-SLAB-9", qty: 1 }], shipping: 3.99, postage: 3.49, provider: "evri", service: "Standard", fees: 2.87, stage: "completed" },
  { daysAgo: 29, hour: 19, customer: 2, channel: "facebook_marketplace", items: [{ sku: "FIG-DRAGON", variant: "FIG-DRAGON-GLD", qty: 1 }, { sku: "FIG-OCTO", qty: 2 }], shipping: 0, postage: 0, provider: "other", service: "Collection", stage: "completed" },
  { daysAgo: 24, hour: 9, customer: 3, channel: "etsy", ext: "DEMO-ETSY-3187", items: [{ sku: "DESK-ORG-MOD", qty: 1 }], shipping: 3.49, postage: 3.35, provider: "royal_mail", service: "Tracked 48", fees: 1.89, stage: "completed" },
  { daysAgo: 20, hour: 16, customer: 4, channel: "manual", items: [{ sku: "KEY-NAME", qty: 6 }], shipping: 1.5, postage: 1.25, provider: "royal_mail", service: "2nd Class", discount: 2, stage: "completed", note: "Bulk keyrings for a hen party" },
  { daysAgo: 16, hour: 11, customer: 5, channel: "ebay", ext: "DEMO-EBAY-11-0519", items: [{ sku: "STAND-HEADPHONE", qty: 1 }], shipping: 3.99, postage: 3.49, provider: "evri", service: "Standard", fees: 2.51, stage: "completed" },
  { daysAgo: 12, hour: 20, customer: 6, channel: "etsy", ext: "DEMO-ETSY-3290", items: [{ sku: "PKM-STAND-1", qty: 4 }, { sku: "KEY-PKBALL", qty: 2 }], shipping: 2.49, postage: 1.95, provider: "royal_mail", service: "Tracked 48", fees: 2.1, stage: "shipped" },
  { daysAgo: 9, hour: 13, customer: 7, channel: "website", items: [{ sku: "STAND-FUNKO-3", qty: 2 }], shipping: 3.99, postage: 3.35, provider: "dpd", service: "Next Day", fees: 0.9, stage: "shipped" },
  { daysAgo: 7, hour: 15, customer: 1, channel: "ebay", ext: "DEMO-EBAY-11-0633", items: [{ sku: "TCG-DECKBOX-100", qty: 2 }], shipping: 3.99, postage: 3.49, provider: "evri", service: "Standard", fees: 2.44, stage: "cancelled", note: "Buyer cancelled before dispatch" },
  { daysAgo: 5, hour: 10, customer: 8, channel: "etsy", ext: "DEMO-ETSY-3342", items: [{ sku: "FIG-DRAGON", variant: "FIG-DRAGON-RBW", qty: 1 }], shipping: 2.99, postage: 2.7, provider: "royal_mail", service: "Tracked 48", fees: 1.65, stage: "ready_to_ship" },
  { daysAgo: 4, hour: 17, customer: 9, channel: "facebook_marketplace", items: [{ sku: "DESK-PEN-HEX", qty: 2 }, { sku: "STAND-CTRL-2", qty: 1 }], shipping: 3.2, postage: 2.95, provider: "royal_mail", service: "2nd Class", stage: "packing" },
  { daysAgo: 3, hour: 12, customer: 0, channel: "etsy", ext: "DEMO-ETSY-3378", items: [{ sku: "PKM-STAND-3", variant: "PKM-STAND-3-RED", qty: 1 }], shipping: 2.99, postage: 2.7, provider: "royal_mail", service: "Tracked 48", fees: 1.05, stage: "printed" },
  { daysAgo: 2, hour: 9, customer: 3, channel: "ebay", ext: "DEMO-EBAY-11-0701", items: [{ sku: "TCG-SLAB-9", qty: 2 }], shipping: 4.99, postage: 3.99, provider: "evri", service: "Standard", fees: 4.96, stage: "printing", priority: "high" },
  { daysAgo: 2, hour: 18, customer: 5, channel: "etsy", ext: "DEMO-ETSY-3401", items: [{ sku: "PKM-STAND-3", variant: "PKM-STAND-3-WHT", qty: 3 }], shipping: 2.99, postage: 2.7, provider: "royal_mail", service: "Tracked 48", fees: 3.1, stage: "printing" },
  { daysAgo: 1, hour: 11, customer: 6, channel: "manual", items: [{ sku: "FIG-OCTO", qty: 5 }], shipping: 0, postage: 0, provider: "other", service: "Collection", stage: "failed", note: "Collecting Saturday" },
  { daysAgo: 1, hour: 15, customer: 2, channel: "etsy", ext: "DEMO-ETSY-3415", items: [{ sku: "DESK-ORG-MOD", qty: 1 }, { sku: "DESK-PEN-HEX", qty: 1 }], shipping: 3.49, postage: 3.35, provider: "royal_mail", service: "Tracked 48", fees: 2.44, stage: "awaiting_print" },
  { daysAgo: 0, hour: 8, customer: 4, channel: "ebay", ext: "DEMO-EBAY-11-0744", items: [{ sku: "KEY-PKBALL", qty: 3 }], shipping: 1.5, postage: 1.25, provider: "royal_mail", service: "2nd Class", fees: 1.12, stage: "confirmed" },
  { daysAgo: 0, hour: 9, customer: 8, channel: "etsy", ext: "DEMO-ETSY-3429", items: [{ sku: "PKM-STAND-3", variant: "PKM-STAND-3-BLK", qty: 3 }], shipping: 2.99, postage: 2.7, provider: "royal_mail", service: "Tracked 48", fees: 3.1, stage: "new", priority: "urgent", note: "Buyer asked for dispatch by Friday" },
];

function atDaysAgo(daysAgo: number, hour: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, (daysAgo * 7) % 60, 0, 0);
  if (d > new Date()) d.setTime(Date.now() - 20 * 60 * 1000);
  return d;
}

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60000);

export async function hasDemoData(ctx: AppContext) {
  const { count } = await ctx.supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.orgId)
    .eq("is_demo", true);
  return (count ?? 0) > 0;
}

export async function loadDemoData(ctx: AppContext) {
  if (await hasDemoData(ctx)) throw new AppError("Demo data is already loaded.", "conflict");
  try {
    await insertDemoData(ctx);
  } catch (error) {
    // Never leave half a demo data set behind.
    await clearDemoData(ctx).catch((e) => console.error("[demo] cleanup failed", e));
    throw error;
  }
}

async function insertDemoData(ctx: AppContext) {
  const printers = check(
    await ctx.supabase.from("printers").select("id, name, model").eq("organization_id", ctx.orgId).is("archived_at", null),
  ) as Pick<Printer, "id" | "name" | "model">[];
  const printerFor = (model: string) => printers.find((p) => p.model === model)?.id ?? printers[0]?.id ?? null;

  // Filament
  const spools: Filament[] = [];
  for (const f of FILAMENTS) {
    spools.push(
      await createFilament(
        ctx,
        { ...f, purchased_on: null, notes: "Demo spool" },
        { isDemo: true },
      ),
    );
  }
  const spoolFor = (material: string | null, colour: string | null) =>
    spools.find((s) => s.material === material && colour?.startsWith(s.colour)) ??
    spools.find((s) => s.material === material) ??
    spools[0];

  // Products & variants
  const products = new Map<string, Product>();
  const variants = new Map<string, string>();
  for (const p of PRODUCTS) {
    const printerId = printerFor(p.printer);
    const product = await createProduct(
      ctx,
      {
        sku: `DEMO-${p.sku}`,
        name: p.name,
        description: p.description,
        selling_price: p.price,
        filament_grams: p.grams,
        print_minutes: p.minutes,
        filament_cost_per_kg: null,
        packaging_cost: p.packagingCost ?? null,
        other_cost: 0,
        material: p.material,
        default_colour: p.colour,
        packaging_type: p.packaging,
        default_printer_id: printerId,
        compatible_printer_ids: printers.map((pr) => pr.id),
        notes: "Demo product",
        is_active: true,
      },
      { isDemo: true },
    );
    products.set(p.sku, product);
    for (const v of p.variants ?? []) {
      const row = check(
        await ctx.supabase
          .from("product_variants")
          .insert({
            organization_id: ctx.orgId,
            product_id: product.id,
            sku: `DEMO-${v.sku}`,
            name: v.name,
            colour: v.colour,
            selling_price: v.price ?? null,
          })
          .select("id")
          .single(),
      ) as { id: string };
      variants.set(v.sku, row.id);
    }
  }

  // Customers
  const customerIds: string[] = [];
  for (const c of CUSTOMERS) {
    const row = check(
      await ctx.supabase
        .from("customers")
        .insert({ ...c, organization_id: ctx.orgId, country: "United Kingdom", notes: "Demo customer", is_demo: true })
        .select("id")
        .single(),
    ) as { id: string };
    customerIds.push(row.id);
  }

  // Orders
  let printingSlot = 0;
  for (const spec of ORDERS) {
    const orderDate = atDaysAgo(spec.daysAgo, spec.hour);
    const input = orderCreateSchema.parse({
      customer_id: customerIds[spec.customer],
      sales_channel: spec.channel,
      external_order_id: spec.ext ?? null,
      payment_status: spec.channel === "facebook_marketplace" && spec.stage === "new" ? "pending" : "paid",
      items: spec.items.map((i) => ({
        product_id: products.get(i.sku)!.id,
        variant_id: i.variant ? variants.get(i.variant) : null,
        quantity: i.qty,
      })),
      shipping_provider: spec.provider,
      shipping_service: spec.service,
      shipping_charged: spec.shipping,
      postage_cost: spec.postage,
      discount: spec.discount ?? 0,
      fees: spec.fees ?? 0,
      priority: spec.priority ?? "normal",
      internal_notes: spec.note ? `${spec.note} (demo)` : "Demo order",
    });
    const order = await createOrder(ctx, input, { isDemo: true, orderDate: orderDate.toISOString() });
    await applyStage(ctx, order.id, spec.stage, orderDate, { spoolFor, printers, slot: spec.stage === "printing" ? printingSlot++ : 0 });
  }

  await logAudit(ctx, "demo_data.loaded", { type: "organization", id: ctx.orgId }, "Demo data loaded", {
    products: PRODUCTS.length,
    customers: CUSTOMERS.length,
    orders: ORDERS.length,
    filaments: FILAMENTS.length,
  });
}

async function applyStage(
  ctx: AppContext,
  orderId: string,
  stage: Stage,
  orderDate: Date,
  helpers: {
    spoolFor: (material: string | null, colour: string | null) => Filament;
    printers: Pick<Printer, "id" | "name" | "model">[];
    slot: number;
  },
) {
  if (stage === "new") return;
  const jobs = check(await ctx.supabase.from("production_jobs").select("*").eq("order_id", orderId)) as ProductionJob[];
  const printedStages: Stage[] = ["printed", "packing", "ready_to_ship", "shipped", "completed"];

  let orderStatus: OrderStatus = stage === "failed" ? "awaiting_print" : (stage as OrderStatus);
  const orderPatch: Record<string, unknown> = {};

  if (printedStages.includes(stage)) {
    let cursor = addMinutes(orderDate, 90);
    for (const job of jobs) {
      const actualMinutes = Math.round(job.estimated_minutes * 1.04);
      const actualGrams = Math.round(Number(job.estimated_grams) * 1.03 * 10) / 10;
      const completedAt = addMinutes(cursor, actualMinutes);
      const spool = helpers.spoolFor(job.material, job.colour);
      await updateJob(ctx, job, "printed", {
        started_at: cursor.toISOString(),
        completed_at: completedAt.toISOString(),
        actual_minutes: actualMinutes,
        accumulated_minutes: actualMinutes,
        actual_grams: actualGrams,
        filament_id: spool.id,
      });
      const { error } = await ctx.supabase.rpc("record_filament_usage", {
        p_filament: spool.id,
        p_grams: actualGrams,
        p_job: job.id,
        p_note: "Demo print",
      });
      if (!error) {
        await ctx.supabase.from("filament_usage").update({ created_at: completedAt.toISOString() }).eq("production_job_id", job.id);
      }
      cursor = addMinutes(completedAt, 20);
    }
    orderPatch.production_status = "completed";
    if (stage === "packing") orderPatch.packing_status = "packing";
    if (["ready_to_ship", "shipped", "completed"].includes(stage)) orderPatch.packing_status = "packed";
    if (stage === "ready_to_ship") orderPatch.shipping_status = "ready";
    if (stage === "shipped" || stage === "completed") {
      const shippedAt = addMinutes(orderDate, 60 * 26).toISOString();
      orderPatch.shipping_status = "shipped";
      orderPatch.shipped_at = shippedAt;
      await ctx.supabase
        .from("shipments")
        .update({ shipped_at: shippedAt, notes: "Demo shipment — no real postage was bought" })
        .eq("order_id", orderId);
      if (stage === "completed") orderPatch.completed_at = addMinutes(orderDate, 60 * 24 * 4).toISOString();
    }
  }

  if (stage === "printing") {
    const printer = helpers.printers[helpers.slot % Math.max(helpers.printers.length, 1)];
    const job = jobs[0];
    const startedAt = new Date(Date.now() - (35 + helpers.slot * 50) * 60000).toISOString();
    await updateJob(ctx, job, "printing", {
      printer_id: printer?.id ?? job.printer_id,
      started_at: startedAt,
      last_resumed_at: startedAt,
    });
    if (printer) {
      await ctx.supabase
        .from("printers")
        .update({ status: "printing", status_source: "manual", status_updated_at: startedAt })
        .eq("id", printer.id);
    }
    orderPatch.production_status = "in_progress";
  }

  if (stage === "failed") {
    const job = jobs[0];
    await updateJob(ctx, job, "failed", {
      started_at: new Date(Date.now() - 5 * 3600000).toISOString(),
      failed_at: new Date(Date.now() - 3 * 3600000).toISOString(),
      accumulated_minutes: 70,
      failure_reason: "Spaghetti at ~40% — bed adhesion lost (demo)",
    });
    orderPatch.production_status = "failed";
  }

  if (stage === "cancelled") {
    for (const job of jobs) await updateJob(ctx, job, "cancelled", {});
    orderStatus = "cancelled";
  }

  check(await ctx.supabase.from("orders").update({ status: orderStatus, ...orderPatch }).eq("id", orderId));
  await recordStatusChange(ctx, "order", orderId, "new", orderStatus, "Demo data");
}

async function updateJob(ctx: AppContext, job: ProductionJob, status: JobStatus, patch: Partial<ProductionJob>) {
  check(await ctx.supabase.from("production_jobs").update({ status, ...patch }).eq("id", job.id));
  await recordStatusChange(ctx, "production_job", job.id, job.status, status, "Demo data");
}

export async function clearDemoData(ctx: AppContext) {
  const tables = ["orders", "filaments", "products", "customers"] as const;
  for (const table of tables) {
    check(await ctx.supabase.from(table).delete().eq("organization_id", ctx.orgId).eq("is_demo", true));
  }
  // Printers that were only "printing" because of demo jobs go back to idle.
  const { data: busy } = await ctx.supabase
    .from("production_jobs")
    .select("printer_id")
    .eq("organization_id", ctx.orgId)
    .eq("status", "printing");
  const busyIds = new Set((busy ?? []).map((r) => r.printer_id).filter(Boolean));
  const { data: printing } = await ctx.supabase
    .from("printers")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("status", "printing");
  for (const p of printing ?? []) {
    if (!busyIds.has(p.id)) {
      await ctx.supabase.from("printers").update({ status: "idle", status_updated_at: new Date().toISOString() }).eq("id", p.id);
    }
  }
  await logAudit(ctx, "demo_data.cleared", { type: "organization", id: ctx.orgId }, "Demo data removed");
}
