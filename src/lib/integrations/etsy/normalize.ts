import { roundMoney } from "@/lib/domain/money";
import { countryNameFromIso } from "@/lib/domain/countries";
import type { NormalizedOrder, NormalizedOrderStatus } from "../marketplace/types";
import type { EtsyMoney, EtsyReceipt } from "./types";

export function etsyMoney(m: EtsyMoney | undefined | null): number {
  if (!m || m.amount == null) return 0;
  const divisor = m.divisor && m.divisor > 0 ? m.divisor : 100;
  return roundMoney(m.amount / divisor);
}

const ts = (s: number | undefined | null) => (s ? new Date(s * 1000).toISOString() : null);

export function etsyStatus(r: EtsyReceipt): NormalizedOrderStatus {
  const s = (r.status ?? "").toLowerCase();
  if (s === "canceled" || s === "cancelled") return "cancelled";
  if (s === "fully refunded") return "refunded";
  if (!r.is_paid) return "awaiting_payment";
  if (r.is_shipped) return s === "completed" ? "completed" : "shipped";
  return "paid";
}

export function normalizeEtsyReceipt(r: EtsyReceipt): NormalizedOrder {
  if (!r.receipt_id) throw new Error("Etsy receipt has no receipt_id");
  const currency = r.grandtotal?.currency_code ?? r.subtotal?.currency_code ?? "GBP";
  const lines = (r.transactions ?? []).map((t) => ({
    externalLineId: String(t.transaction_id ?? ""),
    externalListingId: t.listing_id != null ? String(t.listing_id) : null,
    externalProductId: t.product_id != null ? String(t.product_id) : null,
    sku: t.sku?.trim() || null,
    title: t.title ?? "Etsy item",
    variation:
      (t.variations ?? [])
        .map((v) => [v.formatted_name, v.formatted_value].filter(Boolean).join(": "))
        .filter(Boolean)
        .join(", ") || null,
    quantity: Math.max(1, t.quantity ?? 1),
    // Etsy transaction price is the per-unit price.
    unitPrice: etsyMoney(t.price),
  }));
  const hasAddress = Boolean(r.first_line || r.city || r.zip);
  const note = [r.message_from_buyer, r.is_gift && r.gift_message ? `Gift message: ${r.gift_message}` : null]
    .filter(Boolean)
    .join("\n");
  return {
    channel: "etsy",
    externalOrderId: String(r.receipt_id),
    externalStatusRaw: r.status ?? null,
    status: etsyStatus(r),
    orderedAt: ts(r.created_timestamp ?? r.create_timestamp) ?? new Date().toISOString(),
    updatedAt: ts(r.updated_timestamp ?? r.update_timestamp),
    buyer: {
      name: r.name?.trim() || "Etsy buyer",
      email: r.buyer_email ?? null,
      phone: null,
      externalBuyerId: r.buyer_user_id != null ? String(r.buyer_user_id) : null,
    },
    shippingAddress: hasAddress
      ? {
          line1: r.first_line ?? null,
          line2: r.second_line ?? null,
          city: r.city ?? null,
          region: r.state ?? null,
          postcode: r.zip ?? null,
          country: countryNameFromIso(r.country_iso),
        }
      : null,
    lines,
    currency,
    subtotal: etsyMoney(r.subtotal),
    shippingCharged: etsyMoney(r.total_shipping_cost),
    discount: etsyMoney(r.discount_amt),
    tax: roundMoney(etsyMoney(r.total_tax_cost) + etsyMoney(r.total_vat_cost)),
    total: etsyMoney(r.grandtotal),
    fees: 0,
    buyerNote: note || null,
    marketplaceShipments: (r.shipments ?? []).map((s) => ({
      carrier: s.carrier_name ?? null,
      trackingNumber: s.tracking_code ?? null,
      shippedAt: ts(s.shipment_notification_timestamp),
    })),
  };
}
