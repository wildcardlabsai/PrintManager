import type { ShippingProvider } from "@/types/db";
import type { FulfillmentPush, FulfillmentResult, MarketplaceAuth, MarketplaceIntegration, NormalizedOrder } from "../marketplace/types";
import { IntegrationError } from "../errors";
import { etsyRequest } from "./client";
import { normalizeEtsyReceipt } from "./normalize";
import type { EtsyPaged, EtsyReceipt } from "./types";

const PAGE_SIZE = 100;

/** Carrier names sent to Etsy's createReceiptShipment. */
export const ETSY_CARRIERS: Record<ShippingProvider, string> = {
  royal_mail: "royal-mail",
  evri: "evri",
  dpd: "dpd-uk",
  yodel: "yodel",
  other: "other",
};

export function etsyShipmentBody(input: FulfillmentPush) {
  const body: Record<string, unknown> = { send_bcc: true };
  if (input.trackingNumber) {
    body.tracking_code = input.trackingNumber;
    body.carrier_name = ETSY_CARRIERS[input.provider];
  }
  return body;
}

export const etsyAdapter: MarketplaceIntegration = {
  id: "etsy",
  channel: "etsy",

  async listOrdersSince(auth: MarketplaceAuth, since: Date, opts = {}) {
    const maxPages = opts.maxPages ?? 10;
    const orders: NormalizedOrder[] = [];
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const q = new URLSearchParams({
        min_last_modified: String(Math.floor(since.getTime() / 1000)),
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort_on: "updated",
        sort_order: "asc",
      });
      const data = await etsyRequest<EtsyPaged<EtsyReceipt>>(auth, `/v3/application/shops/${auth.accountId}/receipts?${q}`);
      if (!data || !Array.isArray(data.results)) {
        throw new IntegrationError("invalid_response", "Etsy receipts response had no results array", { provider: "Etsy" });
      }
      for (const r of data.results) orders.push(normalizeEtsyReceipt(r));
      offset += data.results.length;
      if (data.results.length < PAGE_SIZE || (data.count != null && offset >= data.count)) return { orders, truncated: false };
    }
    return { orders, truncated: true };
  },

  async getOrder(auth, externalOrderId) {
    if (!/^\d+$/.test(externalOrderId)) return null;
    try {
      const r = await etsyRequest<EtsyReceipt>(auth, `/v3/application/shops/${auth.accountId}/receipts/${externalOrderId}`);
      return normalizeEtsyReceipt(r);
    } catch (e) {
      if (e instanceof IntegrationError && e.details.status === 404) return null;
      throw e;
    }
  },

  async pushFulfillment(auth, input): Promise<FulfillmentResult> {
    const r = await etsyRequest<EtsyReceipt>(auth, `/v3/application/shops/${auth.accountId}/receipts/${input.externalOrderId}/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(etsyShipmentBody(input)),
      retries: 2,
    });
    // Etsy returns the updated receipt; confirm it now shows as shipped.
    if (!r || typeof r !== "object" || r.receipt_id == null) {
      throw new IntegrationError("invalid_response", "Etsy did not return the updated receipt", { provider: "Etsy" });
    }
    const shipment = [...(r.shipments ?? [])].reverse().find((s) => !input.trackingNumber || s.tracking_code === input.trackingNumber);
    return {
      externalFulfillmentId: shipment?.receipt_shipping_id != null ? String(shipment.receipt_shipping_id) : null,
      response: {
        receipt_id: r.receipt_id,
        is_shipped: r.is_shipped ?? null,
        status: r.status ?? null,
        shipment: shipment ?? null,
      },
    };
  },
};
