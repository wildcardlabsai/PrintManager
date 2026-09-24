import { isoFromCountry } from "@/lib/domain/countries";
import { royalMailConfig } from "../config";
import { IntegrationError } from "../errors";
import { requestJson } from "../http";
import type { LabelRequest, LabelResult, ShippingCredentials, ShippingIntegration, TrackingResult } from "./types";

/**
 * Royal Mail Click & Drop API v1 (https://api.parcel.royalmail.com/api/v1).
 * Contract: Royal Mail's published swagger "ChannelShipper & Royal Mail Public API".
 *
 * What the API supports for a standard Click & Drop account:
 *   - POST /orders             create orders (postage is then bought/printed in Click & Drop)
 *   - GET  /orders/{ids}       order info incl. trackingNumber once a label exists
 * Only for Online Business Account (OBA) customers:
 *   - label PDF in the create response / GET /orders/{ids}/label
 * Not available: rate quotes; deleting orders (ChannelShipper only).
 * Rate limit: 1 call per second for Click & Drop customers.
 */

interface CreatedOrder {
  orderIdentifier?: number;
  orderReference?: string;
  trackingNumber?: string;
  label?: string;
  labelErrors?: { message?: string }[];
}
interface CreateOrdersResponse {
  successCount?: number;
  errorsCount?: number;
  createdOrders?: CreatedOrder[];
  failedOrders?: { errors?: { errorCode?: number; errorMessage?: string; fields?: { fieldName?: string; value?: string }[] }[] }[];
}

const isOba = (creds: ShippingCredentials) => creds.config?.oba === true;

function headers(creds: ShippingCredentials) {
  return { Authorization: `Bearer ${creds.apiKey}`, Accept: "application/json", "Content-Type": "application/json" };
}

const trim = (v: string | null | undefined, max: number) => (v ? v.trim().slice(0, max) : undefined);

export function clickDropOrderRequest(req: LabelRequest, oba: boolean) {
  const a = req.recipient.address;
  const countryCode = isoFromCountry(a.country ?? "United Kingdom");
  if (!a.line1 || !a.city) throw new IntegrationError("validation", "The shipping address needs at least address line 1 and a town/city.");
  if (!countryCode) throw new IntegrationError("validation", `Unrecognised country "${a.country}". Use a 2-letter country code such as GB.`);
  if (!req.parcel.weightGrams || req.parcel.weightGrams <= 0) throw new IntegrationError("validation", "Enter the package weight.");
  const dims =
    req.parcel.lengthMm && req.parcel.widthMm && req.parcel.heightMm
      ? { depthInMms: req.parcel.lengthMm, widthInMms: req.parcel.widthMm, heightInMms: req.parcel.heightMm }
      : undefined;
  return {
    items: [
      {
        orderReference: req.orderNumber.slice(0, 40),
        recipient: {
          address: {
            fullName: trim(req.recipient.name, 210),
            addressLine1: trim(a.line1, 100),
            addressLine2: trim(a.line2, 100),
            city: trim(a.city, 100),
            county: trim(a.region, 100),
            postcode: trim(a.postcode, 20),
            countryCode,
          },
          emailAddress: trim(req.recipient.email, 254),
          phoneNumber: trim(req.recipient.phone, 25),
        },
        orderDate: new Date(req.orderDate).toISOString(),
        subtotal: req.subtotal,
        shippingCostCharged: req.shippingCharged,
        total: req.total,
        currencyCode: req.currency.slice(0, 3),
        packages: [
          {
            weightInGrams: Math.round(req.parcel.weightGrams),
            packageFormatIdentifier: req.parcel.format,
            ...(dims ? { dimensions: dims } : {}),
            contents: req.contents.map((c) => ({
              name: c.name.slice(0, 800),
              SKU: c.sku ? c.sku.slice(0, 100) : undefined,
              quantity: c.quantity,
              unitValue: c.unitValue,
              unitWeightInGrams: c.unitWeightGrams ?? undefined,
            })),
          },
        ],
        postageDetails: {
          ...(req.serviceCode ? { serviceCode: req.serviceCode.slice(0, 10) } : {}),
          sendNotificationsTo: "recipient",
        },
        label: { includeLabelInResponse: oba, includeCN: false, includeReturnsLabel: false },
      },
    ],
  };
}

export const royalMailClickDrop: ShippingIntegration = {
  id: "royal_mail_click_drop",
  provider: "royal_mail",
  name: "Royal Mail Click & Drop",
  capabilities: { rates: false, createLabel: true, retrieveLabel: true, cancelLabel: false, tracking: true },

  async testConnection(creds) {
    // Harmless authenticated read; a bad key returns 401.
    await requestJson(`${royalMailConfig().apiBase}/orders?pageSize=1`, {
      provider: "Royal Mail",
      headers: headers(creds),
      retries: 1,
    });
    return { accountLabel: isOba(creds) ? "Click & Drop (OBA)" : "Click & Drop" };
  },

  async createLabel(creds, request): Promise<LabelResult> {
    const body = clickDropOrderRequest(request, isOba(creds));
    const { data } = await requestJson<CreateOrdersResponse>(`${royalMailConfig().apiBase}/orders`, {
      provider: "Royal Mail",
      method: "POST",
      headers: headers(creds),
      body: JSON.stringify(body),
      // Never auto-retry order creation: a retry after a lost response could create a duplicate order.
      retries: 0,
    });
    const created = data?.createdOrders?.[0];
    if (!created?.orderIdentifier) {
      const errors = data?.failedOrders?.[0]?.errors ?? [];
      const msg = errors.map((e) => [e.errorMessage, ...(e.fields ?? []).map((f) => f.fieldName)].filter(Boolean).join(" ")).join("; ");
      throw new IntegrationError("api_error", msg || "Click & Drop did not create the order.", { provider: "Royal Mail", body: data });
    }
    const labelPdf = created.label ? Buffer.from(created.label, "base64") : null;
    const labelError = created.labelErrors?.map((e) => e.message).filter(Boolean).join("; ") || null;
    return {
      externalShipmentId: String(created.orderIdentifier),
      trackingNumber: created.trackingNumber ?? null,
      labelPdf,
      labelStatus: labelPdf ? "created" : "pending",
      cost: null,
      message: labelPdf
        ? null
        : labelError ??
          "Order created in Click & Drop. Buy and print the postage there; PrintFlow will pick up the tracking number when you refresh tracking.",
    };
  },

  async retrieveLabel(creds, externalShipmentId) {
    if (!isOba(creds)) throw new IntegrationError("not_supported", "Label download through the API is only available to Royal Mail OBA accounts.");
    const { response } = await requestJson(
      `${royalMailConfig().apiBase}/orders/${encodeURIComponent(externalShipmentId)}/label?documentType=postageLabel&includeReturnsLabel=false`,
      { provider: "Royal Mail", headers: { Authorization: `Bearer ${creds.apiKey}`, Accept: "application/pdf" }, raw: true },
    );
    return Buffer.from(await response.arrayBuffer());
  },

  async getTracking(creds, externalShipmentId): Promise<TrackingResult> {
    const { data } = await requestJson<{ trackingNumber?: string; shippedOn?: string; printedOn?: string }[]>(
      `${royalMailConfig().apiBase}/orders/${encodeURIComponent(externalShipmentId)}`,
      { provider: "Royal Mail", headers: headers(creds) },
    );
    const o = Array.isArray(data) ? data[0] : undefined;
    if (!o) throw new IntegrationError("invalid_response", "Click & Drop did not return the order.", { provider: "Royal Mail" });
    return {
      trackingNumber: o.trackingNumber ?? null,
      shippedAt: o.shippedOn ?? null,
      status: o.shippedOn ? "shipped" : o.printedOn ? "label printed" : "awaiting postage",
    };
  },
};
