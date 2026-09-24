import type { Address, SalesChannel } from "@/types/db";

/**
 * A marketplace order converted into PrintFlow's channel-agnostic shape.
 * Every adapter (Etsy, eBay, Meta, website) produces this; everything after
 * normalisation — duplicate checks, SKU matching, order and job creation —
 * is shared code (see src/lib/services/order-import.ts).
 */
export interface NormalizedOrder {
  channel: SalesChannel;
  externalOrderId: string;
  orderedAt: string;
  buyer: {
    name: string;
    email?: string | null;
    phone?: string | null;
    externalBuyerId?: string | null;
  };
  shippingAddress?: Address | null;
  lines: NormalizedOrderLine[];
  shippingCharged: number;
  discount: number;
  fees: number;
  currency: string;
  paid: boolean;
  buyerNote?: string | null;
  /** Raw payload reference for debugging (never shown to customers). */
  sourceRef?: string | null;
}

export interface NormalizedOrderLine {
  externalLineId?: string | null;
  sku: string | null;
  title: string;
  quantity: number;
  unitPrice: number;
}

export interface MarketplaceIntegration {
  readonly id: string;
  readonly channel: SalesChannel;
  /** Fetch orders created/updated since the given time, already normalised. */
  fetchOrders(since: Date): Promise<NormalizedOrder[]>;
  /** Push fulfilment (shipped + tracking) back to the marketplace. */
  markShipped(externalOrderId: string, shipment: { carrier: string; trackingNumber: string | null; shippedAt: string }): Promise<void>;
  /** Optional: update stock/listing availability for a SKU. */
  syncInventory?(sku: string, available: number): Promise<void>;
}
