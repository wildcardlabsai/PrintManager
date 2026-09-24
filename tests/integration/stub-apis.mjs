/**
 * TEST-ONLY stub of the Etsy, eBay and Royal Mail Click & Drop endpoints that
 * PrintFlow's adapters call. It exists so the full integration flow (OAuth with
 * PKCE, token refresh, order import, webhooks, fulfilment, labels) can be
 * exercised end-to-end without live credentials. It is never used by the app
 * unless PRINTFLOW_TEST_API_OVERRIDES=1 and the *_TEST_* base URLs are set.
 *
 * Response shapes follow the providers' published OpenAPI contracts.
 */
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";

const PORT = Number(process.env.STUB_PORT ?? 4010);
const ETSY_KEY = process.env.ETSY_CLIENT_ID ?? "test-etsy-keystring";
const ETSY_SECRET = process.env.ETSY_CLIENT_SECRET ?? "test-etsy-shared-secret";
const EBAY_ID = process.env.EBAY_CLIENT_ID ?? "test-ebay-client";
const EBAY_SECRET = process.env.EBAY_CLIENT_SECRET ?? "test-ebay-secret";
const EBAY_ACCEPT_URL = process.env.EBAY_ACCEPT_URL ?? "http://localhost:3000/api/integrations/ebay/callback";
const RM_KEY = process.env.RM_TEST_KEY ?? "rm-test-api-key-0001";

const state = {
  etsy: { codes: new Map(), tokens: new Map(), refresh: new Map(), receipts: new Map(), trackingCalls: [], refreshCount: 0, shopId: 42 },
  ebay: { codes: new Map(), tokens: new Map(), refresh: new Set(), orders: new Map(), fulfillments: [], failNextFulfillment: 0 },
  rm: { orders: new Map(), nextId: 5001 },
};

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const nowS = () => Math.floor(Date.now() / 1000);

function etsyAuth(req, res) {
  if (req.headers["x-api-key"] !== `${ETSY_KEY}:${ETSY_SECRET}`) return json(res, 403, { error: "Invalid x-api-key" }), false;
  const tok = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const t = state.etsy.tokens.get(tok);
  if (!t || t.exp < Date.now()) return json(res, 401, { error: "invalid_token" }), false;
  return true;
}
function ebayAuth(req, res) {
  const tok = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const t = state.ebay.tokens.get(tok);
  if (!t || t.exp < Date.now()) return json(res, 401, { errors: [{ message: "Invalid access token" }] }), false;
  return true;
}
function issueEtsy() {
  const access = `${state.etsy.shopId}.${randomUUID()}`;
  const refresh = `${state.etsy.shopId}.r-${randomUUID()}`;
  state.etsy.tokens.set(access, { exp: Date.now() + 3600_000 });
  state.etsy.refresh.set(refresh, true);
  return { access_token: access, token_type: "Bearer", expires_in: 3600, refresh_token: refresh };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  const body = await readBody(req);

  // ---------------------------------------------------------------- control
  if (p === "/__control/state") {
    return json(res, 200, {
      etsy: { refreshCount: state.etsy.refreshCount, trackingCalls: state.etsy.trackingCalls, receipts: [...state.etsy.receipts.values()] },
      ebay: { fulfillments: state.ebay.fulfillments },
      rm: { orders: [...state.rm.orders.values()] },
    });
  }
  if (p === "/__control/etsy/receipt" && req.method === "POST") {
    const r = JSON.parse(body);
    r.updated_timestamp = nowS();
    state.etsy.receipts.set(r.receipt_id, { ...(state.etsy.receipts.get(r.receipt_id) ?? {}), ...r });
    return json(res, 200, { ok: true });
  }
  if (p === "/__control/etsy/expire-tokens") {
    for (const t of state.etsy.tokens.values()) t.exp = 0;
    return json(res, 200, { ok: true });
  }
  if (p === "/__control/ebay/order" && req.method === "POST") {
    const o = JSON.parse(body);
    o.lastModifiedDate = new Date().toISOString();
    state.ebay.orders.set(o.orderId, o);
    return json(res, 200, { ok: true });
  }
  if (p === "/__control/ebay/fail-next-fulfillment") {
    state.ebay.failNextFulfillment = Number(url.searchParams.get("n") ?? 1);
    return json(res, 200, { ok: true });
  }
  if (p === "/__control/rm/ship") {
    for (const o of state.rm.orders.values()) {
      o.trackingNumber = `RM${String(o.orderIdentifier).padStart(9, "0")}GB`;
      o.shippedOn = new Date().toISOString();
    }
    return json(res, 200, { ok: true });
  }

  // ---------------------------------------------------------------- Etsy
  if (p === "/etsy-www/oauth/connect") {
    const q = url.searchParams;
    if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge") || !q.get("state")) return json(res, 400, { error: "invalid_request" });
    const code = randomUUID();
    state.etsy.codes.set(code, { challenge: q.get("code_challenge"), redirect: q.get("redirect_uri") });
    const back = new URL(q.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.get("state"));
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (p === "/etsy-api/v3/public/oauth/token" && req.method === "POST") {
    const f = new URLSearchParams(body);
    if (f.get("client_id") !== ETSY_KEY) return json(res, 401, { error: "invalid_client" });
    if (f.get("grant_type") === "authorization_code") {
      const c = state.etsy.codes.get(f.get("code"));
      state.etsy.codes.delete(f.get("code"));
      const verifierOk = c && b64url(createHash("sha256").update(f.get("code_verifier") ?? "").digest()) === c.challenge;
      if (!c || !verifierOk || c.redirect !== f.get("redirect_uri")) return json(res, 400, { error: "invalid_grant", error_description: "PKCE or redirect mismatch" });
      return json(res, 200, issueEtsy());
    }
    if (f.get("grant_type") === "refresh_token") {
      if (!state.etsy.refresh.get(f.get("refresh_token"))) return json(res, 400, { error: "invalid_grant" });
      state.etsy.refresh.delete(f.get("refresh_token")); // rotate
      state.etsy.refreshCount++;
      return json(res, 200, issueEtsy());
    }
    return json(res, 400, { error: "unsupported_grant_type" });
  }
  if (p.startsWith("/etsy-api/v3/application/")) {
    if (!etsyAuth(req, res)) return;
    const rest = p.slice("/etsy-api/v3/application".length);
    if (rest === "/users/me") return json(res, 200, { user_id: 7001, shop_id: state.etsy.shopId });
    if (rest === `/shops/${state.etsy.shopId}`) return json(res, 200, { shop_id: state.etsy.shopId, shop_name: "TaylorPrintsShop" });
    if (rest === `/shops/${state.etsy.shopId}/receipts`) {
      const min = Number(url.searchParams.get("min_last_modified") ?? 0);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 25);
      const all = [...state.etsy.receipts.values()].filter((r) => r.updated_timestamp >= min).sort((a, b) => a.updated_timestamp - b.updated_timestamp);
      return json(res, 200, { count: all.length, results: all.slice(offset, offset + limit) });
    }
    const m = /^\/shops\/(\d+)\/receipts\/(\d+)(\/tracking)?$/.exec(rest);
    if (m && Number(m[1]) === state.etsy.shopId) {
      const r = state.etsy.receipts.get(Number(m[2]));
      if (!r) return json(res, 404, { error: "Receipt not found" });
      if (m[3] && req.method === "POST") {
        const b = JSON.parse(body || "{}");
        state.etsy.trackingCalls.push({ receipt_id: r.receipt_id, ...b });
        r.is_shipped = true;
        r.status = "Completed";
        r.shipments = [...(r.shipments ?? []), { receipt_shipping_id: 900 + state.etsy.trackingCalls.length, shipment_notification_timestamp: nowS(), carrier_name: b.carrier_name, tracking_code: b.tracking_code }];
        r.updated_timestamp = nowS();
        return json(res, 200, r);
      }
      return json(res, 200, r);
    }
    return json(res, 404, { error: `No stub for ${rest}` });
  }

  // ---------------------------------------------------------------- eBay
  if (p === "/ebay-auth/oauth2/authorize") {
    const q = url.searchParams;
    if (q.get("client_id") !== EBAY_ID || !q.get("state") || q.get("response_type") !== "code") return json(res, 400, { error: "invalid_request" });
    const code = `v^1.1#i^1#${randomUUID()}`;
    state.ebay.codes.set(code, q.get("redirect_uri"));
    const back = new URL(EBAY_ACCEPT_URL);
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.get("state"));
    back.searchParams.set("expires_in", "299");
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (p === "/ebay-api/identity/v1/oauth2/token" && req.method === "POST") {
    if (req.headers.authorization !== `Basic ${Buffer.from(`${EBAY_ID}:${EBAY_SECRET}`).toString("base64")}`) return json(res, 401, { error: "invalid_client" });
    const f = new URLSearchParams(body);
    const issue = () => {
      const access = `v^1.1#at-${randomUUID()}`;
      state.ebay.tokens.set(access, { exp: Date.now() + 7200_000 });
      return access;
    };
    if (f.get("grant_type") === "authorization_code") {
      const ru = state.ebay.codes.get(f.get("code"));
      state.ebay.codes.delete(f.get("code"));
      if (!ru || ru !== f.get("redirect_uri")) return json(res, 400, { error: "invalid_grant" });
      const refresh = `v^1.1#rt-${randomUUID()}`;
      state.ebay.refresh.add(refresh);
      return json(res, 200, { access_token: issue(), expires_in: 7200, refresh_token: refresh, refresh_token_expires_in: 47304000, token_type: "User Access Token" });
    }
    if (f.get("grant_type") === "refresh_token") {
      if (!state.ebay.refresh.has(f.get("refresh_token"))) return json(res, 400, { error: "invalid_grant" });
      return json(res, 200, { access_token: issue(), expires_in: 7200, token_type: "User Access Token" });
    }
    return json(res, 400, { error: "unsupported_grant_type" });
  }
  if (p === "/ebay-apiz/commerce/identity/v1/user/") {
    if (!ebayAuth(req, res)) return;
    return json(res, 200, { userId: "ebay-user-123", username: "taylorprints_uk" });
  }
  if (p === "/ebay-api/sell/fulfillment/v1/order") {
    if (!ebayAuth(req, res)) return;
    const f = url.searchParams.get("filter") ?? "";
    const m = /lastmodifieddate:\[([^\]]*)\.\.\]/.exec(f);
    const since = m ? Date.parse(m[1]) : 0;
    const orders = [...state.ebay.orders.values()].filter((o) => Date.parse(o.lastModifiedDate) >= since);
    return json(res, 200, { href: req.url, total: orders.length, limit: 200, offset: 0, orders });
  }
  const eo = /^\/ebay-api\/sell\/fulfillment\/v1\/order\/([^/]+)(\/shipping_fulfillment)?$/.exec(p);
  if (eo) {
    if (!ebayAuth(req, res)) return;
    const o = state.ebay.orders.get(decodeURIComponent(eo[1]));
    if (!o) return json(res, 404, { errors: [{ message: "Order not found" }] });
    if (eo[2] && req.method === "POST") {
      if (state.ebay.failNextFulfillment > 0) {
        state.ebay.failNextFulfillment--;
        return json(res, 400, { errors: [{ errorId: 32100, message: "Invalid shipping carrier", longMessage: "The shipping carrier code is not valid." }] });
      }
      const b = JSON.parse(body);
      const id = `${Date.now()}`;
      state.ebay.fulfillments.push({ orderId: o.orderId, fulfillmentId: id, ...b });
      o.orderFulfillmentStatus = "FULFILLED";
      o.lastModifiedDate = new Date().toISOString();
      res.writeHead(201, { location: `https://api.ebay.com/sell/fulfillment/v1/order/${o.orderId}/shipping_fulfillment/${id}` });
      return res.end();
    }
    return json(res, 200, o);
  }

  // ---------------------------------------------------------------- Royal Mail Click & Drop
  if (p.startsWith("/royalmail/api/v1/")) {
    if (req.headers.authorization !== `Bearer ${RM_KEY}`) return json(res, 401, undefined);
    const rest = p.slice("/royalmail/api/v1".length);
    if (rest === "/orders" && req.method === "GET") return json(res, 200, { orders: [], continuationToken: null });
    if (rest === "/orders" && req.method === "POST") {
      const items = JSON.parse(body).items ?? [];
      const created = [], failed = [];
      for (const it of items) {
        if (!it.recipient?.address?.addressLine1 || !it.recipient?.address?.countryCode) {
          failed.push({ order: it, errors: [{ errorCode: 1, errorMessage: "Recipient address is invalid" }] });
          continue;
        }
        const o = { orderIdentifier: state.rm.nextId++, orderReference: it.orderReference, createdOn: new Date().toISOString(), orderDate: it.orderDate, request: it };
        state.rm.orders.set(o.orderIdentifier, o);
        created.push({ orderIdentifier: o.orderIdentifier, orderReference: o.orderReference, createdOn: o.createdOn, orderDate: o.orderDate, labelErrors: [] });
      }
      return json(res, 200, { successCount: created.length, errorsCount: failed.length, createdOrders: created, failedOrders: failed });
    }
    const m = /^\/orders\/(\d+)$/.exec(rest);
    if (m && req.method === "GET") {
      const o = state.rm.orders.get(Number(m[1]));
      if (!o) return json(res, 404, undefined);
      return json(res, 200, [{ orderIdentifier: o.orderIdentifier, orderReference: o.orderReference, createdOn: o.createdOn, trackingNumber: o.trackingNumber, shippedOn: o.shippedOn }]);
    }
    return json(res, 404, undefined);
  }

  json(res, 404, { error: `no stub route ${req.method} ${p}` });
});

server.listen(PORT, "127.0.0.1", () => console.log(`stub APIs on http://127.0.0.1:${PORT}`));
