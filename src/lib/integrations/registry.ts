import type { SalesChannel } from "@/types/db";
import { ebayAdapter } from "./ebay/adapter";
import { etsyAdapter } from "./etsy/adapter";
import type { MarketplaceIntegration } from "./marketplace/types";

export type MarketplaceProvider = "etsy" | "ebay";
export type IntegrationProvider = MarketplaceProvider | "royal_mail_click_drop";

export const MARKETPLACES: Record<MarketplaceProvider, MarketplaceIntegration> = {
  etsy: etsyAdapter,
  ebay: ebayAdapter,
};

export const PROVIDER_NAMES: Record<IntegrationProvider, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  royal_mail_click_drop: "Royal Mail Click & Drop",
};

export function marketplaceForChannel(channel: SalesChannel): MarketplaceProvider | null {
  return channel === "etsy" || channel === "ebay" ? channel : null;
}
