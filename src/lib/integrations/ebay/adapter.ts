import type { ShippingProvider } from "@/types/db";
import { ebayConfig } from "../config";
import { IntegrationError } from "../errors";
import type { FulfillmentPush, FulfillmentResult, MarketplaceIntegration, NormalizedOrder } from "../marketplace/types";
import { ebayRequest } from "./client";
import { normalizeEbayOrder } from "./normalize";
import type { EbayOrder, EbayOrderPage } from "./types";

const PAGE_SIZE = 200;

/**
 * eBay shippingCarrierCode values. eBay validates these; verify against the
 * carriers enabled for your site and override per connection if needed
 * (integration_connections.config.carrierCodes).
 */
export const EBAY_CARRIERS: Record<ShippingProvider, string> = {
  royal_mail: "RoyalMail",
  evri: "Evri",
  dpd: "DPD",
  yodel: "Yodel",
  other: "Other",
};

export function ebayFulfillmentBody(input: FulfillmentPush, carrierOverrides: Partial<Record<ShippingProvider, string>> = {}) {
  if (!input.trackingNumber) {
    throw new IntegrationError("validation", "eBay needs a tracking number to record the shipment. Add tracking first.", { provider: "eBay" });
  }
  if (!input.lines.length || input.lines.some((l) => !l.externalLineId)) {
    throw new IntegrationError("validation", "This order has no eBay line item IDs to fulfil.", { provider: "eBay" });
  }
  return {
    lineItems: input.lines.map((l) => ({ lineItemId: l.externalLineId, quantity: l.quantity })),
    shippedDate: new Date(input.shippedAt).toISOString(),
    shippingCarrierCode: carrierOverrides[input.provider] ?? EBAY_CARRIERS[input.provider],
    trackingNumber: input.trackingNumber,
  };
}

/** eBay's order search filter: lastmodifieddate:[<ISO>..] */
export function ebayOrderFilter(since: Date) {
  return `lastmodifieddate:[${since.toISOString()}..]`;
}

export const ebayAdapter: MarketplaceIntegration = {
  id: "ebay",
  channel: "ebay",

  async listOrdersSince(auth, since, opts = {}) {
    const maxPages = opts.maxPages ?? 10;
    const c = ebayConfig();
    const orders: NormalizedOrder[] = [];
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const q = new URLSearchParams({ filter: ebayOrderFilter(since), limit: String(PAGE_SIZE), offset: String(offset) });
      const { data } = await ebayRequest<EbayOrderPage>(auth, `${c.apiBase}/sell/fulfillment/v1/order?${q}`);
      if (!data || (data.orders !== undefined && !Array.isArray(data.orders))) {
        throw new IntegrationError("invalid_response", "eBay order search returned an unexpected shape", { provider: "eBay" });
      }
      const batch = data.orders ?? [];
      for (const o of batch) orders.push(normalizeEbayOrder(o));
      offset += batch.length;
      if (batch.length < PAGE_SIZE || !data.next) return { orders, truncated: false };
    }
    return { orders, truncated: true };
  },

  async getOrder(auth, externalOrderId) {
    const c = ebayConfig();
    try {
      const { data } = await ebayRequest<EbayOrder>(auth, `${c.apiBase}/sell/fulfillment/v1/order/${encodeURIComponent(externalOrderId)}`);
      return normalizeEbayOrder(data);
    } catch (e) {
      if (e instanceof IntegrationError && e.details.status === 404) return null;
      throw e;
    }
  },

  async pushFulfillment(auth, input): Promise<FulfillmentResult> {
    const c = ebayConfig();
    const body = ebayFulfillmentBody(input);
    const { response } = await ebayRequest<unknown>(
      auth,
      `${c.apiBase}/sell/fulfillment/v1/order/${encodeURIComponent(input.externalOrderId)}/shipping_fulfillment`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), retries: 2 },
    );
    // Success is 201 Created with the new fulfillment's URI in Location.
    if (response.status !== 201 && response.status !== 200) {
      throw new IntegrationError("invalid_response", `eBay returned HTTP ${response.status} instead of 201 Created`, { provider: "eBay" });
    }
    const location = response.headers.get("location");
    const fulfillmentId = location?.split("/").filter(Boolean).pop() ?? null;
    return { externalFulfillmentId: fulfillmentId, response: { status: response.status, location, request: body } };
  },
};
