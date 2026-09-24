/**
 * End-to-end marketplace + shipping flow against a running PrintFlow app, the
 * local Supabase stack and tests/integration/stub-apis.mjs.
 * See tests/integration/README.md for setup.
 *
 * Etsy:  connect (OAuth+PKCE) → sync → SKU match → MAPPING REQUIRED → manual map → retry
 *        → no duplicates on re-sync → signed webhook (+ duplicate + bad signature)
 *        → token refresh → production → pack → Royal Mail label → tracking → ship → Etsy updated
 * eBay:  connect (OAuth) → sync → order → ship → fulfilment failure → retry → eBay updated
 */
import { chromium } from "playwright";
import { createHmac } from "node:crypto";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const STUB = process.env.STUB_URL ?? "http://127.0.0.1:4010";
const WHSEC = process.env.ETSY_WEBHOOK_SECRET;
const CRON = process.env.CRON_SECRET;
const EXE = process.env.CHROMIUM_PATH;
if (!WHSEC || !CRON) throw new Error("Set ETSY_WEBHOOK_SECRET and CRON_SECRET (same values as the app).");

const stamp = Date.now();
const nowS = () => Math.floor(Date.now() / 1000);
const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let failed = false;
const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  try {
    await fn();
    console.log("ok");
  } catch (e) {
    failed = true;
    console.log("FAILED");
    console.error(e);
    await page.screenshot({ path: `/tmp/pf-e2e-fail-${name.replace(/\W+/g, "_")}.png`, fullPage: true }).catch(() => {});
    await browser.close();
    process.exit(1);
  }
};
const stub = async (path, body) =>
  (await fetch(`${STUB}${path}`, body ? { method: "POST", body: JSON.stringify(body) } : {})).json();
const toast = (text) => page.getByText(text, { exact: false }).first().waitFor({ timeout: 20000 });
const money = (a) => ({ amount: Math.round(a * 100), divisor: 100, currency_code: "GBP" });

function receipt(id, { sku, qty = 1, price = 12.99, paid = true, status = "Paid", title = "Pokemon Card Display" } = {}) {
  return {
    receipt_id: id,
    buyer_user_id: 5000 + (id % 1000),
    buyer_email: `buyer${id}@example.com`,
    name: `Etsy Buyer ${id}`,
    first_line: "1 Test Street",
    city: "Leeds",
    zip: "LS1 1AA",
    country_iso: "GB",
    status,
    is_paid: paid,
    is_shipped: false,
    created_timestamp: nowS() - 600,
    subtotal: money(price * qty),
    total_shipping_cost: money(2.99),
    discount_amt: money(0),
    grandtotal: money(price * qty + 2.99),
    transactions: [{ transaction_id: id * 10, listing_id: 800000 + (id % 1000), product_id: 900000 + (id % 1000), sku, title, quantity: qty, price: money(price) }],
  };
}

async function signedWebhook(id, bodyObj, { tamper = false } = {}) {
  const body = JSON.stringify(bodyObj);
  const ts = String(nowS());
  const key = Buffer.from(WHSEC.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return fetch(`${BASE}/api/webhooks/etsy`, {
    method: "POST",
    headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${tamper ? sig.replace(/^./, "A") : sig}` },
    body,
  });
}

async function orderCountFor(channel) {
  await page.goto(`${BASE}/orders?view=all&channel=${channel}`);
  await page.locator("h1").first().waitFor();
  return page.locator("tbody tr").count();
}

async function produceAndPack(orderUrl) {
  await page.goto(orderUrl);
  const rows = page.locator("#production li");
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    await row.getByRole("button", { name: "Start" }).click();
    // Jobs without a printer open the printer picker first.
    await page.getByRole("dialog").getByRole("button", { name: "Start job" }).click({ timeout: 3000 }).catch(() => {});
    await row.getByRole("button", { name: "Complete" }).waitFor();
    await row.getByRole("button", { name: "Complete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark printed" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await row.getByText("Printed", { exact: true }).waitFor();
  }
  await page.getByRole("button", { name: "Pack order" }).click();
  await toast("is now packing");
  await page.getByRole("button", { name: "Mark packed" }).click();
  await toast("is now ready to ship");
}

// ---------------------------------------------------------------- setup
await step("sign up and create business (no demo data)", async () => {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel("Your name").fill("Integration Tester");
  await page.getByLabel("Email").fill(`integration${stamp}@example.com`);
  await page.getByLabel("Password").fill("integration-pass-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByLabel("Business name").fill("Integration Prints");
  await page.getByLabel("Load demo data").click(); // untick
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/dashboard/);
});

await step("create product with SKU PCD-BLK-01", async () => {
  await page.goto(`${BASE}/products/new`);
  await page.getByLabel("Product name").fill("Pokemon Card Display");
  await page.getByLabel("SKU").fill("PCD-BLK-01");
  await page.getByLabel(/Selling price/).fill("12.99");
  await page.getByLabel("Filament (g)").fill("80");
  await page.locator("#p-hours").fill("1");
  await page.getByRole("button", { name: "Create product" }).click();
  await page.waitForURL(/\/products\/[0-9a-f-]{36}/);
});

// ---------------------------------------------------------------- Etsy
await step("Etsy shows not connected; Meta shows unsupported", async () => {
  await page.goto(`${BASE}/settings/integrations`);
  const etsy = page.locator("div[data-slot=card]", { hasText: "Imports paid receipts" });
  await etsy.getByText("Not connected").waitFor();
  await page.getByText("Not currently supported").waitFor();
  await page.getByText("No shipping provider connected").count(); // may not render here
});

await step("connect Etsy via OAuth + PKCE", async () => {
  await page.getByRole("link", { name: "Connect Etsy" }).click();
  await page.waitForURL(/settings\/integrations\?connected=etsy/);
  await page.getByText("Etsy connected to TaylorPrintsShop").waitFor();
  const etsy = page.locator("div[data-slot=card]", { hasText: "Imports paid receipts" });
  await etsy.locator("[data-slot=badge]", { hasText: "Connected" }).waitFor();
});

const R_MATCH = 3000000000 + (stamp % 100000);
const R_UNMAPPED = R_MATCH + 1;
const R_UNPAID = R_MATCH + 2;
const R_WEBHOOK = R_MATCH + 3;
let etsyOrderUrl;

await step("sync Etsy: SKU match imports, unknown SKU needs mapping, unpaid skipped", async () => {
  await stub("/__control/etsy/receipt", receipt(R_MATCH, { sku: "PCD-BLK-01", qty: 2 }));
  await stub("/__control/etsy/receipt", receipt(R_UNMAPPED, { sku: "MYSTERY-01", title: "Mystery Dragon" }));
  await stub("/__control/etsy/receipt", receipt(R_UNPAID, { sku: "PCD-BLK-01", paid: false, status: "Open" }));
  await page.getByRole("button", { name: "Sync Etsy now" }).click();
  await toast("Etsy: 3 found, 1 created, 0 updated, 2 skipped");
  if ((await orderCountFor("etsy")) !== 1) throw new Error("expected exactly 1 Etsy order");
});

await step("mapping required: map the unknown listing and retry", async () => {
  await page.goto(`${BASE}/dashboard`);
  await page.getByText("waiting for product mapping").waitFor();
  await page.goto(`${BASE}/settings/integrations/imports`);
  await page.getByText("Mystery Dragon").waitFor();
  await page.getByText("SKU not found in PrintFlow").waitFor();
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /Pokemon Card Display/ }).click();
  await page.getByRole("button", { name: /Save mapping/ }).click();
  await toast("Mapping saved");
  await page.getByRole("button", { name: "Retry import" }).click();
  await toast("created with production jobs");
  if ((await orderCountFor("etsy")) !== 2) throw new Error("expected 2 Etsy orders after mapping");
});

await step("re-sync is idempotent (no duplicate orders)", async () => {
  await page.goto(`${BASE}/settings/integrations`);
  await page.getByRole("button", { name: "Sync Etsy now" }).click();
  await toast("0 created");
  if ((await orderCountFor("etsy")) !== 2) throw new Error("duplicates created on re-sync");
});

await step("signed Etsy webhook creates the order; duplicates and forgeries rejected", async () => {
  await stub("/__control/etsy/receipt", receipt(R_WEBHOOK, { sku: "PCD-BLK-01" }));
  const payload = { event_type: "ORDER_PAID", resource_url: `https://api.etsy.com/v3/application/shops/42/receipts/${R_WEBHOOK}`, shop_id: 42 };
  const r1 = await signedWebhook(`msg_${stamp}`, payload);
  if (r1.status !== 200) throw new Error(`webhook status ${r1.status} ${await r1.text()}`);
  const r2 = await signedWebhook(`msg_${stamp}`, payload);
  const b2 = await r2.json();
  if (!b2.duplicate) throw new Error("duplicate delivery not detected");
  const r3 = await signedWebhook(`msg_bad_${stamp}`, payload, { tamper: true });
  if (r3.status !== 401) throw new Error(`forged webhook accepted (${r3.status})`);
  if ((await orderCountFor("etsy")) !== 3) throw new Error("webhook order not created exactly once");
});

await step("expired access token is refreshed (refresh token rotated)", async () => {
  await stub("/__control/etsy/expire-tokens", {});
  await page.goto(`${BASE}/settings/integrations`);
  await page.getByRole("button", { name: "Sync Etsy now" }).click();
  await toast("Etsy:");
  const s = await stub("/__control/state");
  if (s.etsy.refreshCount < 1) throw new Error("no refresh happened");
});

await step("connect Royal Mail Click & Drop", async () => {
  await page.goto(`${BASE}/settings/integrations`);
  await page.getByLabel("Click & Drop API key").fill("rm-test-api-key-0001");
  await page.getByRole("button", { name: "Test & connect" }).click();
  await toast("Royal Mail Click & Drop connected");
});

await step("Etsy order: produce, pack", async () => {
  await page.goto(`${BASE}/orders?view=all&q=${R_MATCH}`);
  await page.getByRole("link", { name: /PF-/ }).first().click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}/);
  etsyOrderUrl = page.url();
  await page.getByText(String(R_MATCH)).first().waitFor();
  await produceAndPack(etsyOrderUrl);
});

await step("create Royal Mail label (explicit confirmation) and pull tracking", async () => {
  await page.getByRole("button", { name: "Create shipping label" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Package weight (g)").fill("220");
  const create = d.getByRole("button", { name: "Create label" });
  if (!(await create.isDisabled())) throw new Error("label could be created without confirmation");
  await d.getByText("I understand this creates a real order").click();
  await create.click();
  await toast("created in Click & Drop");
  await stub("/__control/rm/ship", {});
  await page.getByRole("button", { name: "Refresh tracking" }).click();
  await toast("Tracking RM");
  await page.reload();
  await page.getByText(/RM0000\d+GB/).first().waitFor();
});

await step("mark shipped and send tracking to Etsy (confirmed by Etsy)", async () => {
  await page.getByRole("button", { name: "Mark shipped" }).click();
  const d = page.getByRole("dialog");
  await d.getByText("Also mark the order shipped on Etsy").waitFor();
  await d.getByRole("button", { name: "Mark as shipped" }).click();
  await toast("Tracking confirmed by Etsy");
  await page.reload();
  await page.locator("div[data-slot=card]", { hasText: "Marketplace" }).getByText("Synced").first().waitFor();
  const s = await stub("/__control/state");
  const call = s.etsy.trackingCalls.find((c) => c.receipt_id === R_MATCH);
  if (!call || !/^RM/.test(call.tracking_code) || call.carrier_name !== "royal-mail") throw new Error(`Etsy tracking call wrong: ${JSON.stringify(call)}`);
});

await step("Etsy cancellation syncs into PrintFlow", async () => {
  await stub("/__control/etsy/receipt", { receipt_id: R_WEBHOOK, status: "Canceled" });
  await page.goto(`${BASE}/settings/integrations`);
  await page.getByRole("button", { name: "Sync Etsy now" }).click();
  await toast("1 updated");
  await page.goto(`${BASE}/orders?view=closed&channel=etsy`);
  if ((await page.locator("tbody tr").count()) !== 1) throw new Error("cancelled order not reflected");
});

// ---------------------------------------------------------------- eBay
const EBAY_ORDER = `27-${stamp % 100000}-00001`;
await step("connect eBay (sandbox) and import an order", async () => {
  await page.goto(`${BASE}/settings/integrations`);
  await page.getByRole("link", { name: "Connect eBay" }).click();
  await page.waitForURL(/connected=ebay/);
  await page.getByText("eBay connected to taylorprints_uk").waitFor();
  await stub("/__control/ebay/order", {
    orderId: EBAY_ORDER,
    creationDate: new Date(Date.now() - 3600_000).toISOString(),
    orderPaymentStatus: "PAID",
    orderFulfillmentStatus: "NOT_STARTED",
    buyer: { username: "card_fan_1" },
    fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: "eBay Buyer", contactAddress: { addressLine1: "2 Auction Way", city: "York", postalCode: "YO1 1AA", countryCode: "GB" } } } }],
    lineItems: [{ lineItemId: "EB-LINE-1", legacyItemId: "110011", sku: "PCD-BLK-01", title: "Card display", quantity: 1, lineItemCost: { value: "14.50", currency: "GBP" } }],
    pricingSummary: { priceSubtotal: { value: "14.50", currency: "GBP" }, deliveryCost: { value: "3.20", currency: "GBP" }, total: { value: "17.70", currency: "GBP" } },
    totalMarketplaceFee: { value: "2.10", currency: "GBP" },
  });
  await page.getByRole("button", { name: "Sync eBay now" }).click();
  await toast("eBay: 1 found, 1 created");
});

await step("eBay: fulfilment failure is shown, retry succeeds", async () => {
  await page.goto(`${BASE}/orders?view=all&channel=ebay`);
  await page.getByRole("link", { name: /PF-/ }).first().click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}/);
  await page.getByText("£2.10").first().waitFor(); // marketplace fees imported
  await produceAndPack(page.url());
  await stub("/__control/ebay/fail-next-fulfillment?n=1", {});
  await page.getByRole("button", { name: "Mark shipped" }).click();
  const d = page.getByRole("dialog");
  await d.locator("#s-tracking").fill("EB123456789GB");
  await d.getByRole("button", { name: "Mark as shipped" }).click();
  await toast("eBay was not updated");
  await page.reload();
  const card = page.locator("div[data-slot=card]", { hasText: "Marketplace" });
  await card.getByText("Failed").first().waitFor();
  await card.getByRole("button", { name: /Retry/ }).click();
  await toast("eBay confirmed the shipment");
  const s = await stub("/__control/state");
  const f = s.ebay.fulfillments.find((x) => x.orderId === EBAY_ORDER);
  if (!f || f.lineItems?.[0]?.lineItemId !== "EB-LINE-1" || f.trackingNumber !== "EB123456789GB" || f.shippingCarrierCode !== "RoyalMail") {
    throw new Error(`eBay fulfilment wrong: ${JSON.stringify(f)}`);
  }
});

// ---------------------------------------------------------------- history, cron, disconnect
await step("sync history records operations", async () => {
  await page.goto(`${BASE}/settings/integrations/history`);
  for (const t of ["Order sync", "Webhook", "Tracking update", "Shipping label", "Connect"]) await page.getByText(t).first().waitFor();
  await page.getByText("Failed").first().waitFor();
});

await step("cron endpoint requires its secret", async () => {
  const bad = await fetch(`${BASE}/api/cron/integrations`);
  if (bad.status !== 401) throw new Error(`cron without secret returned ${bad.status}`);
  const ok = await fetch(`${BASE}/api/cron/integrations`, { headers: { authorization: `Bearer ${CRON}` } });
  if (ok.status !== 200) throw new Error(`cron returned ${ok.status}`);
  const body = await ok.json();
  if (!Array.isArray(body.syncs) || body.syncs.length < 2) throw new Error(`cron summary ${JSON.stringify(body)}`);
});

await step("disconnect Etsy", async () => {
  await page.goto(`${BASE}/settings/integrations`);
  await page.getByRole("button", { name: "Disconnect" }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
  await toast("Disconnected");
  await page.getByRole("link", { name: "Connect Etsy" }).waitFor();
});

console.log(errors.length ? `\nBrowser errors:\n${errors.join("\n")}` : "\nNo browser errors");
await browser.close();
process.exit(failed ? 1 : 0);
