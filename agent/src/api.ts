import type {
  CommandResultRequest,
  FileTicket,
  HeartbeatRequest,
  HeartbeatResponse,
  PairRequest,
  PairResponse,
} from "./protocol.js";

export class ServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 20000;

async function request<T>(url: string, init: RequestInit & { token?: string }): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new ServerError(msg, res.status);
  }
  return body as T;
}

/** The agent's only channel to PrintFlow: HTTPS requests it initiates. */
export class PrintFlowApi {
  constructor(
    readonly serverUrl: string,
    private token: string,
  ) {
    const u = new URL(serverUrl);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !local) throw new Error("The PrintFlow server URL must use https://");
  }

  setToken(token: string) {
    this.token = token;
  }

  private url(p: string) {
    return new URL(p, this.serverUrl).toString();
  }

  static pair(serverUrl: string, body: PairRequest) {
    return request<PairResponse>(new URL("/api/agent/pair", serverUrl).toString(), { method: "POST", body: JSON.stringify(body) });
  }

  heartbeat(body: HeartbeatRequest) {
    return request<HeartbeatResponse>(this.url("/api/agent/heartbeat"), { method: "POST", body: JSON.stringify(body), token: this.token });
  }

  fileTicket(commandId: string) {
    return request<FileTicket>(this.url(`/api/agent/commands/${commandId}/file`), { method: "GET", token: this.token });
  }

  reportResult(commandId: string, body: CommandResultRequest) {
    return request<{ ok: true }>(this.url(`/api/agent/commands/${commandId}/result`), {
      method: "POST",
      body: JSON.stringify(body),
      token: this.token,
    });
  }
}
