import type { PrinterTelemetry } from "../../agent/src/protocol";

/**
 * Row types for the PrintFlow database (see supabase/migrations).
 * Numeric columns arrive from PostgREST as numbers.
 */

export const MEMBER_ROLES = ["owner", "admin", "staff", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const SALES_CHANNELS = ["etsy", "ebay", "facebook_marketplace", "website", "manual", "other"] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

export const ORDER_STATUSES = [
  "new",
  "confirmed",
  "awaiting_print",
  "printing",
  "printed",
  "packing",
  "ready_to_ship",
  "shipped",
  "completed",
  "cancelled",
  "on_hold",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["pending", "paid", "refunded", "partially_refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type ProductionStatus = "not_started" | "in_progress" | "completed" | "failed";
export type PackingStatus = "not_packed" | "packing" | "packed";
export type ShippingStatus = "not_shipped" | "ready" | "shipped" | "delivered";

export const JOB_STATUSES = ["queued", "sending", "sent", "printing", "paused", "printed", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const PRINTER_STATUSES = ["online", "offline", "idle", "printing", "paused", "error", "maintenance", "unknown"] as const;
/** Statuses a person may set by hand on a manually tracked printer. */
export const MANUAL_PRINTER_STATUSES = ["online", "offline", "idle", "printing", "error", "maintenance"] as const;
export type PrinterStatus = (typeof PRINTER_STATUSES)[number];

export const SPOOL_STATUSES = ["sealed", "in_use", "low", "empty", "archived"] as const;
export type SpoolStatus = (typeof SPOOL_STATUSES)[number];

export const SHIPPING_PROVIDERS = ["royal_mail", "evri", "dpd", "yodel", "other"] as const;
export type ShippingProvider = (typeof SHIPPING_PROVIDERS)[number];

export type LabelStatus = "not_created" | "manual" | "pending" | "created" | "void";

export interface Address {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  postcode?: string | null;
  country?: string | null;
}

export interface Settings {
  organization_id: string;
  business_name: string;
  currency: string;
  timezone: string;
  electricity_cost_per_hour: number;
  default_filament_cost_per_kg: number;
  default_packaging_cost: number;
  default_shipping_provider: ShippingProvider;
  default_printer_id: string | null;
  order_number_prefix: string;
  order_number_format: string;
  order_number_padding: number;
  next_order_number: number;
  low_filament_threshold_g: number;
  notifications: Record<string, boolean>;
  auto_print_enabled: boolean;
  printer_offline_after_seconds: number;
  printer_command_timeout_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  active_organization_id: string | null;
}

export interface Customer {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
  notes: string | null;
  is_demo: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Printer {
  id: string;
  organization_id: string;
  name: string;
  manufacturer: string;
  model: string;
  status: PrinterStatus;
  status_source: "manual" | "integration";
  status_updated_at: string;
  ip_address: string | null;
  location: string | null;
  capabilities: string[];
  build_volume: string | null;
  notes: string | null;
  integration_provider: string | null;
  integration_device_id: string | null;
  serial_number: string | null;
  connection_mode: PrinterConnectionMode;
  agent_id: string | null;
  lan_port: number | null;
  firmware_version: string | null;
  connection_state: PrinterConnectionState;
  consecutive_failures: number;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  latency_ms: number | null;
  last_error: string | null;
  last_error_at: string | null;
  telemetry: PrinterTelemetry | null;
  telemetry_at: string | null;
  telemetry_source: "flashforge_lan" | "mock" | null;
  raw_status: string | null;
  current_external_job_id: string | null;
  current_job_id: string | null;
  multi_colour: boolean;
  colour_channels: number;
  camera: "unknown" | "none" | "built_in" | "optional";
  live_checklist: LiveChecklist;
  live_verified_at: string | null;
  live_verified_by: string | null;
  bed_clear: boolean;
  bed_clear_confirmed_at: string | null;
  is_demo: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PrinterConnectionMode = "manual" | "agent_lan";
export type PrinterConnectionState = "not_configured" | "waiting" | "connected" | "unreachable" | "auth_failed" | "error" | "offline";

export interface LiveChecklistEntry {
  at: string;
  by: string | null;
  source: "flashforge_lan" | "mock" | "user";
  note?: string | null;
}
export type LiveChecklist = Partial<Record<string, LiveChecklistEntry>>;

export interface PrinterAgent {
  id: string;
  organization_id: string;
  name: string;
  status: "pending" | "active" | "revoked";
  pairing_expires_at: string | null;
  token_issued_at: string | null;
  version: string | null;
  platform: string | null;
  driver: "flashforge_lan" | "mock" | null;
  library_version: string | null;
  last_seen_at: string | null;
  last_ip: string | null;
  created_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
  updated_at: string;
}

export const PRINTER_COMMAND_TYPES = ["start_print", "pause", "resume", "stop", "refresh", "test_connection", "clear_platform"] as const;
export type PrinterCommandType = (typeof PRINTER_COMMAND_TYPES)[number];
export type PrinterCommandStatus = "pending" | "sent" | "succeeded" | "failed" | "expired" | "cancelled";

export interface PrinterCommand {
  id: string;
  organization_id: string;
  printer_id: string;
  agent_id: string;
  production_job_id: string | null;
  print_file_id: string | null;
  type: PrinterCommandType;
  payload: Record<string, unknown>;
  status: PrinterCommandStatus;
  requested_by: string | null;
  automatic: boolean;
  expires_at: string;
  sent_at: string | null;
  completed_at: string | null;
  result: Record<string, unknown> | null;
  error_code: string | null;
  error: string | null;
  created_at: string;
}

export const PRINTER_EVENT_TYPES = [
  "connected",
  "disconnected",
  "print_started",
  "print_paused",
  "print_resumed",
  "print_stopped",
  "print_completed",
  "print_failed",
  "error",
  "status_changed",
  "command_failed",
  "firmware_changed",
] as const;
export type PrinterEventType = (typeof PRINTER_EVENT_TYPES)[number];

export interface PrinterEvent {
  id: string;
  organization_id: string;
  printer_id: string;
  production_job_id: string | null;
  type: PrinterEventType;
  from_status: string | null;
  to_status: string | null;
  message: string | null;
  data: Record<string, unknown>;
  source: "telemetry" | "command" | "agent" | "user" | "system";
  created_at: string;
}

export type AttentionCode =
  | "printer_offline"
  | "printer_error"
  | "stopped_at_printer"
  | "not_started"
  | "missed_completion"
  | "other_job"
  | "dispatch_failed"
  | "print_failed";

export interface FilamentAssignment {
  /** 1-based colour channel in the sliced file */
  channel: number;
  material: string | null;
  colour: string | null;
  grams?: number | null;
}

export type PrintFileType = "gcode" | "gx" | "3mf";

export interface PrintFile {
  id: string;
  organization_id: string;
  product_id: string | null;
  variant_id: string | null;
  name: string;
  file_name: string;
  file_type: PrintFileType;
  storage_path: string;
  size_bytes: number;
  sha256: string;
  compatible_models: string[];
  slicer: string | null;
  slicer_version: string | null;
  printer_profile: string | null;
  material: string | null;
  colour: string | null;
  nozzle_diameter: number | null;
  multi_colour: boolean;
  colour_channels: number;
  ifs_required: boolean;
  filament_assignments: FilamentAssignment[];
  estimated_minutes: number | null;
  estimated_grams: number | null;
  metadata: Record<string, unknown>;
  is_default: boolean;
  verified_at: string | null;
  verified_by: string | null;
  notes: string | null;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppNotification {
  id: string;
  organization_id: string;
  user_id: string | null;
  type: string;
  severity: "info" | "warning" | "error" | "success";
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
}

export interface Product {
  id: string;
  organization_id: string;
  sku: string;
  name: string;
  description: string | null;
  selling_price: number;
  filament_grams: number;
  print_minutes: number;
  filament_cost_per_kg: number | null;
  packaging_cost: number | null;
  other_cost: number;
  cost_price: number;
  material: string;
  default_colour: string | null;
  packaging_type: string | null;
  default_printer_id: string | null;
  notes: string | null;
  is_active: boolean;
  is_demo: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: string;
  organization_id: string;
  product_id: string;
  sku: string;
  name: string;
  colour: string | null;
  material: string | null;
  selling_price: number | null;
  filament_grams: number | null;
  print_minutes: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductImage {
  id: string;
  organization_id: string;
  product_id: string;
  url: string;
  storage_path: string | null;
  alt: string | null;
  position: number;
  created_at: string;
}

export interface Filament {
  id: string;
  organization_id: string;
  brand: string;
  material: string;
  colour: string;
  colour_hex: string | null;
  weight_purchased_g: number;
  remaining_g: number;
  cost: number;
  cost_per_gram: number;
  status: SpoolStatus;
  purchased_on: string | null;
  notes: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface FilamentUsage {
  id: string;
  organization_id: string;
  filament_id: string;
  production_job_id: string | null;
  grams: number;
  cost: number;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface Order {
  id: string;
  organization_id: string;
  order_number: string;
  sales_channel: SalesChannel;
  external_order_id: string | null;
  order_date: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  billing_address: Address | null;
  shipping_address: Address | null;
  subtotal: number;
  shipping_charged: number;
  discount: number;
  total: number;
  product_cost: number;
  fees: number;
  estimated_profit: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  production_status: ProductionStatus;
  packing_status: PackingStatus;
  shipping_status: ShippingStatus;
  customer_notes: string | null;
  internal_notes: string | null;
  shipped_at: string | null;
  completed_at: string | null;
  is_demo: boolean;
  created_by: string | null;
  integration_connection_id: string | null;
  external_status: string | null;
  last_external_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  organization_id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  sku: string | null;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  line_total: number;
  line_cost: number;
  external_line_id: string | null;
  external_listing_id: string | null;
  created_at: string;
}

export interface ProductionJob {
  id: string;
  job_number: number;
  organization_id: string;
  order_id: string | null;
  order_item_id: string | null;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  quantity: number;
  printer_id: string | null;
  status: JobStatus;
  priority: JobPriority;
  queue_position: number;
  material: string | null;
  colour: string | null;
  estimated_minutes: number;
  actual_minutes: number | null;
  estimated_grams: number;
  actual_grams: number | null;
  filament_id: string | null;
  accumulated_minutes: number;
  last_resumed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  attempts: number;
  notes: string | null;
  external_job_ref: string | null;
  print_file_id: string | null;
  external_printer_job_id: string | null;
  printer_file_name: string | null;
  printer_status: string | null;
  progress: number | null;
  remaining_seconds: number | null;
  printer_elapsed_seconds: number | null;
  current_layer: number | null;
  total_layers: number | null;
  last_telemetry_at: string | null;
  sent_at: string | null;
  multi_colour: boolean;
  colour_channels: number;
  ifs_required: boolean;
  filament_assignments: FilamentAssignment[];
  needs_attention: boolean;
  attention_code: AttentionCode | null;
  attention_reason: string | null;
  auto_dispatched: boolean;
  filament_recorded: boolean;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Shipment {
  id: string;
  organization_id: string;
  order_id: string;
  provider: ShippingProvider;
  service: string | null;
  shipping_cost: number;
  tracking_number: string | null;
  label_status: LabelStatus;
  shipped_at: string | null;
  delivered_at: string | null;
  notes: string | null;
  external_shipment_id: string | null;
  label_url: string | null;
  package_weight_g: number | null;
  package_length_mm: number | null;
  package_width_mm: number | null;
  package_height_mm: number | null;
  package_format: string | null;
  label_provider: string | null;
  label_storage_path: string | null;
  label_created_at: string | null;
  label_error: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface StatusHistoryEntry {
  id: string;
  organization_id: string;
  entity_type: "order" | "production_job" | "printer";
  entity_id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  changed_by: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  organization_id: string;
  actor_id: string | null;
  event: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
