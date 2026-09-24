import { IntegrationError } from "./errors";

export interface RequestOptions extends Omit<RequestInit, "signal"> {
  provider: string;
  timeoutMs?: number;
  retries?: number;
  /** Base delay for exponential backoff. */
  backoffMs?: number;
  /** Parse the body as JSON (default) or return the raw Response. */
  raw?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000);
  const date = Date.parse(h);
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 60_000)) : undefined;
}

function summarise(body: unknown): string {
  if (!body) return "";
  if (typeof body === "string") return body.slice(0, 300);
  const b = body as Record<string, unknown>;
  // Etsy: { error }, OAuth: { error, error_description }, eBay: { errors: [{ message, longMessage }] }
  if (typeof b.error_description === "string") return b.error_description;
  if (typeof b.error === "string") return b.error;
  if (Array.isArray(b.errors) && b.errors.length) {
    const e = b.errors[0] as Record<string, unknown>;
    return String(e.longMessage ?? e.message ?? e.errorMessage ?? JSON.stringify(e)).slice(0, 300);
  }
  if (typeof b.message === "string") return b.message;
  return JSON.stringify(b).slice(0, 300);
}

/**
 * fetch() with a timeout, typed errors and exponential backoff for rate limits
 * (429, honouring Retry-After) and transient 5xx/network failures. 4xx client
 * errors are never retried.
 */
export async function requestJson<T = unknown>(url: string, opts: RequestOptions): Promise<{ data: T; response: Response }> {
  const { provider, timeoutMs = 20_000, retries = 3, backoffMs = 500, raw, fetchImpl = fetch, sleep = defaultSleep, ...init } = opts;
  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e instanceof Error && e.name === "AbortError";
      const err = new IntegrationError(aborted ? "timeout" : "network", aborted ? "Request timed out" : "Network error", { provider });
      if (attempt < retries) {
        await sleep(backoffMs * 2 ** attempt);
        attempt++;
        continue;
      }
      throw err;
    }
    clearTimeout(timer);

    if (res.ok) {
      if (raw) return { data: undefined as T, response: res };
      if (res.status === 204) return { data: undefined as T, response: res };
      const text = await res.text();
      if (!text) return { data: undefined as T, response: res };
      try {
        return { data: JSON.parse(text) as T, response: res };
      } catch {
        throw new IntegrationError("invalid_response", "Response was not valid JSON", { provider, status: res.status });
      }
    }

    let body: unknown = undefined;
    try {
      const text = await res.text();
      body = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-JSON error body */
    }
    const message = summarise(body) || `HTTP ${res.status}`;

    if (res.status === 429 || res.status >= 500) {
      const wait = res.status === 429 ? retryAfterMs(res) ?? backoffMs * 2 ** attempt : backoffMs * 2 ** attempt;
      if (attempt < retries) {
        await sleep(wait);
        attempt++;
        continue;
      }
      throw new IntegrationError(res.status === 429 ? "rate_limited" : "api_error", message, { provider, status: res.status, body, retryAfterMs: wait });
    }
    if (res.status === 401) throw new IntegrationError("auth_required", message, { provider, status: 401, body });
    if (res.status === 403) throw new IntegrationError("forbidden", message, { provider, status: 403, body });
    throw new IntegrationError("api_error", message, { provider, status: res.status, body });
  }
}
