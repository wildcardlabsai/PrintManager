/**
 * Row Level Security checks for the Phase 2 tables, run against the local
 * Supabase stack with the anon key (as a browser would).
 */
const API = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const h = (t) => ({ apikey: ANON, Authorization: `Bearer ${t ?? ANON}`, "Content-Type": "application/json", Prefer: "return=representation" });
const signup = async (email) => (await (await fetch(`${API}/auth/v1/signup`, { method: "POST", headers: h(), body: JSON.stringify({ email, password: "password-123456" }) })).json()).access_token;
const rest = async (t, path, init = {}) => {
  const r = await fetch(`${API}/rest/v1/${path}`, { ...init, headers: { ...h(t), ...(init.headers ?? {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
let failures = 0;
const check = (name, ok) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};

const s = Date.now();
const A = await signup(`rls-a-${s}@example.com`);
const B = await signup(`rls-b-${s}@example.com`);
const orgA = (await rest(A, "rpc/create_organization", { method: "POST", body: JSON.stringify({ p_name: "A" }) })).body;
await rest(B, "rpc/create_organization", { method: "POST", body: JSON.stringify({ p_name: "B" }) });

for (const t of ["integration_credentials", "oauth_states"]) {
  const r = await rest(A, `${t}?select=*`);
  check(`authenticated users cannot read ${t} (status ${r.status})`, r.status === 401 || r.status === 403 || (Array.isArray(r.body) && r.body.length === 0));
  const w = await rest(A, t, { method: "POST", body: JSON.stringify({ organization_id: orgA }) });
  check(`authenticated users cannot write ${t}`, w.status >= 400);
}
const connIns = await rest(A, "integration_connections", { method: "POST", body: JSON.stringify({ organization_id: orgA, provider: "etsy", kind: "marketplace", status: "connected" }) });
check("members cannot forge a connection (server-only writes)", connIns.status >= 400);
const conns = await rest(A, "integration_connections?select=*");
check("members only see their own connections", Array.isArray(conns.body) && conns.body.every((c) => c.organization_id === orgA));
const allConns = await rest(null, "integration_connections?select=*");
check("anonymous sees no connections", allConns.status >= 400 || (Array.isArray(allConns.body) && allConns.body.length === 0));

const mapIns = await rest(B, "product_mappings", { method: "POST", body: JSON.stringify({ organization_id: orgA, sales_channel: "etsy", external_sku: "X", product_id: "00000000-0000-0000-0000-000000000000" }) });
check("cross-business mapping insert blocked", mapIns.status >= 400);
for (const t of ["external_orders", "integration_sync_logs", "marketplace_fulfillments", "product_mappings", "webhook_events"]) {
  const r = await rest(B, `${t}?organization_id=eq.${orgA}&select=id`);
  check(`other business cannot read ${t}`, Array.isArray(r.body) && r.body.length === 0);
}
const rpc = await rest(A, "rpc/create_order", { method: "POST", body: JSON.stringify({ p_org: orgA, p_order: { customer_name: "x", actor_id: "00000000-0000-0000-0000-000000000000" }, p_items: [] }) });
check("create_order still validates items for users", rpc.status >= 400);
const anonRpc = await rest(null, "rpc/create_order", { method: "POST", body: JSON.stringify({ p_org: orgA, p_order: {}, p_items: [{}] }) });
check("anonymous cannot call create_order", anonRpc.status >= 400);
process.exit(failures ? 1 : 0);
