import { describe, expect, it } from "vitest";
import { filamentSchema, orderCreateSchema, productSchema, settingsSchema } from "@/lib/validation/schemas";

const uuid = "8a3b5c6d-1e2f-4a5b-9c8d-7e6f5a4b3c2d";

describe("orderCreateSchema", () => {
  it("accepts items without optional keys (regression: zod v4 optional unions)", () => {
    const r = orderCreateSchema.safeParse({
      customer_id: uuid,
      sales_channel: "etsy",
      items: [{ product_id: uuid, quantity: 2 }],
      shipping_provider: "royal_mail",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.items[0].unit_price).toBeNull();
      expect(r.data.items[0].variant_id).toBeNull();
      expect(r.data.payment_status).toBe("paid");
    }
  });

  it("coerces form strings and blanks", () => {
    const r = orderCreateSchema.parse({
      new_customer: { name: "Ada", email: "" },
      sales_channel: "manual",
      items: [{ product_id: uuid, variant_id: "", quantity: "3", unit_price: "" }],
      shipping_provider: "evri",
      shipping_charged: "2.99",
      discount: "",
    });
    expect(r.items[0].quantity).toBe(3);
    expect(r.shipping_charged).toBe(2.99);
    expect(r.new_customer?.email).toBeNull();
  });

  it("requires a customer and at least one item", () => {
    expect(orderCreateSchema.safeParse({ sales_channel: "manual", items: [], shipping_provider: "evri" }).success).toBe(false);
    expect(
      orderCreateSchema.safeParse({ sales_channel: "manual", items: [{ product_id: uuid, quantity: 1 }], shipping_provider: "evri" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown sales channels (marketplace-agnostic enum)", () => {
    expect(
      orderCreateSchema.safeParse({ customer_id: uuid, sales_channel: "amazon", items: [{ product_id: uuid, quantity: 1 }], shipping_provider: "evri" })
        .success,
    ).toBe(false);
  });
});

describe("other schemas", () => {
  it("product: blank overrides become null", () => {
    const p = productSchema.parse({
      sku: "ABC-1",
      name: "Thing",
      selling_price: "5",
      filament_grams: "10",
      print_minutes: "30",
      filament_cost_per_kg: "",
      packaging_cost: "",
      material: "PLA",
      default_printer_id: "",
    });
    expect(p.filament_cost_per_kg).toBeNull();
    expect(p.default_printer_id).toBeNull();
  });

  it("filament: remaining cannot exceed purchased", () => {
    const r = filamentSchema.safeParse({ material: "PLA", colour: "Red", weight_purchased_g: 1000, remaining_g: 1200, cost: 20, status: "in_use" });
    expect(r.success).toBe(false);
  });

  it("settings: order number format must contain {SEQ}", () => {
    const base = {
      business_name: "x",
      currency: "gbp",
      timezone: "Europe/London",
      electricity_cost_per_hour: 0.2,
      default_filament_cost_per_kg: 20,
      default_packaging_cost: 0.4,
      default_shipping_provider: "royal_mail",
      order_number_prefix: "PF",
      order_number_padding: 4,
      next_order_number: 1,
      low_filament_threshold_g: 100,
      notifications: {},
    };
    expect(settingsSchema.safeParse({ ...base, order_number_format: "{PREFIX}" }).success).toBe(false);
    expect(settingsSchema.parse({ ...base, order_number_format: "{PREFIX}-{SEQ}" }).currency).toBe("GBP");
  });
});
