import "server-only";
import type { AppContext } from "./context";

export type AuditEvent =
  | "order.created"
  | "order.updated"
  | "order.status_changed"
  | "production_job.created"
  | "production_job.started"
  | "production_job.paused"
  | "production_job.resumed"
  | "production_job.completed"
  | "production_job.failed"
  | "production_job.cancelled"
  | "production_job.requeued"
  | "production_job.updated"
  | "customer.created"
  | "customer.updated"
  | "customer.archived"
  | "product.created"
  | "product.updated"
  | "product.archived"
  | "product.restored"
  | "printer.created"
  | "printer.updated"
  | "printer.status_changed"
  | "filament.created"
  | "filament.updated"
  | "filament.usage_recorded"
  | "filament.deleted"
  | "shipment.updated"
  | "settings.updated"
  | "demo_data.loaded"
  | "demo_data.cleared"
  | "printer.connection_configured"
  | "printer.checklist_updated"
  | "printer.verified"
  | "printer.bed_cleared"
  | "printer.command_requested"
  | "printer.command_completed"
  | "printer.command_failed"
  | "printer.connected"
  | "printer.disconnected"
  | "printer_agent.created"
  | "printer_agent.paired"
  | "printer_agent.pairing_code_regenerated"
  | "printer_agent.revoked"
  | "printer_agent.token_rotated"
  | "print_file.created"
  | "print_file.updated"
  | "print_file.archived"
  | "print_file.verified"
  | "production_job.sent_to_printer"
  | "production_job.dispatch_failed"
  | "production_job.attention_resolved"
  | "production_job.reviewed"
  | "team.role_changed";

/**
 * Append an audit log entry. Audit failures are logged but never block the
 * user's action.
 */
export async function logAudit(
  ctx: AppContext,
  event: AuditEvent,
  entity: { type: string; id: string | null },
  summary: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await ctx.supabase.from("audit_logs").insert({
    organization_id: ctx.orgId,
    actor_id: ctx.userId,
    event,
    entity_type: entity.type,
    entity_id: entity.id,
    summary,
    metadata,
  });
  if (error) console.error("[audit] failed to record", event, error);
}

export async function recordStatusChange(
  ctx: AppContext,
  entityType: "order" | "production_job" | "printer",
  entityId: string,
  from: string | null,
  to: string,
  note?: string | null,
) {
  const { error } = await ctx.supabase.from("status_history").insert({
    organization_id: ctx.orgId,
    entity_type: entityType,
    entity_id: entityId,
    from_status: from,
    to_status: to,
    note: note ?? null,
    changed_by: ctx.userId,
  });
  if (error) console.error("[status_history] failed to record", entityType, entityId, error);
}
