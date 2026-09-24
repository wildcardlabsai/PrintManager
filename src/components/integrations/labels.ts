import type { BadgeTone } from "@/components/ui/badge";
import type { ConnectionStatus } from "@/lib/services/integrations/types";

export const CONNECTION_STATUS_META: Record<ConnectionStatus | "not_connected", { label: string; tone: BadgeTone }> = {
  connected: { label: "Connected", tone: "green" },
  disconnected: { label: "Disconnected", tone: "neutral" },
  not_connected: { label: "Not connected", tone: "neutral" },
  auth_required: { label: "Authentication required", tone: "amber" },
  error: { label: "Error", tone: "red" },
  restricted: { label: "Restricted", tone: "slate" },
};

export const IMPORT_STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  imported: { label: "Imported", tone: "green" },
  mapping_required: { label: "Mapping required", tone: "amber" },
  awaiting_payment: { label: "Awaiting payment", tone: "neutral" },
  skipped: { label: "Skipped", tone: "outline" },
  cancelled: { label: "Cancelled", tone: "outline" },
  error: { label: "Error", tone: "red" },
};

export const SYNC_STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  running: { label: "Running", tone: "blue" },
  success: { label: "Success", tone: "green" },
  partial: { label: "Partial", tone: "amber" },
  failed: { label: "Failed", tone: "red" },
};

export const FULFILLMENT_STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: "Sending…", tone: "blue" },
  synced: { label: "Synced", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  not_sent: { label: "Not sent", tone: "neutral" },
};

export const OPERATION_LABELS: Record<string, string> = {
  order_sync: "Order sync",
  webhook: "Webhook",
  fulfillment: "Tracking update",
  label: "Shipping label",
  tracking: "Tracking refresh",
  connect: "Connect",
  disconnect: "Disconnect",
  token_refresh: "Token refresh",
};
