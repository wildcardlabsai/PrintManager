import type { IntegrationProvider } from "@/lib/integrations/registry";

export type ConnectionStatus = "connected" | "disconnected" | "auth_required" | "error" | "restricted";

export interface IntegrationConnection {
  id: string;
  organization_id: string;
  provider: IntegrationProvider;
  kind: "marketplace" | "shipping";
  environment: "production" | "sandbox";
  status: ConnectionStatus;
  external_account_id: string | null;
  external_account_name: string | null;
  scopes: string[];
  config: Record<string, unknown>;
  connected_by: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncLog {
  id: string;
  organization_id: string;
  connection_id: string | null;
  provider: string;
  operation: string;
  trigger: "manual" | "webhook" | "schedule" | "system";
  status: "running" | "success" | "partial" | "failed";
  started_at: string;
  completed_at: string | null;
  records_processed: number;
  records_created: number;
  records_updated: number;
  records_skipped: number;
  error_count: number;
  error_message: string | null;
  metadata: Record<string, unknown>;
  initiated_by: string | null;
}

export interface ExternalOrderRow {
  id: string;
  organization_id: string;
  connection_id: string | null;
  sales_channel: "etsy" | "ebay";
  external_order_id: string;
  order_id: string | null;
  import_status: "imported" | "mapping_required" | "awaiting_payment" | "skipped" | "cancelled" | "error";
  import_note: string | null;
  external_status: string | null;
  currency: string | null;
  buyer_name: string | null;
  buyer_ref: string | null;
  ordered_at: string | null;
  external_updated_at: string | null;
  normalized: import("@/lib/integrations/marketplace/types").NormalizedOrder;
  unmatched_lines: { externalLineId: string; title: string; sku: string | null; externalListingId: string | null; externalProductId: string | null; variation: string | null; reason: string }[];
  first_seen_at: string;
  last_synced_at: string;
}

export interface MarketplaceFulfillment {
  id: string;
  order_id: string;
  connection_id: string | null;
  sales_channel: "etsy" | "ebay";
  status: "pending" | "synced" | "failed";
  tracking_number: string | null;
  carrier: string | null;
  external_fulfillment_id: string | null;
  attempts: number;
  last_attempt_at: string | null;
  synced_at: string | null;
  response: Record<string, unknown> | null;
  error: string | null;
}
