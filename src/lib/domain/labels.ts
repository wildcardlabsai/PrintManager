import type { BadgeTone } from "@/components/ui/badge";
import type {
  JobPriority,
  JobStatus,
  LabelStatus,
  OrderStatus,
  PackingStatus,
  PaymentStatus,
  PrinterStatus,
  ProductionStatus,
  SalesChannel,
  ShippingProvider,
  ShippingStatus,
  SpoolStatus,
} from "@/types/db";

type Meta = { label: string; tone: BadgeTone };

export const SALES_CHANNEL_LABELS: Record<SalesChannel, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  facebook_marketplace: "Facebook Marketplace",
  website: "Website",
  manual: "Manual",
  other: "Other",
};

export const SALES_CHANNEL_SHORT: Record<SalesChannel, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  facebook_marketplace: "Facebook",
  website: "Website",
  manual: "Manual",
  other: "Other",
};

export const ORDER_STATUS_META: Record<OrderStatus, Meta> = {
  new: { label: "New", tone: "blue" },
  confirmed: { label: "Confirmed", tone: "blue" },
  awaiting_print: { label: "Awaiting print", tone: "amber" },
  printing: { label: "Printing", tone: "violet" },
  printed: { label: "Printed", tone: "cyan" },
  packing: { label: "Packing", tone: "cyan" },
  ready_to_ship: { label: "Ready to ship", tone: "green" },
  shipped: { label: "Shipped", tone: "slate" },
  completed: { label: "Completed", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "red" },
  on_hold: { label: "On hold", tone: "amber" },
};

export const PAYMENT_STATUS_META: Record<PaymentStatus, Meta> = {
  pending: { label: "Payment pending", tone: "amber" },
  paid: { label: "Paid", tone: "green" },
  refunded: { label: "Refunded", tone: "red" },
  partially_refunded: { label: "Part refunded", tone: "amber" },
};

export const PRODUCTION_STATUS_META: Record<ProductionStatus, Meta> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "violet" },
  completed: { label: "Printed", tone: "green" },
  failed: { label: "Needs attention", tone: "red" },
};

export const PACKING_STATUS_META: Record<PackingStatus, Meta> = {
  not_packed: { label: "Not packed", tone: "neutral" },
  packing: { label: "Packing", tone: "cyan" },
  packed: { label: "Packed", tone: "green" },
};

export const SHIPPING_STATUS_META: Record<ShippingStatus, Meta> = {
  not_shipped: { label: "Not shipped", tone: "neutral" },
  ready: { label: "Ready", tone: "amber" },
  shipped: { label: "Shipped", tone: "green" },
  delivered: { label: "Delivered", tone: "green" },
};

export const JOB_STATUS_META: Record<JobStatus, Meta> = {
  queued: { label: "Awaiting print", tone: "amber" },
  sending: { label: "Sending", tone: "cyan" },
  sent: { label: "Queued on printer", tone: "cyan" },
  printing: { label: "Printing", tone: "violet" },
  paused: { label: "Paused", tone: "slate" },
  printed: { label: "Printed", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  cancelled: { label: "Cancelled", tone: "outline" },
};

export const PRIORITY_META: Record<JobPriority, Meta> = {
  low: { label: "Low", tone: "outline" },
  normal: { label: "Normal", tone: "neutral" },
  high: { label: "High", tone: "amber" },
  urgent: { label: "Urgent", tone: "red" },
};

export const PRINTER_STATUS_META: Record<PrinterStatus, Meta> = {
  online: { label: "Online", tone: "green" },
  offline: { label: "Offline", tone: "neutral" },
  idle: { label: "Idle", tone: "blue" },
  printing: { label: "Printing", tone: "violet" },
  paused: { label: "Paused", tone: "slate" },
  error: { label: "Error", tone: "red" },
  maintenance: { label: "Maintenance", tone: "amber" },
  unknown: { label: "Unknown", tone: "outline" },
};

export const SPOOL_STATUS_META: Record<SpoolStatus, Meta> = {
  sealed: { label: "Sealed", tone: "blue" },
  in_use: { label: "In use", tone: "green" },
  low: { label: "Low", tone: "amber" },
  empty: { label: "Empty", tone: "red" },
  archived: { label: "Archived", tone: "outline" },
};

export const SHIPPING_PROVIDER_LABELS: Record<ShippingProvider, string> = {
  royal_mail: "Royal Mail",
  evri: "Evri",
  dpd: "DPD",
  yodel: "Yodel",
  other: "Other",
};

export const LABEL_STATUS_META: Record<LabelStatus, Meta> = {
  not_created: { label: "No label", tone: "neutral" },
  manual: { label: "Manual postage", tone: "blue" },
  pending: { label: "Pending", tone: "amber" },
  created: { label: "Label created", tone: "green" },
  void: { label: "Void", tone: "red" },
};

export const MATERIALS = ["PLA", "PETG", "TPU", "ABS", "ASA"] as const;

export const PACKAGING_TYPES = [
  "Large letter",
  "Padded envelope",
  "Small parcel box",
  "Medium parcel box",
  "Bubble wrap + box",
  "Custom",
] as const;

export const SHIPPING_SERVICES: Record<ShippingProvider, string[]> = {
  royal_mail: ["Tracked 48", "Tracked 24", "2nd Class", "1st Class", "Special Delivery"],
  evri: ["Standard", "Next Day"],
  dpd: ["Next Day", "Two Day"],
  yodel: ["Xpress 48", "Xpress 24"],
  other: ["Collection", "Local delivery", "Other"],
};

export const CURRENCIES = ["GBP", "EUR", "USD", "CAD", "AUD"] as const;
