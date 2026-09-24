/**
 * Shared integration contracts.
 *
 * Phase 1 ships these boundaries only — no adapters are implemented and none
 * are pretended to be connected. Phase 2 (marketplaces, carriers) and Phase 3
 * (printers) add adapters that implement these interfaces. Adapters run
 * server-side only and read credentials from environment variables / a
 * server-side secret store, never from client code or the database rows the
 * browser can read.
 */

export type IntegrationKind = "marketplace" | "shipping" | "printer";

export type IntegrationAvailability =
  /** Adapter exists and credentials are configured. */
  | { state: "connected" }
  /** Adapter exists but credentials are missing. */
  | { state: "not_configured"; missing: string[] }
  /** Adapter is scheduled for a later phase. */
  | { state: "planned"; phase: 2 | 3 };

export interface IntegrationDescriptor {
  id: string;
  kind: IntegrationKind;
  name: string;
  phase: 2 | 3;
  /** Environment variables the adapter will need (names only). */
  env: string[];
  capabilities: string[];
  notes?: string;
}

/** Result of one sync run; persisted as sync history in Phase 2. */
export interface SyncResult {
  integrationId: string;
  startedAt: string;
  finishedAt: string;
  imported: number;
  skippedDuplicates: number;
  unmatched: number;
  errors: { reference?: string; message: string }[];
}

export class IntegrationNotAvailableError extends Error {
  constructor(public readonly integrationId: string, public readonly phase: 2 | 3) {
    super(`${integrationId} integration is not available until Phase ${phase}.`);
    this.name = "IntegrationNotAvailableError";
  }
}
