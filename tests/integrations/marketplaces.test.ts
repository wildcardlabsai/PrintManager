import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { normalizeEtsyReceipt, etsyMoney } from "@/lib/integrations/etsy/normalize";
import { etsyShipmentBody } from "@/lib/integrations/etsy/adapter";
import { normaliseEtsyEventType, receiptIdFromResourceUrl, signEtsyWebhook, verifyEtsyWebhook } from "@/lib/integrations/etsy/webhook";
import { normalizeEbayOrder } from "@/lib/integrations/ebay/normalize";
import { ebayFulfillmentBody, ebayOrderFilter } from "@/lib/integrations/ebay/adapter";
import { ebayChallengeResponse, parseEbaySignatureHeader, verifyEbaySignature } from "@/lib/integrations/ebay/notifications";
import { clickDropOrderRequest } from "@/lib/integrations/shipping/royal-mail-click-drop";
import type { EtsyReceipt } from "@/lib/integrations/etsy/types";
import type { EbayOrder } from "@/lib/integrations/ebay/types";

const receipt: EtsyReceipt = {
  receipt_id: 3012345678,
  buyer_user_id: 998,
  buyer_email: "buyer@example.com",
  name: "Ada Lovelace",
  first_line: "12 Analytical St",
  city: "London",
  state: "Greater London",
  zip: "NW1 1AA",
  country_iso: "GB",
  status: "Paid",
  is_paid: true,
  is_shipped: false,
  created_timestamp: 1790000000,
  updated_timestamp: 1790000100,
  message_from_buyer: "Please add a note",
  grandtotal: { amount: 2897, divisor: 100, currency_code: "GBP" },
  subtotal: { amount: 2598, divisor: 100, currency_code: "GBP" },
  total_shipping_cost: { amount: 299, divisor: 100, currency_code: "GBP" },
  discount_amt: { amount: 0, divisor: 100, currency_code: "GBP" },
  transactions: [
    { transaction_id: 11, listing_id: 555, product_id: 777, sku: "PCD-BLK-01", title: "Pokemon Card Display", quantity: 2, price: { amount: 1299, divisor: 100, currency_code: "GBP" }, variations: [{ formatted_name: "Colour", formatted_value: "Black" }] },
  ],
};

describe("Etsy normalisation", () => {
  it("converts money using the divisor", () => {
    expect(etsyMoney({ amount: 1299, divisor: 100 })).toBe(12.99);
    expect(etsyMoney(undefined)).toBe(0);
  });
  it("maps a paid receipt to a normalised order", () => {
    const o = normalizeEtsyReceipt(receipt);
    expect(o).toMatchObject({
      channel: "etsy",
      externalOrderId: "3012345678",
      status: "paid",
      currency: "GBP",
      subtotal: 25.98,
      shippingCharged: 2.99,
      total: 28.97,
      buyer: { name: "Ada Lovelace", email: "buyer@example.com", externalBuyerId: "998" },
      shippingAddress: { line1: "12 Analytical St", postcode: "NW1 1AA", country: "United Kingdom" },
    });
    expect(o.lines[0]).toEqual({
      externalLineId: "11",
      externalListingId: "555",
      externalProductId: "777",
      sku: "PCD-BLK-01",
      title: "Pokemon Card Display",
      variation: "Colour: Black",
      quantity: 2,
      unitPrice: 12.99,
    });
    expect(o.orderedAt).toBe(new Date(1790000000 * 1000).toISOString());
  });
  it("derives status from payment/shipping/cancellation", () => {
    expect(normalizeEtsyReceipt({ ...receipt, is_paid: false, status: "Open" }).status).toBe("awaiting_payment");
    expect(normalizeEtsyReceipt({ ...receipt, status: "Canceled" }).status).toBe("cancelled");
    expect(normalizeEtsyReceipt({ ...receipt, is_shipped: true }).status).toBe("shipped");
    expect(normalizeEtsyReceipt({ ...receipt, status: "Fully Refunded" }).status).toBe("refunded");
  });
  it("builds the tracking request", () => {
    expect(etsyShipmentBody({ externalOrderId: "1", lines: [], trackingNumber: "TT1GB", provider: "royal_mail", service: null, shippedAt: "" })).toEqual({
      send_bcc: true,
      tracking_code: "TT1GB",
      carrier_name: "royal-mail",
    });
    expect(etsyShipmentBody({ externalOrderId: "1", lines: [], trackingNumber: null, provider: "royal_mail", service: null, shippedAt: "" })).toEqual({ send_bcc: true });
  });
});

describe("Etsy webhooks", () => {
  const secret = `whsec_${Buffer.from("super-secret-signing-key-0123456789").toString("base64")}`;
  const body = JSON.stringify({ event_type: "ORDER_PAID", resource_url: "https://api.etsy.com/v3/application/shops/42/receipts/3012345678", shop_id: 42 });
  const now = 1790000000;
  it("accepts a valid signature (including rotated keys)", () => {
    const sig = signEtsyWebhook(secret, "msg_1", String(now), body);
    expect(verifyEtsyWebhook(secret, { id: "msg_1", timestamp: String(now), signature: `v1,bogus v1,${sig}` }, body, now)).toEqual({ ok: true });
  });
  it("rejects tampered bodies, stale timestamps and missing headers", () => {
    const sig = signEtsyWebhook(secret, "msg_1", String(now), body);
    expect(verifyEtsyWebhook(secret, { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` }, body + " ", now).ok).toBe(false);
    expect(verifyEtsyWebhook(secret, { id: "msg_1", timestamp: String(now - 3600), signature: `v1,${sig}` }, body, now).ok).toBe(false);
    expect(verifyEtsyWebhook(secret, { id: null, timestamp: String(now), signature: `v1,${sig}` }, body, now).ok).toBe(false);
    expect(verifyEtsyWebhook("", { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` }, body, now).ok).toBe(false);
  });
  it("only trusts receipt URLs for the notifying shop", () => {
    expect(receiptIdFromResourceUrl("https://api.etsy.com/v3/application/shops/42/receipts/3012345678", "42")).toBe("3012345678");
    expect(receiptIdFromResourceUrl("https://api.etsy.com/v3/application/shops/43/receipts/1", "42")).toBeNull();
    expect(receiptIdFromResourceUrl("https://evil.example/", "42")).toBeNull();
    expect(normaliseEtsyEventType("ORDER_PAID")).toBe("order.paid");
  });
});

const ebayOrder: EbayOrder = {
  orderId: "12-34567-89012",
  creationDate: "2026-09-20T10:00:00.000Z",
  lastModifiedDate: "2026-09-20T10:05:00.000Z",
  orderPaymentStatus: "PAID",
  orderFulfillmentStatus: "NOT_STARTED",
  cancelStatus: { cancelState: "NONE_REQUESTED" },
  buyer: { username: "card_collector_99" },
  fulfillmentStartInstructions: [
    {
      shippingStep: {
        shipTo: {
          fullName: "Charles Babbage",
          email: "cb@example.com",
          primaryPhone: { phoneNumber: "07700 900123" },
          contactAddress: { addressLine1: "1 Difference Rd", city: "Bristol", postalCode: "BS1 1AA", countryCode: "GB" },
        },
      },
    },
  ],
  lineItems: [{ lineItemId: "10001", legacyItemId: "2233", sku: "PCD-BLK-01", title: "Card display", quantity: 3, lineItemCost: { value: "38.97", currency: "GBP" } }],
  pricingSummary: { priceSubtotal: { value: "38.97", currency: "GBP" }, deliveryCost: { value: "3.99", currency: "GBP" }, total: { value: "42.96", currency: "GBP" } },
  totalMarketplaceFee: { value: "5.41", currency: "GBP" },
};

describe("eBay normalisation", () => {
  it("maps a paid order, deriving unit price from lineItemCost", () => {
    const o = normalizeEbayOrder(ebayOrder);
    expect(o).toMatchObject({
      channel: "ebay",
      externalOrderId: "12-34567-89012",
      status: "paid",
      subtotal: 38.97,
      shippingCharged: 3.99,
      total: 42.96,
      fees: 5.41,
      buyer: { name: "Charles Babbage", email: "cb@example.com", phone: "07700 900123", externalBuyerId: "card_collector_99" },
    });
    expect(o.lines[0]).toMatchObject({ externalLineId: "10001", externalListingId: "2233", quantity: 3, unitPrice: 12.99 });
  });
  it("maps cancellation, pending payment and fulfilment", () => {
    expect(normalizeEbayOrder({ ...ebayOrder, cancelStatus: { cancelState: "CANCELED" } }).status).toBe("cancelled");
    expect(normalizeEbayOrder({ ...ebayOrder, orderPaymentStatus: "PENDING" }).status).toBe("awaiting_payment");
    expect(normalizeEbayOrder({ ...ebayOrder, orderFulfillmentStatus: "FULFILLED" }).status).toBe("shipped");
  });
  it("builds a shipping fulfilment and requires tracking + line ids", () => {
    const base = { externalOrderId: "1", lines: [{ externalLineId: "10001", quantity: 3 }], trackingNumber: "TT9GB", provider: "royal_mail" as const, service: null, shippedAt: "2026-09-21T09:00:00Z" };
    expect(ebayFulfillmentBody(base)).toEqual({
      lineItems: [{ lineItemId: "10001", quantity: 3 }],
      shippedDate: "2026-09-21T09:00:00.000Z",
      shippingCarrierCode: "RoyalMail",
      trackingNumber: "TT9GB",
    });
    expect(() => ebayFulfillmentBody({ ...base, trackingNumber: null })).toThrow(/tracking/);
    expect(() => ebayFulfillmentBody({ ...base, lines: [] })).toThrow(/line item/);
    expect(ebayOrderFilter(new Date("2026-09-01T00:00:00Z"))).toBe("lastmodifieddate:[2026-09-01T00:00:00.000Z..]");
  });
});

describe("eBay account deletion notifications", () => {
  it("computes the endpoint challenge response", () => {
    // sha256("abc" + "token" + "https://x/y") in hex
    expect(ebayChallengeResponse("abc", "token", "https://x/y")).toMatch(/^[0-9a-f]{64}$/);
    expect(ebayChallengeResponse("abc", "token", "https://x/y")).not.toBe(ebayChallengeResponse("abd", "token", "https://x/y"));
  });
  it("verifies ECDSA signatures from the x-ebay-signature header", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const body = JSON.stringify({ metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" }, notification: { data: { username: "u" } } });
    const signer = createSign("SHA1");
    signer.update(body);
    const signature = signer.sign(privateKey).toString("base64");
    const header = Buffer.from(JSON.stringify({ alg: "ECDSA", kid: "k1", signature, digest: "SHA1" })).toString("base64");
    const parsed = parseEbaySignatureHeader(header)!;
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyEbaySignature(body, parsed, pem)).toBe(true);
    expect(verifyEbaySignature(body + "x", parsed, pem)).toBe(false);
    // eBay's getPublicKey returns the PEM on one line.
    expect(verifyEbaySignature(body, parsed, pem.replace(/\n/g, ""))).toBe(true);
    expect(parseEbaySignatureHeader("not-base64-json")).toBeNull();
  });
});

describe("Royal Mail Click & Drop request", () => {
  const req = {
    orderNumber: "PF-1042",
    orderDate: "2026-09-21T10:00:00Z",
    serviceCode: null,
    recipient: { name: "Ada Lovelace", email: "a@example.com", phone: null, address: { line1: "12 Analytical St", city: "London", postcode: "NW1 1AA", country: "United Kingdom" } },
    parcel: { weightGrams: 180, format: "largeLetter" as const },
    contents: [{ name: "Card display", sku: "PCD-BLK-01", quantity: 2, unitValue: 12.99, unitWeightGrams: null }],
    subtotal: 25.98,
    shippingCharged: 2.99,
    total: 28.97,
    currency: "GBP",
  };
  it("builds a valid CreateOrdersRequest", () => {
    const body = clickDropOrderRequest(req, false);
    const item = body.items[0];
    expect(item.orderReference).toBe("PF-1042");
    expect(item.recipient.address).toMatchObject({ fullName: "Ada Lovelace", addressLine1: "12 Analytical St", city: "London", countryCode: "GB" });
    expect(item.packages[0]).toMatchObject({ weightInGrams: 180, packageFormatIdentifier: "largeLetter" });
    expect(item.label).toEqual({ includeLabelInResponse: false, includeCN: false, includeReturnsLabel: false });
    expect(item.postageDetails).toEqual({ sendNotificationsTo: "recipient" });
  });
  it("requests the label in the response for OBA accounts and validates input", () => {
    expect(clickDropOrderRequest(req, true).items[0].label.includeLabelInResponse).toBe(true);
    expect(() => clickDropOrderRequest({ ...req, recipient: { ...req.recipient, address: { city: "London" } } }, false)).toThrow(/address line 1/);
    expect(() => clickDropOrderRequest({ ...req, recipient: { ...req.recipient, address: { ...req.recipient.address, country: "Atlantis" } } }, false)).toThrow(/country/);
    expect(() => clickDropOrderRequest({ ...req, parcel: { weightGrams: 0, format: "largeLetter" } }, false)).toThrow(/weight/);
  });
});
