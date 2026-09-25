import type { MemberRole } from "@/types/db";

/**
 * Who may do what with printers and production.
 *   Viewer   — monitor printers and production
 *   Operator — also send, start, pause, resume and stop prints and manage the queue
 *   Admin    — also configure, pair and remove printers and agents, and change settings
 * ("Operator" is the `staff` role in the database.)
 */
export type Permission =
  | "view"
  | "operate_printers"
  | "manage_production"
  | "configure_printers"
  | "manage_agents"
  | "manage_settings"
  | "manage_team";

const OPERATOR: Permission[] = ["view", "operate_printers", "manage_production"];
const ADMIN: Permission[] = [...OPERATOR, "configure_printers", "manage_agents", "manage_settings"];

export const ROLE_PERMISSIONS: Record<MemberRole, Permission[]> = {
  viewer: ["view"],
  staff: OPERATOR,
  admin: ADMIN,
  owner: [...ADMIN, "manage_team"],
};

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Operator",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: "Everything, including team roles.",
  admin: "Configure printers, agents, integrations and settings.",
  staff: "Run production: send, pause, resume and stop prints.",
  viewer: "Read-only: monitor printers and production.",
};

export function can(role: MemberRole | null | undefined, permission: Permission) {
  return Boolean(role && ROLE_PERMISSIONS[role]?.includes(permission));
}
