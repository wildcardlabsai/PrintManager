import type { Address, ShippingProvider } from "@/types/db";

export interface ParcelSpec {
  weightGrams: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  format?: "letter" | "large_letter" | "small_parcel" | "medium_parcel";
}

export interface LabelRequest {
  orderNumber: string;
  service: string;
  recipient: { name: string; email?: string | null; phone?: string | null; address: Address };
  parcel: ParcelSpec;
}

export interface LabelResult {
  externalShipmentId: string;
  trackingNumber: string | null;
  labelUrl: string;
  cost: number;
}

export interface ShippingIntegration {
  readonly id: string;
  readonly provider: ShippingProvider;
  listServices(): Promise<{ code: string; name: string }[]>;
  createLabel(request: LabelRequest): Promise<LabelResult>;
  voidLabel(externalShipmentId: string): Promise<void>;
  getTracking?(trackingNumber: string): Promise<{ status: string; events: { at: string; description: string }[] }>;
}
