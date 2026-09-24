import type { IntegrationAvailability, IntegrationDescriptor } from "./types";

/**
 * Catalogue of planned integrations. Nothing here is connected in Phase 1;
 * the Settings page lists these as "Coming in Phase 2/3".
 */
export const INTEGRATIONS: IntegrationDescriptor[] = [
  {
    id: "etsy",
    kind: "marketplace",
    name: "Etsy",
    phase: 2,
    env: ["ETSY_API_KEY", "ETSY_SHARED_SECRET"],
    capabilities: ["Import orders", "Sync shipped status & tracking", "Listing inventory"],
  },
  {
    id: "ebay",
    kind: "marketplace",
    name: "eBay",
    phase: 2,
    env: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
    capabilities: ["Import orders", "Sync shipped status & tracking", "Inventory"],
  },
  {
    id: "meta",
    kind: "marketplace",
    name: "Facebook / Meta",
    phase: 2,
    env: ["META_APP_ID", "META_APP_SECRET"],
    capabilities: ["Import orders where Meta's commerce APIs allow"],
    notes: "Facebook Marketplace personal listings have no order API; those stay manual.",
  },
  {
    id: "royal_mail",
    kind: "shipping",
    name: "Royal Mail Click & Drop",
    phase: 2,
    env: ["ROYAL_MAIL_API_KEY"],
    capabilities: ["Create labels", "Tracking numbers"],
  },
  {
    id: "evri",
    kind: "shipping",
    name: "Evri",
    phase: 2,
    env: ["EVRI_API_KEY"],
    capabilities: ["Create labels", "Tracking numbers"],
  },
  {
    id: "flashforge",
    kind: "printer",
    name: "Flashforge (AD5X, Adventurer 5M)",
    phase: 3,
    env: [],
    capabilities: ["Live status", "Progress & remaining time", "Temperatures", "Start jobs where supported"],
    notes: "Connects over the local network; will need a small connector running on your network.",
  },
];

export function integrationAvailability(descriptor: IntegrationDescriptor): IntegrationAvailability {
  // No adapters exist in Phase 1.
  return { state: "planned", phase: descriptor.phase };
}
