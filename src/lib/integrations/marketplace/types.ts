import type { Address, SalesChannel, ShippingProvider } from "@/types/db";

/**
 * A marketplace order in PrintFlow's channel-agnostic shape. Every adapter
 * (Etsy, eBay, and manual/website entry in future) produces this; everything
 * after normalisation — duplicate detection, product mapping, customer
 * matching, order and production-job creation — is shared code
 * (src/lib/services/integrations/import.ts).
 */
export type NormalizedOrderStatus = "awaiting_payment" | "paid" | "shipped" | "completed" | "cancelled" | "refunded";

export interface NormalizedOrder {
  channel: SalesChannel;
  externalOrderId: string;
  /** Marketplace's own status string, kept for display/debugging. */
  externalStatusRaw: string | null;
  status: NormalizedOrderStatus;
  orderedAt: string;
  updatedAt: string | null;
  buyer: {
    name: string;
    email: string | null;
    phone: string | null;
    /** Marketplace buyer id / username, for privacy requests. */
    externalBuyerId: string | null;
  };
  shippingAddress: Address | null;
  lines: NormalizedOrderLine[];
  currency: string;
  subtotal: number;
  shippingCharged: number;
  discount: number;
  tax: number;
  total: number;
  /** Marketplace fees where the API reports them (eBay does; Etsy receipts don't). */
  fees: number;
  buyerNote: string | null;
  /** Shipments already recorded on the marketplace. */
  marketplaceShipments: { carrier: string | null; trackingNumber: string | null; shippedAt: string | null }[];
}

export interface NormalizedOrderLine {
  /** Etsy transaction_id / eBay lineItemId — needed to fulfil the line. */
  externalLineId: string;
  externalListingId: string | null;
  /** Etsy product_id (listing variation) / eBay legacyVariationId. */
  externalProductId: string | null;
  sku: string | null;
  title: string;
  variation: string | null;
  quantity: number;
  unitPrice: number;
}

export interface MarketplaceAuth {
  /** Returns a valid access token, refreshing it if needed. */
  getAccessToken(): Promise<string>;
  /** Forces a refresh (used once after a 401). */
  refreshAccessToken(): Promise<string>;
  /** Etsy shop_id / eBay user id. */
  accountId: string;
}

export interface FulfillmentPush {
  externalOrderId: string;
  lines: { externalLineId: string; quantity: number }[];
  trackingNumber: string | null;
  provider: ShippingProvider;
  service: string | null;
  shippedAt: string;
}

export interface FulfillmentResult {
  externalFulfillmentId: string | null;
  /** Sanitised confirmation from the marketplace, stored for audit. */
  response: Record<string, unknown>;
}

export interface MarketplaceIntegration {
  readonly id: "etsy" | "ebay";
  readonly channel: SalesChannel;
  /** Orders created or modified at/after `since`, normalised. */
  listOrdersSince(auth: MarketplaceAuth, since: Date, opts?: { maxPages?: number }): Promise<{ orders: NormalizedOrder[]; truncated: boolean }>;
  getOrder(auth: MarketplaceAuth, externalOrderId: string): Promise<NormalizedOrder | null>;
  pushFulfillment(auth: MarketplaceAuth, input: FulfillmentPush): Promise<FulfillmentResult>;
}
