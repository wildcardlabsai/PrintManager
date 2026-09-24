import type { ShippingIntegration } from "./types";
import { royalMailClickDrop } from "./royal-mail-click-drop";

/** Shipping providers with a real, implemented adapter. */
export const SHIPPING_INTEGRATIONS: Record<string, ShippingIntegration> = {
  royal_mail_click_drop: royalMailClickDrop,
};

/** Providers without a public API PrintFlow can use today — shown honestly in Settings. */
export const UNAVAILABLE_SHIPPING_PROVIDERS = [
  { id: "evri", name: "Evri", reason: "Evri's label API is only offered to contracted business accounts; no self-serve API to connect." },
  { id: "dpd", name: "DPD", reason: "DPD's shipping API requires a DPD business account and onboarding; not self-serve." },
  { id: "yodel", name: "Yodel", reason: "Yodel's API is available to contracted business customers only." },
];
