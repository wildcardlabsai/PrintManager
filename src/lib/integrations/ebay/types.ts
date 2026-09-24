/** Subset of the eBay Sell Fulfillment API v1 schemas (from eBay's OpenAPI contract). */
export interface EbayAmount {
  value?: string;
  currency?: string;
}

export interface EbayAddress {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  countryCode?: string;
  county?: string;
  postalCode?: string;
  stateOrProvince?: string;
}

export interface EbayContact {
  fullName?: string;
  companyName?: string;
  email?: string;
  primaryPhone?: { phoneNumber?: string };
  contactAddress?: EbayAddress;
}

export interface EbayLineItem {
  lineItemId?: string;
  legacyItemId?: string;
  legacyVariationId?: string;
  sku?: string;
  title?: string;
  quantity?: number;
  lineItemCost?: EbayAmount;
  total?: EbayAmount;
  lineItemFulfillmentStatus?: string;
  variationAspects?: { name?: string; value?: string }[];
}

export interface EbayOrder {
  orderId?: string;
  creationDate?: string;
  lastModifiedDate?: string;
  orderFulfillmentStatus?: string;
  orderPaymentStatus?: string;
  cancelStatus?: { cancelState?: string };
  buyer?: { username?: string; buyerRegistrationAddress?: EbayContact };
  buyerCheckoutNotes?: string;
  fulfillmentHrefs?: string[];
  fulfillmentStartInstructions?: { shippingStep?: { shipTo?: EbayContact; shippingCarrierCode?: string; shippingServiceCode?: string } }[];
  lineItems?: EbayLineItem[];
  pricingSummary?: {
    priceSubtotal?: EbayAmount;
    deliveryCost?: EbayAmount;
    deliveryDiscount?: EbayAmount;
    priceDiscount?: EbayAmount;
    tax?: EbayAmount;
    total?: EbayAmount;
  };
  totalMarketplaceFee?: EbayAmount;
}

export interface EbayOrderPage {
  orders?: EbayOrder[];
  total?: number;
  limit?: number;
  offset?: number;
  next?: string;
}
