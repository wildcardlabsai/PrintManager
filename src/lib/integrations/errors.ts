/** Typed integration failures, so callers can react (reconnect, retry, map…). */
export type IntegrationErrorKind =
  | "not_configured"
  | "auth_required"
  | "forbidden"
  | "rate_limited"
  | "timeout"
  | "network"
  | "invalid_response"
  | "api_error"
  | "not_supported"
  | "validation";

export class IntegrationError extends Error {
  constructor(
    public readonly kind: IntegrationErrorKind,
    message: string,
    public readonly details: { status?: number; provider?: string; body?: unknown; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "IntegrationError";
  }

  get retryable() {
    return this.kind === "rate_limited" || this.kind === "timeout" || this.kind === "network" || (this.details.status ?? 0) >= 500;
  }
}

/** A message that is safe to show a user (no tokens, no raw payloads). */
export function describeIntegrationError(error: unknown, provider: string): string {
  if (error instanceof IntegrationError) {
    switch (error.kind) {
      case "not_configured":
        return error.message;
      case "auth_required":
        return `${provider} needs to be reconnected: ${error.message}`;
      case "forbidden":
        return `${provider} refused the request (missing permission or scope): ${error.message}`;
      case "rate_limited":
        return `${provider} rate limit reached. Try again shortly.`;
      case "timeout":
        return `${provider} did not respond in time.`;
      case "network":
        return `Could not reach ${provider}.`;
      case "invalid_response":
        return `${provider} returned an unexpected response.`;
      default:
        return `${provider}: ${error.message}`;
    }
  }
  return error instanceof Error ? error.message : `Unknown ${provider} error`;
}
