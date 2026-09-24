import type { Address, ShippingProvider } from "@/types/db";

export type PackageFormat = "letter" | "largeLetter" | "smallParcel" | "mediumParcel";

export interface ParcelSpec {
  weightGrams: number;
  format: PackageFormat;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
}

export interface LabelRequest {
  orderNumber: string;
  orderDate: string;
  serviceCode: string | null;
  recipient: { name: string; email?: string | null; phone?: string | null; address: Address };
  parcel: ParcelSpec;
  contents: { name: string; sku: string | null; quantity: number; unitValue: number; unitWeightGrams: number | null }[];
  subtotal: number;
  shippingCharged: number;
  total: number;
  currency: string;
}

export interface LabelResult {
  externalShipmentId: string;
  trackingNumber: string | null;
  /** PDF bytes when the provider returned a printable label. */
  labelPdf: Buffer | null;
  /** 'created' when a printable label came back; 'pending' when the provider must finish it (e.g. print in Click & Drop). */
  labelStatus: "created" | "pending";
  cost: number | null;
  message: string | null;
}

export interface TrackingResult {
  trackingNumber: string | null;
  shippedAt: string | null;
  status: string | null;
}

/** What a provider can do through its official API. The UI only offers supported actions. */
export interface ShippingCapabilities {
  rates: boolean;
  createLabel: boolean;
  retrieveLabel: boolean;
  cancelLabel: boolean;
  tracking: boolean;
}

export interface ShippingCredentials {
  apiKey: string;
  config: Record<string, unknown>;
}

export interface ShippingIntegration {
  readonly id: string;
  readonly provider: ShippingProvider;
  readonly name: string;
  readonly capabilities: ShippingCapabilities;
  /** Verifies the credentials with a harmless read call. */
  testConnection(creds: ShippingCredentials): Promise<{ accountLabel: string | null }>;
  createLabel(creds: ShippingCredentials, request: LabelRequest): Promise<LabelResult>;
  retrieveLabel?(creds: ShippingCredentials, externalShipmentId: string): Promise<Buffer>;
  getTracking?(creds: ShippingCredentials, externalShipmentId: string): Promise<TrackingResult>;
  cancelLabel?(creds: ShippingCredentials, externalShipmentId: string): Promise<void>;
}
