import { roundMoney } from "@/lib/domain/money";
import { countryNameFromIso } from "@/lib/domain/countries";
import type { NormalizedOrder, NormalizedOrderStatus } from "../marketplace/types";
import type { EbayAmount, EbayOrder } from "./types";

export const ebayAmount = (a: EbayAmount | undefined | null) => (a?.value ? roundMoney(Math.abs(Number(a.value)) || 0) : 0);

export function ebayStatus(o: EbayOrder): NormalizedOrderStatus {
  if (o.cancelStatus?.cancelState === "CANCELED") return "cancelled";
  const pay = (o.orderPaymentStatus ?? "").toUpperCase();
  if (pay === "FULLY_REFUNDED") return "refunded";
  if (pay !== "PAID" && pay !== "PARTIALLY_REFUNDED") return "awaiting_payment";
  if ((o.orderFulfillmentStatus ?? "").toUpperCase() === "FULFILLED") return "shipped";
  return "paid";
}

export function normalizeEbayOrder(o: EbayOrder): NormalizedOrder {
  if (!o.orderId) throw new Error("eBay order has no orderId");
  const shipTo = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  const addr = shipTo?.contactAddress;
  const ps = o.pricingSummary ?? {};
  const currency = ps.total?.currency ?? o.lineItems?.[0]?.lineItemCost?.currency ?? "GBP";
  const lines = (o.lineItems ?? []).map((li) => {
    const qty = Math.max(1, li.quantity ?? 1);
    // lineItemCost = unit price × quantity (before discounts).
    return {
      externalLineId: li.lineItemId ?? "",
      externalListingId: li.legacyItemId ?? null,
      externalProductId: li.legacyVariationId ?? null,
      sku: li.sku?.trim() || null,
      title: li.title ?? "eBay item",
      variation: (li.variationAspects ?? []).map((v) => `${v.name}: ${v.value}`).join(", ") || null,
      quantity: qty,
      unitPrice: roundMoney(ebayAmount(li.lineItemCost) / qty),
    };
  });
  return {
    channel: "ebay",
    externalOrderId: o.orderId,
    externalStatusRaw: [o.orderPaymentStatus, o.orderFulfillmentStatus, o.cancelStatus?.cancelState].filter(Boolean).join(" / ") || null,
    status: ebayStatus(o),
    orderedAt: o.creationDate ?? new Date().toISOString(),
    updatedAt: o.lastModifiedDate ?? null,
    buyer: {
      name: shipTo?.fullName?.trim() || o.buyer?.username || "eBay buyer",
      email: shipTo?.email ?? null,
      phone: shipTo?.primaryPhone?.phoneNumber ?? null,
      externalBuyerId: o.buyer?.username ?? null,
    },
    shippingAddress: addr
      ? {
          line1: addr.addressLine1 ?? null,
          line2: addr.addressLine2 ?? null,
          city: addr.city ?? null,
          region: addr.stateOrProvince ?? addr.county ?? null,
          postcode: addr.postalCode ?? null,
          country: countryNameFromIso(addr.countryCode),
        }
      : null,
    lines,
    currency,
    subtotal: ebayAmount(ps.priceSubtotal),
    shippingCharged: ebayAmount(ps.deliveryCost),
    discount: roundMoney(ebayAmount(ps.priceDiscount) + ebayAmount(ps.deliveryDiscount)),
    tax: ebayAmount(ps.tax),
    total: ebayAmount(ps.total),
    fees: ebayAmount(o.totalMarketplaceFee),
    buyerNote: o.buyerCheckoutNotes ?? null,
    marketplaceShipments: [],
  };
}
