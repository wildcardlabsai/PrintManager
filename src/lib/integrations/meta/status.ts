/**
 * Meta / Facebook status for PrintFlow.
 *
 * Facebook Marketplace has no public API for reading orders or managing
 * listings for individual sellers. Meta's Commerce Platform APIs (order
 * management for Shops) are only available to businesses approved for Shops
 * with Meta checkout and to approved commerce partners, and are not generally
 * available to small UK sellers. PrintFlow therefore does not connect to Meta;
 * Facebook Marketplace sales are entered with the Manual Order workflow.
 */
export const META_STATUS = {
  state: "restricted" as const,
  label: "Not currently supported",
  summary:
    "Facebook Marketplace has no public order or listing API for individual sellers. Meta's Commerce order APIs require approval for Shops with Meta checkout.",
  fallback: "Record Facebook sales with New order → Sales channel: Facebook Marketplace. Duplicate protection still applies to the external order ID you enter.",
};
