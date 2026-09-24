import { z } from "zod";
import {
  JOB_PRIORITIES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PRINTER_STATUSES,
  SALES_CHANNELS,
  SHIPPING_PROVIDERS,
  SPOOL_STATUSES,
} from "@/types/db";
import {
  addressSchema,
  money,
  optionalEmail,
  optionalMoney,
  optionalText,
  optionalUuid,
  requiredText,
  wholeNumber,
} from "./common";

// ---------------------------------------------------------------- customers
export const customerSchema = z.object({
  name: requiredText("Name"),
  email: optionalEmail,
  phone: optionalText(40),
  address_line1: optionalText(200),
  address_line2: optionalText(200),
  city: optionalText(120),
  region: optionalText(120),
  postcode: optionalText(20),
  country: optionalText(80),
  notes: optionalText(4000),
});
export type CustomerInput = z.infer<typeof customerSchema>;

// ---------------------------------------------------------------- products
export const productSchema = z.object({
  sku: requiredText("SKU", 64).regex(/^[A-Za-z0-9._\-/]+$/, "SKU may only contain letters, numbers, . _ - /"),
  name: requiredText("Product name"),
  description: optionalText(4000),
  selling_price: money("Selling price"),
  filament_grams: money("Filament grams"),
  print_minutes: wholeNumber("Print time", 0, 100_000),
  filament_cost_per_kg: optionalMoney("Filament cost"),
  packaging_cost: optionalMoney("Packaging cost"),
  other_cost: money("Other cost").default(0),
  material: requiredText("Material", 40),
  default_colour: optionalText(60),
  packaging_type: optionalText(60),
  default_printer_id: optionalUuid,
  compatible_printer_ids: z.array(z.uuid()).default([]),
  notes: optionalText(4000),
  is_active: z.coerce.boolean().default(true),
});
export type ProductInput = z.infer<typeof productSchema>;

export const variantSchema = z.object({
  sku: requiredText("Variant SKU", 64).regex(/^[A-Za-z0-9._\-/]+$/, "SKU may only contain letters, numbers, . _ - /"),
  name: requiredText("Variant name", 120),
  colour: optionalText(60),
  material: optionalText(40),
  selling_price: optionalMoney("Price"),
  filament_grams: optionalMoney("Filament grams"),
  print_minutes: z
    .union([z.literal(""), z.null(), z.undefined(), z.coerce.number().int().min(0)]).optional()
    .transform((v) => (v === "" || v == null ? null : v)),
  is_active: z.coerce.boolean().default(true),
});
export type VariantInput = z.infer<typeof variantSchema>;

// ---------------------------------------------------------------- orders
export const orderItemInputSchema = z.object({
  product_id: z.uuid("Choose a product"),
  variant_id: optionalUuid,
  quantity: wholeNumber("Quantity", 1, 10_000),
  /** Optional price override (e.g. a marketplace price); defaults to the product price. */
  unit_price: optionalMoney("Unit price"),
  /** Marketplace line identity (Etsy transaction_id / eBay lineItemId). */
  external_line_id: optionalText(120),
  external_listing_id: optionalText(120),
});

export const orderCreateSchema = z
  .object({
    customer_id: optionalUuid,
    new_customer: z
      .object({
        name: requiredText("Customer name"),
        email: optionalEmail,
        phone: optionalText(40),
      })
      .nullish(),
    sales_channel: z.enum(SALES_CHANNELS),
    external_order_id: optionalText(120),
    order_date: z.iso.datetime({ offset: true }).nullish(),
    payment_status: z.enum(PAYMENT_STATUSES).default("paid"),
    items: z.array(orderItemInputSchema).min(1, "Add at least one product"),
    shipping_provider: z.enum(SHIPPING_PROVIDERS),
    shipping_service: optionalText(80),
    shipping_charged: money("Shipping charged").default(0),
    postage_cost: money("Postage cost").default(0),
    discount: money("Discount").default(0),
    fees: money("Fees").default(0),
    shipping_address: addressSchema.nullish(),
    save_address_to_customer: z.boolean().default(false),
    priority: z.enum(JOB_PRIORITIES).default("normal"),
    customer_notes: optionalText(4000),
    internal_notes: optionalText(4000),
  })
  .refine((v) => v.customer_id || v.new_customer, {
    message: "Choose a customer or enter a new one",
    path: ["customer_id"],
  });
export type OrderCreateInput = z.input<typeof orderCreateSchema>;
export type OrderCreateData = z.infer<typeof orderCreateSchema>;

export const orderStatusChangeSchema = z.object({
  order_id: z.uuid(),
  status: z.enum(ORDER_STATUSES),
  note: optionalText(500),
});

export const orderDetailsSchema = z.object({
  payment_status: z.enum(PAYMENT_STATUSES),
  external_order_id: optionalText(120),
  shipping_charged: money("Shipping charged"),
  discount: money("Discount"),
  fees: money("Fees"),
  shipping_address: addressSchema,
  customer_notes: optionalText(4000),
  internal_notes: optionalText(4000),
});
export type OrderDetailsInput = z.infer<typeof orderDetailsSchema>;

// ---------------------------------------------------------------- production
export const jobCompleteSchema = z.object({
  actual_minutes: wholeNumber("Actual print time", 0, 100_000).nullish(),
  actual_grams: optionalMoney("Filament used"),
  filament_id: optionalUuid,
  notes: optionalText(2000),
});
export type JobCompleteInput = z.infer<typeof jobCompleteSchema>;

export const jobUpdateSchema = z.object({
  printer_id: optionalUuid,
  priority: z.enum(JOB_PRIORITIES),
  material: optionalText(40),
  colour: optionalText(60),
  estimated_minutes: wholeNumber("Estimated time", 0, 100_000),
  estimated_grams: money("Estimated filament"),
  notes: optionalText(2000),
});
export type JobUpdateInput = z.infer<typeof jobUpdateSchema>;

// ---------------------------------------------------------------- printers
export const printerSchema = z.object({
  name: requiredText("Name", 120),
  manufacturer: optionalText(80).transform((v) => v ?? ""),
  model: optionalText(80).transform((v) => v ?? ""),
  status: z.enum(PRINTER_STATUSES),
  ip_address: optionalText(64),
  location: optionalText(120),
  build_volume: optionalText(80),
  capabilities: z
    .union([z.string(), z.array(z.string())])
    .transform((v) =>
      (Array.isArray(v) ? v : v.split(","))
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 30),
    )
    .default([]),
  notes: optionalText(4000),
});
export type PrinterInput = z.infer<typeof printerSchema>;

// ---------------------------------------------------------------- filament
export const filamentSchema = z
  .object({
    brand: optionalText(80).transform((v) => v ?? ""),
    material: requiredText("Material", 40),
    colour: requiredText("Colour", 60),
    colour_hex: z
      .union([z.literal(""), z.null(), z.undefined(), z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a hex colour like #1A2B3C")]).optional()
      .transform((v) => (v ? v : null)),
    weight_purchased_g: z.coerce.number({ error: "Weight must be a number" }).positive("Weight must be above zero").max(100_000),
    remaining_g: z.coerce.number({ error: "Remaining must be a number" }).min(0).max(100_000),
    cost: money("Cost"),
    status: z.enum(SPOOL_STATUSES),
    purchased_on: z
      .union([z.literal(""), z.null(), z.undefined(), z.iso.date()]).optional()
      .transform((v) => (v ? v : null)),
    notes: optionalText(2000),
  })
  .refine((v) => v.remaining_g <= v.weight_purchased_g, {
    message: "Remaining weight cannot exceed the purchased weight",
    path: ["remaining_g"],
  });
export type FilamentInput = z.infer<typeof filamentSchema>;

export const filamentUsageSchema = z.object({
  filament_id: z.uuid(),
  grams: z.coerce.number({ error: "Enter the grams used" }).positive("Enter the grams used").max(100_000),
  note: optionalText(500),
});

// ---------------------------------------------------------------- shipping
export const shipmentSchema = z.object({
  provider: z.enum(SHIPPING_PROVIDERS),
  service: optionalText(80),
  shipping_cost: money("Postage cost"),
  tracking_number: optionalText(80),
  notes: optionalText(2000),
});
export type ShipmentInput = z.infer<typeof shipmentSchema>;

// ---------------------------------------------------------------- settings
export const settingsSchema = z.object({
  business_name: requiredText("Business name", 120),
  currency: z.string().trim().length(3, "Use a 3-letter currency code").toUpperCase(),
  timezone: requiredText("Timezone", 64),
  electricity_cost_per_hour: money("Electricity cost"),
  default_filament_cost_per_kg: money("Filament cost"),
  default_packaging_cost: money("Packaging cost"),
  default_shipping_provider: z.enum(SHIPPING_PROVIDERS),
  default_printer_id: optionalUuid,
  order_number_prefix: z.string().trim().max(12, "Prefix is too long"),
  order_number_format: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .refine((v) => v.includes("{SEQ}"), "Format must include {SEQ}"),
  order_number_padding: wholeNumber("Padding", 1, 10),
  next_order_number: wholeNumber("Next order number", 1, 1_000_000_000),
  low_filament_threshold_g: wholeNumber("Low filament threshold", 0, 10_000),
  notifications: z.record(z.string(), z.boolean()),
});
export type SettingsInput = z.infer<typeof settingsSchema>;
