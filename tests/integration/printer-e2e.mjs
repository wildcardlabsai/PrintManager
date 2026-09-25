/**
 * End-to-end printer flow against a running PrintFlow app and the local
 * Supabase stack, using the real PrintFlow Printer Agent (agent/dist) in MOCK
 * mode — simulated printers, clearly labelled as such everywhere.
 *
 * Optionally (FAKE_FNET_DIR set) a second agent runs the real FlashNetwork FFI
 * transport against a test double of Flashforge's library compiled from the
 * official header, to exercise the flashforge_lan driver path end to end.
 * Neither is a physical printer: see tests/integration/README.md.
 *
 * Covers: pairing, token auth, connection settings, live telemetry, checklist,
 * test print, print-file upload, send-to-printer confirmation, progress,
 * pause/resume, completion → order PRINTED, review (filament), stop, retry,
 * printer error, stopped-at-printer, offline/reconnect, permissions (viewer,
 * operator), agent API security, revocation, audit, notifications, automatic
 * print queue, pack → ship.
 */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EXE = process.env.CHROMIUM_PATH;
const FAKE_FNET = process.env.FAKE_FNET_DIR;
const AGENT_CLI = path.resolve("agent/dist/cli.js");
if (!SUPABASE || !SERVICE || !ANON) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.");
if (!fs.existsSync(AGENT_CLI)) throw new Error("Build the agent first: cd agent && npm install && npm run build");

const stamp = Date.now();
const work = fs.mkdtempSync(path.join(os.tmpdir(), "pf-printer-e2e-"));
const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const agents = [];

const cleanup = () => {
  for (const a of agents) a.kill("SIGTERM");
};
const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  try {
    await fn();
    console.log("ok");
  } catch (e) {
    console.log("FAILED");
    console.error(e);
    await page.screenshot({ path: `/tmp/pf-printer-e2e-fail-${name.replace(/\W+/g, "_")}.png`, fullPage: true }).catch(() => {});
    for (const a of agents) console.error(`--- agent log ---\n${a.log.slice(-3000)}`);
    cleanup();
    await browser.close();
    process.exit(1);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 60000, every = 1000, what = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(every);
  }
  throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)?.slice(0, 300)})`);
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

async function rest(p, { method = "GET", body, token = SERVICE, prefer } = {}) {
  const res = await fetch(`${SUPABASE}/rest/v1/${p}`, {
    method,
    headers: {
      apikey: token === SERVICE ? SERVICE : ANON,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
const one = async (p) => (await rest(p)).data?.[0];

function startAgent(name, config, extraEnv = {}) {
  const child = spawn(process.execPath, [AGENT_CLI, "run"], { env: { ...process.env, PRINTFLOW_AGENT_CONFIG: config, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  child.log = "";
  child.stdout.on("data", (d) => (child.log += d));
  child.stderr.on("data", (d) => (child.log += d));
  child.name = name;
  agents.push(child);
  return child;
}
function agentCli(config, ...args) {
  return execFileSync(process.execPath, [AGENT_CLI, ...args], { env: { ...process.env, PRINTFLOW_AGENT_CONFIG: config }, encoding: "utf8" });
}
const mock = async (serial, action) => {
  const r = await fetch(`http://127.0.0.1:4455/printers/${serial}/${action}`, { method: "POST" });
  assert(r.ok, `mock control ${action} failed`);
};
const toast = (text) => page.getByText(text, { exact: false }).first().waitFor({ timeout: 30000 });

let orgId;
let ad5x;
let m5;
let productId;
let fileId;
let agentId;
const MOCK_SERIAL = "SNAD5XMOCK01";
const MOCK_CODE = "8C3F12AB";
const mockConfig = path.join(work, "mock-agent.json");

async function jobFor(orderId) {
  return one(`production_jobs?order_id=eq.${orderId}&select=*`);
}
async function createOrder(label, extra = {}) {
  const r = await rest("rpc/create_order", {
    method: "POST",
    body: {
      p_org: orgId,
      p_order: {
        customer_name: `Etsy Buyer ${label}`,
        sales_channel: "etsy",
        external_order_id: `E2E-${stamp}-${label}`,
        payment_status: "paid",
        subtotal: 14.99,
        ...extra,
      },
      p_items: [{ product_id: productId, product_name: "Dragon Egg", sku: `DRG-${stamp}`, quantity: 1, unit_price: 14.99, material: "PLA", colour: "#FFFFFF", estimated_minutes: 60, estimated_grams: 20 }],
    },
  });
  assert(r.status === 200, `create_order failed ${JSON.stringify(r.data)}`);
  return r.data;
}
async function sendViaDialog(jobId, { printerName = "Flashforge AD5X" } = {}) {
  await page.goto(`${BASE}/production/${jobId}`);
  await page.getByRole("button", { name: "Send to printer" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByText("Estimated time").waitFor();
  const printerSelect = dlg.locator("#send-printer");
  if (!(await printerSelect.innerText()).includes(printerName)) {
    await printerSelect.click();
    await page.getByRole("option", { name: printerName }).click();
  }
  await dlg.getByText("Checking with the latest printer status").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await sleep(500);
  const boxes = dlg.locator("[id^=ack-]");
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).click();
  const start = dlg.getByRole("button", { name: `Start print on ${printerName}` });
  await waitFor(async () => start.isEnabled(), { timeout: 15000, what: "start button enabled" });
  await start.click();
  await toast("Sent to the Printer Agent");
}

// ---------------------------------------------------------------- setup
await step("sign up and create business", async () => {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel("Your name").fill("Printer Owner");
  await page.getByLabel("Email").fill(`printers${stamp}@example.com`);
  await page.getByLabel("Password").fill("printer-pass-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByLabel("Business name").fill(`Printer E2E ${stamp}`);
  await page.getByLabel("Load demo data").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/dashboard/);
  orgId = (await one(`organizations?name=eq.${encodeURIComponent(`Printer E2E ${stamp}`)}&select=id`)).id;
  ad5x = await one(`printers?organization_id=eq.${orgId}&model=eq.AD5X&select=*`);
  m5 = await one(`printers?organization_id=eq.${orgId}&model=eq.Adventurer%205M&select=*`);
  assert(ad5x && m5, "default printers missing");
  assert(ad5x.connection_mode === "manual" && ad5x.multi_colour === true && m5.multi_colour === false, "printer defaults");
  const prod = await rest("products", { method: "POST", prefer: "return=representation", body: { organization_id: orgId, sku: `DRG-${stamp}`, name: "Dragon Egg", selling_price: 14.99, material: "PLA", default_colour: "#FFFFFF", filament_grams: 20, print_minutes: 60 } });
  productId = prod.data[0].id;
});

await step("production screen without connected printers is honest about manual mode", async () => {
  await page.goto(`${BASE}/production`);
  await page.getByText("No printer is connected yet").waitFor();
  await page.goto(`${BASE}/printers`);
  await page.getByText("No printer is connected yet, so statuses here are set by hand").waitFor();
});

// ---------------------------------------------------------------- agent pairing
let pairingCode;
await step("create a Printer Agent and pair it (mock mode)", async () => {
  await page.goto(`${BASE}/printers/agents`);
  await page.getByRole("button", { name: "Add Printer Agent" }).click();
  await page.getByLabel("Name").fill("Workshop PC (simulated)");
  await page.getByRole("button", { name: "Create pairing code" }).click();
  const code = page.locator(".tracking-widest");
  await code.waitFor();
  pairingCode = (await code.innerText()).trim();
  assert(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(pairingCode), `code ${pairingCode}`);
  await page.getByRole("button", { name: "Done" }).click();
  const agentRow = await one(`printer_agents?organization_id=eq.${orgId}&select=id,status,pairing_code_hash,token_hash`);
  agentId = agentRow.id;
  assert(agentRow.status === "pending" && agentRow.pairing_code_hash && !agentRow.pairing_code_hash.includes(pairingCode.replace(/-/g, "")), "stored hashed");
  const out = agentCli(mockConfig, "pair", "--server", BASE, "--code", pairingCode, "--mock");
  assert(out.includes(`Paired with Printer E2E ${stamp}`), out);
  const cfg = JSON.parse(fs.readFileSync(mockConfig, "utf8"));
  assert(cfg.token.startsWith("pfa_") && cfg.driver === "mock", "config written");
  assert((fs.statSync(mockConfig).mode & 0o777) === 0o600, "config is 0600");
  const after = await one(`printer_agents?id=eq.${agentId}&select=status,pairing_code_hash,token_hash`);
  assert(after.status === "active" && !after.pairing_code_hash && after.token_hash && after.token_hash !== cfg.token, "active, code consumed, token hashed");
});

await step("a pairing code works once", async () => {
  const r = await fetch(`${BASE}/api/agent/pair`, { method: "POST", body: JSON.stringify({ code: pairingCode, version: "x", platform: "x", driver: "mock" }) });
  assert(r.status === 401, `reuse got ${r.status}`);
});

await step("store the check code locally and start the agent", async () => {
  agentCli(mockConfig, "set-check-code", MOCK_SERIAL, MOCK_CODE);
  const cfg = JSON.parse(fs.readFileSync(mockConfig, "utf8"));
  cfg.mock = { controlPort: 4455, printSeconds: 60, speed: 1 };
  fs.writeFileSync(mockConfig, JSON.stringify(cfg), { mode: 0o600 });
  const status = agentCli(mockConfig, "status");
  assert(!status.includes(MOCK_CODE) && !status.includes(cfg.token), "status output hides secrets");
  startAgent("mock", mockConfig);
  await waitFor(async () => (await one(`printer_agents?id=eq.${agentId}&select=last_seen_at,driver`))?.last_seen_at, { what: "agent heartbeat" });
});

// ---------------------------------------------------------------- connection
await step("connect the AD5X to the agent (admin)", async () => {
  await page.goto(`${BASE}/printers/${ad5x.id}`);
  await page.getByRole("button", { name: "Connection settings" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator("#cs-mode").click();
  await page.getByRole("option", { name: /Printer Agent — Flashforge LAN/ }).click();
  await dlg.locator("#cs-agent").click();
  await page.getByRole("option", { name: "Workshop PC (simulated)" }).click();
  await dlg.getByLabel("Serial number").fill(MOCK_SERIAL);
  await dlg.getByLabel("IP address").fill("127.0.0.1");
  await dlg.getByLabel("LAN port").fill("8899");
  await dlg.getByRole("button", { name: "Save" }).click();
  await toast("Connection settings saved");
  await waitFor(async () => (await one(`printers?id=eq.${ad5x.id}&select=connection_state`))?.connection_state === "connected", { what: "printer connected" });
});

await step("live (simulated) telemetry is shown, nothing invented", async () => {
  await page.goto(`${BASE}/printers/${ad5x.id}`);
  await page.getByText("Live (simulated)").first().waitFor();
  await page.getByText("mock agent").first().waitFor();
  await page.getByText("Ready", { exact: true }).first().waitFor();
  await page.getByText("mock-1.0.0").first().waitFor();
  const row = await one(`printers?id=eq.${ad5x.id}&select=*`);
  assert(row.telemetry_source === "mock" && row.status === "idle" && row.raw_status === "ready", "status stored");
  assert(row.telemetry.materialStation.slots.length === 4, "IFS slots reported");
  // chamber temperature isn't reported by the simulator → "Not available"
  const chamber = page.locator("dt", { hasText: "Chamber" }).locator("xpath=following-sibling::dd[1]");
  assert((await chamber.innerText()).includes("Not available"), "chamber shows Not available");
  const events = (await rest(`printer_events?printer_id=eq.${ad5x.id}&select=type`)).data.map((e) => e.type);
  assert(events.includes("connected"), "connected event");
  assert(row.live_checklist.connect && row.live_checklist.read_status && row.live_checklist.firmware, "observed checklist steps");
});

await step("manual status can't be set on a connected printer", async () => {
  await page.goto(`${BASE}/printers`);
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Flashforge AD5X" }) });
  assert((await card.getByRole("combobox").count()) === 0, "no manual status select on connected card");
});

await step("test connection round-trips through the agent", async () => {
  await page.goto(`${BASE}/printers/${ad5x.id}`);
  await page.getByRole("button", { name: "Test connection" }).click();
  await toast("Connection test: done on the printer");
  await waitFor(async () => (await one(`printers?id=eq.${ad5x.id}&select=live_checklist`)).live_checklist.capabilities, { what: "capabilities ticked" });
});

// ---------------------------------------------------------------- print files
await step("upload a sliced G-code file (metadata read from the file)", async () => {
  const gcode = path.join(work, "dragon-egg-ad5x.gcode");
  fs.writeFileSync(
    gcode,
    [
      "; generated by OrcaSlicer 2.2.0",
      "; total layer number: 120",
      "G28",
      "G1 X10 Y10",
      "; filament used [g] = 19.6",
      "; estimated printing time (normal mode) = 58m 30s",
      "; filament_type = PLA",
      "; filament_colour = #FFFFFF",
      "; printer_model = Flashforge AD5X",
      "; printer_settings_id = Flashforge AD5X 0.4 Nozzle",
    ].join("\n"),
  );
  await page.goto(`${BASE}/print-files`);
  await page.getByRole("button", { name: "Upload print file" }).click();
  const dlg = page.getByRole("dialog");
  // Unsliced models are refused.
  const stl = path.join(work, "egg.stl");
  fs.writeFileSync(stl, "solid egg\nendsolid egg\n");
  await dlg.locator("#pf-file").setInputFiles(stl);
  await dlg.getByText("is a 3D model, not a print file").waitFor();
  await dlg.locator("#pf-file").setInputFiles(gcode);
  await dlg.getByText("SHA-256").waitFor();
  assert((await dlg.getByLabel("Estimated print time (minutes)").inputValue()) === "59", "time from slicer");
  assert((await dlg.getByLabel("Estimated filament (g)").inputValue()) === "19.6", "grams from slicer");
  assert(await dlg.locator("#pf-m-AD5X").isChecked(), "model from slicer");
  await dlg.locator("#pf-product").click();
  await page.getByRole("option", { name: /Dragon Egg/ }).click();
  await dlg.getByLabel("Default file for this product").click();
  await dlg.getByRole("button", { name: "Upload" }).click();
  await toast("Print file added");
  const f = await one(`print_files?organization_id=eq.${orgId}&select=*`);
  fileId = f.id;
  const sha = crypto.createHash("sha256").update(fs.readFileSync(gcode)).digest("hex");
  assert(f.sha256 === sha && f.product_id === productId && f.is_default && !f.verified_at && f.storage_path.startsWith(`${orgId}/`), "file row");
});

// ---------------------------------------------------------------- live checklist
await step("production sends are blocked until the printer is verified", async () => {
  const orderId = await createOrder("pre");
  const job = await jobFor(orderId);
  await page.goto(`${BASE}/production/${job.id}`);
  await page.getByRole("button", { name: "Send to printer" }).first().click();
  await page.getByRole("dialog").getByText("live test checklist").waitFor();
  assert(await page.getByRole("dialog").getByRole("button", { name: /Start print on/ }).isDisabled(), "start disabled");
  await page.keyboard.press("Escape");
  await rest(`production_jobs?id=eq.${job.id}`, { method: "PATCH", body: { status: "cancelled" } });
});

await step("supervised test print completes the checklist", async () => {
  await page.goto(`${BASE}/printers/${ad5x.id}`);
  await page.getByRole("button", { name: "Confirm" }).first().click(); // verify identity
  await toast("Checklist updated");
  await page.getByRole("button", { name: "Send test print" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByText("Estimated time").waitFor();
  await sleep(1500);
  const boxes = dlg.locator("[id^=ack-]");
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).click();
  await dlg.getByRole("button", { name: "Start print on Flashforge AD5X" }).click();
  await toast("Test print sent");
  await waitFor(async () => (await one(`printers?id=eq.${ad5x.id}&select=raw_status`)).raw_status === "printing", { what: "test print printing" });
  await waitFor(async () => (await one(`printers?id=eq.${ad5x.id}&select=live_checklist`)).live_checklist.progress, { what: "progress observed", timeout: 30000 });
  await mock(MOCK_SERIAL, "finish");
  await waitFor(async () => (await one(`printers?id=eq.${ad5x.id}&select=live_checklist`)).live_checklist.completion, { what: "completion observed" });
  await page.reload();
  await page.getByRole("button", { name: "Confirm" }).first().click(); // PrintFlow updated correctly
  await toast("Checklist updated");
  await page.getByRole("button", { name: "Mark verified for production" }).click();
  await toast("Printer verified for production");
  await page.getByText("Verified for production (against a simulated printer)").waitFor();
});

await step("plate must be confirmed clear before the next print (and tells the printer)", async () => {
  const p = await one(`printers?id=eq.${ad5x.id}&select=bed_clear,raw_status`);
  assert(p.bed_clear === false && p.raw_status === "completed", `bed state ${JSON.stringify(p)}`);
  await page.goto(`${BASE}/printers/${ad5x.id}`);
  await page.getByRole("button", { name: "Plate cleared" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Plate is clear" }).click();
  await toast("Build plate confirmed clear");
  await waitFor(async () => (await one(`printers?id=eq.${ad5x.id}&select=raw_status,bed_clear`)).raw_status === "ready", { what: "printer ready after clear_platform" });
});

// ---------------------------------------------------------------- the production workflow
let orderA;
let jobA;
await step("marketplace-style order → job → send to printer with confirmation", async () => {
  orderA = await createOrder("A");
  jobA = await jobFor(orderA);
  await page.goto(`${BASE}/production`);
  await page.getByText("Suggested:").first().waitFor();
  await sendViaDialog(jobA.id);
  const j = await one(`production_jobs?id=eq.${jobA.id}&select=status,printer_id,print_file_id,printer_file_name`);
  assert(["sending", "sent", "printing"].includes(j.status) && j.printer_id === ad5x.id && j.print_file_id === fileId, `job ${JSON.stringify(j)}`);
  assert(j.printer_file_name === `PF-JOB-${String(jobA.job_number).padStart(4, "0")}-dragon-egg-ad5x.gcode`, j.printer_file_name);
});

await step("job moves SENDING → QUEUED → PRINTING from telemetry; progress shows", async () => {
  await waitFor(async () => (await one(`production_jobs?id=eq.${jobA.id}&select=status`)).status === "printing", { what: "printing" });
  await waitFor(async () => Number((await one(`production_jobs?id=eq.${jobA.id}&select=progress`)).progress) > 0, { what: "progress" });
  const hist = (await rest(`status_history?entity_id=eq.${jobA.id}&select=to_status&order=created_at`)).data.map((h) => h.to_status);
  assert(hist.join(">").includes("sending>sent>printing"), hist.join(">"));
  const order = await one(`orders?id=eq.${orderA}&select=status`);
  assert(order.status === "printing", `order ${order.status}`);
  await page.goto(`${BASE}/production/${jobA.id}`);
  await page.getByText("Reported by the printer").waitFor();
  await page.getByRole("progressbar", { name: "Print progress reported by the printer" }).waitFor();
});

await step("pause and resume on the printer", async () => {
  await page.getByRole("button", { name: "Pause" }).first().click();
  await toast("Pause: done on the printer");
  await waitFor(async () => (await one(`production_jobs?id=eq.${jobA.id}&select=status`)).status === "paused", { what: "paused" });
  await page.reload();
  await page.getByRole("button", { name: "Resume" }).first().click();
  await toast("Resume: done on the printer");
  await waitFor(async () => (await one(`production_jobs?id=eq.${jobA.id}&select=status`)).status === "printing", { what: "resumed" });
});

await step("completion marks the job and the order PRINTED, with a notification", async () => {
  await mock(MOCK_SERIAL, "finish");
  await waitFor(async () => (await one(`production_jobs?id=eq.${jobA.id}&select=status`)).status === "printed", { what: "printed" });
  const j = await one(`production_jobs?id=eq.${jobA.id}&select=*`);
  assert(j.filament_recorded === false && Number(j.progress) === 100 && j.completed_at, "completion data");
  assert((await one(`orders?id=eq.${orderA}&select=status`)).status === "printed", "order printed");
  const n = await one(`notifications?organization_id=eq.${orgId}&type=eq.print_completed&select=title`);
  assert(n?.title.includes("printed on Flashforge AD5X"), "notification");
  await page.goto(`${BASE}/dashboard`);
  await page.getByRole("button", { name: /Notifications \(\d+ unread\)/ }).first().click();
  await page.getByText("printed on Flashforge AD5X").first().waitFor();
  await page.keyboard.press("Escape");
});

await step("review the print: actual filament vs estimate, file proven", async () => {
  await page.goto(`${BASE}/production/${jobA.id}`);
  await page.getByRole("button", { name: "Review print" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Filament used (g)").fill("21.5");
  await dlg.getByText("variance +1.5 g").waitFor();
  await dlg.getByRole("button", { name: "Save review" }).click();
  await toast("Print reviewed");
  const j = await one(`production_jobs?id=eq.${jobA.id}&select=filament_recorded,actual_grams`);
  assert(j.filament_recorded && Number(j.actual_grams) === 21.5, "review saved");
  assert((await one(`print_files?id=eq.${fileId}&select=verified_at`)).verified_at, "file proven");
});

await step("pack and ship the printed order", async () => {
  await page.goto(`${BASE}/orders/${orderA}`);
  await page.getByRole("button", { name: "Pack order" }).click();
  await toast("is now packing");
  await page.getByRole("button", { name: "Mark packed" }).click();
  await toast("is now ready to ship");
  const r = await rest(`orders?id=eq.${orderA}`, { method: "PATCH", body: { status: "shipped", shipping_status: "shipped", shipped_at: new Date().toISOString() } });
  assert(r.status < 300, "ship");
});

let jobB;
await step("stop requires confirmation and fails the job for a decision", async () => {
  await page.goto(`${BASE}/printers/${ad5x.id}`);
  await page.getByRole("button", { name: "Plate cleared" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Plate is clear" }).click();
  await toast("Build plate confirmed clear");
  await waitFor(async () => (await one(`printers?id=eq.${ad5x.id}&select=raw_status`)).raw_status === "ready", { what: "ready" });
  const orderB = await createOrder("B");
  jobB = await jobFor(orderB);
  await sendViaDialog(jobB.id);
  await waitFor(async () => (await one(`production_jobs?id=eq.${jobB.id}&select=status`)).status === "printing", { what: "B printing" });
  await page.goto(`${BASE}/production/${jobB.id}`);
  await page.getByRole("button", { name: "Stop" }).first().click();
  const alert = page.getByRole("alertdialog");
  await alert.getByText("can't be resumed").waitFor();
  await alert.getByRole("button", { name: "Stop print" }).click();
  await toast("Stop: done on the printer");
  await waitFor(async () => (await one(`production_jobs?id=eq.${jobB.id}&select=status,attention_code`)).attention_code === "print_failed", { what: "B failed" });
  const j = await one(`production_jobs?id=eq.${jobB.id}&select=status,failure_reason,needs_attention`);
  assert(j.status === "failed" && j.failure_reason === "Stopped from PrintFlow" && j.needs_attention, JSON.stringify(j));
});

await step("retry puts it back in the queue (never restarts by itself)", async () => {
  await page.goto(`${BASE}/production`);
  await page.getByText("Needs attention").first().waitFor();
  await page.getByRole("button", { name: "Retry" }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Queue again" }).click();
  await toast("Job queued again");
  const j = await one(`production_jobs?id=eq.${jobB.id}&select=status,attempts,needs_attention,printer_id`);
  assert(j.status === "queued" && j.attempts === 2 && !j.needs_attention && j.printer_id === ad5x.id, JSON.stringify(j));
  await sleep(5000);
  assert((await one(`production_jobs?id=eq.${jobB.id}&select=status`)).status === "queued", "still queued");
});

await step("printer error → alert; stopped at the printer → failed; mark failed", async () => {
  await waitFor(async () => (await one(`printers?id=eq.${ad5x.id}&select=raw_status`)).raw_status === "ready", { what: "ready after stop" });
  assert((await one(`printers?id=eq.${ad5x.id}&select=bed_clear`)).bed_clear === false, "a stopped print still leaves the plate to clear");
  await page.goto(`${BASE}/printers/${ad5x.id}`);
  await page.getByRole("button", { name: "Plate cleared" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Plate is clear" }).click();
  await toast("Build plate confirmed clear");
  await waitFor(async () => (await one(`printers?id=eq.${ad5x.id}&select=raw_status`)).raw_status === "ready", { what: "ready" });
  await sendViaDialog(jobB.id);
  await waitFor(async () => (await one(`production_jobs?id=eq.${jobB.id}&select=status`)).status === "printing", { what: "B printing again" });
  await mock(MOCK_SERIAL, "error");
  await waitFor(async () => (await one(`production_jobs?id=eq.${jobB.id}&select=attention_code`)).attention_code === "printer_error", { what: "printer_error alert" });
  assert((await one(`production_jobs?id=eq.${jobB.id}&select=status`)).status === "printing", "error alone doesn't fail the job");
  assert((await one(`notifications?organization_id=eq.${orgId}&type=eq.printer_error&select=id`)), "error notification");
  await mock(MOCK_SERIAL, "clear_error");
  await mock(MOCK_SERIAL, "cancel_at_printer");
  await waitFor(async () => (await one(`production_jobs?id=eq.${jobB.id}&select=status`)).status === "failed", { what: "stopped at printer" });
  assert((await one(`production_jobs?id=eq.${jobB.id}&select=attention_code`)).attention_code === "stopped_at_printer", "attention code");
  await page.goto(`${BASE}/production/${jobB.id}`);
  await page.getByRole("button", { name: "Mark failed" }).first().click();
  await page.getByRole("dialog").getByLabel("Wasted filament (g)").fill("0");
  await page.getByRole("dialog").getByRole("button", { name: "Mark failed" }).click();
  await toast("Marked failed");
  assert(!(await one(`production_jobs?id=eq.${jobB.id}&select=needs_attention`)).needs_attention, "alert cleared");
});

// ---------------------------------------------------------------- offline
await step("offline detection waits for the threshold, then recovers", async () => {
  await page.goto(`${BASE}/settings`);
  await page.getByLabel("Mark a printer offline after (seconds)").fill("30");
  await page.getByRole("button", { name: "Save production settings" }).click();
  await toast("Production settings saved");
  await mock(MOCK_SERIAL, "offline");
  await sleep(8000);
  assert((await one(`printers?id=eq.${ad5x.id}&select=connection_state`)).connection_state === "unreachable", "not offline after a few failures");
  await waitFor(async () => (await one(`printers?id=eq.${ad5x.id}&select=connection_state`)).connection_state === "offline", { what: "offline", timeout: 60000 });
  assert(await one(`printer_events?printer_id=eq.${ad5x.id}&type=eq.disconnected&select=id`), "disconnected event");
  assert(await one(`notifications?organization_id=eq.${orgId}&type=eq.printer_offline&select=id`), "offline notification");
  await page.goto(`${BASE}/printers`);
  await page.getByText("Offline").first().waitFor();
  await mock(MOCK_SERIAL, "online");
  await waitFor(async () => (await one(`printers?id=eq.${ad5x.id}&select=connection_state`)).connection_state === "connected", { what: "reconnected" });
  const types = (await rest(`printer_events?printer_id=eq.${ad5x.id}&select=type&order=created_at.desc&limit=3`)).data.map((e) => e.type);
  assert(types.includes("connected"), "connected again");
});

await step("a silent agent marks its printers offline; sending is refused", async () => {
  const mockAgent = agents.find((a) => a.name === "mock");
  mockAgent.kill("SIGTERM");
  await sleep(35000);
  await page.goto(`${BASE}/printers`); // page load sweeps stale printers
  await waitFor(async () => (await one(`printers?id=eq.${ad5x.id}&select=connection_state`)).connection_state === "offline", { what: "agent-silent offline" });
  const orderC = await createOrder("C");
  const jobC = await jobFor(orderC);
  await page.goto(`${BASE}/production/${jobC.id}`);
  await page.getByRole("button", { name: "Send to printer" }).first().click();
  await page.getByRole("dialog").getByText(/agent offline|offline/i).first().waitFor();
  assert(await page.getByRole("dialog").getByRole("button", { name: /Start print on/ }).isDisabled(), "start disabled while offline");
  await page.keyboard.press("Escape");
  startAgent("mock", mockConfig);
  await waitFor(async () => (await one(`printers?id=eq.${ad5x.id}&select=connection_state`)).connection_state === "connected", { what: "back online" });
});

// ---------------------------------------------------------------- permissions & security
let viewerToken;
await step("viewer can monitor but not control; operator can't configure", async () => {
  const email = `viewer${stamp}@example.com`;
  const signup = await fetch(`${SUPABASE}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password: "viewer-pass-123", data: { full_name: "Vera Viewer" } }) });
  const su = await signup.json();
  const userId = su.user?.id ?? su.id;
  await rest("organization_members", { method: "POST", body: { organization_id: orgId, user_id: userId, role: "viewer" } });
  const login = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password: "viewer-pass-123" }) });
  viewerToken = (await login.json()).access_token;
  // RLS: viewers read, can't write.
  assert((await rest(`printers?id=eq.${ad5x.id}&select=id`, { token: viewerToken })).data.length === 1, "viewer reads printers");
  const cmd = await rest("printer_commands", { method: "POST", token: viewerToken, body: { organization_id: orgId, printer_id: ad5x.id, agent_id: agentId, type: "stop", expires_at: new Date(Date.now() + 60000).toISOString() } });
  assert(cmd.status >= 400, `viewer inserted a command (${cmd.status})`);
  const upd = await rest(`production_jobs?id=eq.${jobA.id}`, { method: "PATCH", token: viewerToken, prefer: "return=representation", body: { notes: "hacked" } });
  assert(upd.status >= 400 || upd.data.length === 0, "viewer updated a job");
  const hashes = await rest(`printer_agents?select=token_hash`, { token: viewerToken });
  assert(hashes.status >= 400, "token hashes readable");
  // UI: no controls for the viewer.
  const vctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const vpage = await vctx.newPage();
  await vpage.goto(`${BASE}/login`);
  await vpage.getByLabel("Email").fill(email);
  await vpage.getByLabel("Password").fill("viewer-pass-123");
  await vpage.getByRole("button", { name: "Sign in" }).click();
  await vpage.waitForURL(/dashboard/);
  await vpage.goto(`${BASE}/printers/${ad5x.id}`);
  await vpage.getByText("Live (simulated)").first().waitFor();
  await vpage.getByText("Diagnostics").first().waitFor();
  assert((await vpage.getByRole("button", { name: /Test connection|Connection settings|Pause|Stop/ }).count()) === 0, "viewer sees controls");
  await vpage.goto(`${BASE}/production`);
  await vpage.getByText("Next to print").first().waitFor();
  await vpage.getByText("Dragon Egg").first().waitFor();
  assert((await vpage.getByRole("button", { name: "Send to printer" }).count()) === 0, "viewer sees send");
  assert((await vpage.getByRole("combobox", { name: "Assigned printer" }).count()) === 0, "viewer sees queue controls");
  await vpage.screenshot({ path: path.join(work, "viewer-mobile-production.png"), fullPage: true });
  await vctx.close();
  // Operator (staff): may not change connection settings (DB trigger), may confirm the plate.
  await rest(`organization_members?user_id=eq.${userId}&organization_id=eq.${orgId}`, { method: "PATCH", body: { role: "staff" } });
  const op = await rest(`printers?id=eq.${ad5x.id}`, { method: "PATCH", token: viewerToken, body: { serial_number: "SNEVIL" } });
  assert(op.status >= 400 && JSON.stringify(op.data).includes("owner or admin"), `operator changed serial ${op.status}`);
  const tele = await rest(`printers?id=eq.${ad5x.id}`, { method: "PATCH", token: viewerToken, body: { telemetry: { status: "printing" } } });
  assert(tele.status >= 400, "operator forged telemetry");
  const bed = await rest(`printers?id=eq.${ad5x.id}`, { method: "PATCH", token: viewerToken, prefer: "return=representation", body: { bed_clear: true } });
  assert(bed.status < 300 && bed.data.length === 1, "operator can confirm plate");
});

await step("agent API rejects forged, cross-agent and unknown requests", async () => {
  const cfg = JSON.parse(fs.readFileSync(mockConfig, "utf8"));
  const h = { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" };
  const bad = await fetch(`${BASE}/api/agent/heartbeat`, { method: "POST", headers: { ...h, authorization: "Bearer pfa_" + "x".repeat(43) }, body: "{}" });
  assert(bad.status === 401, "bad token");
  const junk = await fetch(`${BASE}/api/agent/heartbeat`, { method: "POST", headers: h, body: JSON.stringify({ protocol: 1, agent: {}, printers: [] }) });
  assert(junk.status === 400, `invalid body ${junk.status}`);
  const other = await fetch(`${BASE}/api/agent/commands/${crypto.randomUUID()}/file`, { headers: h });
  assert(other.status === 404, "unknown command file");
  const res = await fetch(`${BASE}/api/agent/commands/${crypto.randomUUID()}/result`, { method: "POST", headers: h, body: JSON.stringify({ status: "succeeded" }) });
  assert(res.status === 404, "unknown command result");
  // A report for a printer this agent doesn't manage is ignored.
  const before = await one(`printers?id=eq.${m5.id}&select=updated_at,telemetry`);
  await fetch(`${BASE}/api/agent/heartbeat`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ protocol: 1, agent: { version: "x", platform: "x", driver: "mock", libraryVersion: null }, printers: [{ printerId: m5.id, reachable: true, latencyMs: 1, errorCode: null, error: null, telemetry: null }] }),
  });
  const after = await one(`printers?id=eq.${m5.id}&select=updated_at,telemetry`);
  assert(after.updated_at === before.updated_at, "foreign printer untouched");
});

// ---------------------------------------------------------------- automatic queue (real FFI transport vs the test double)
if (FAKE_FNET) {
  const fnetConfig = path.join(work, "fnet-agent.json");
  await step("second agent: flashforge_lan driver through the FFI transport (library test double)", async () => {
    await page.goto(`${BASE}/printers/agents`);
    await page.getByRole("button", { name: "Add Printer Agent" }).click();
    await page.getByLabel("Name").fill("FFI test agent");
    await page.getByRole("button", { name: "Create pairing code" }).click();
    const code = (await page.locator(".tracking-widest").innerText()).trim();
    await page.getByRole("button", { name: "Done" }).click();
    agentCli(fnetConfig, "pair", "--server", BASE, "--code", code);
    agentCli(fnetConfig, "set-library", "--library", path.join(FAKE_FNET, "libFlashNetwork.so"), "--settings", path.join(FAKE_FNET, "FLASHNETWORK7.DAT"));
    agentCli(fnetConfig, "set-check-code", "SNFAKE0001", "12345678");
    const discovered = agentCli(fnetConfig, "discover");
    assert(discovered.includes("SNFAKE0001") && discovered.includes("127.0.0.1:8899") && discovered.includes("LAN mode"), discovered);
    startAgent("fnet", fnetConfig);
    const fnetAgent = await one(`printer_agents?organization_id=eq.${orgId}&name=eq.FFI%20test%20agent&select=id`);
    // Configure the 5M against it via the service (the UI path is covered above).
    await rest(`printers?id=eq.${m5.id}`, { method: "PATCH", body: { connection_mode: "agent_lan", agent_id: fnetAgent.id, serial_number: "SNFAKE0001", ip_address: "127.0.0.1", lan_port: 8899, connection_state: "waiting", status: "unknown" } });
    await waitFor(async () => (await one(`printers?id=eq.${m5.id}&select=connection_state,telemetry_source,firmware_version`))?.telemetry_source === "flashforge_lan", { what: "5M live via FFI" });
    const p = await one(`printers?id=eq.${m5.id}&select=*`);
    assert(p.firmware_version === "1.1.7" && p.telemetry.bedTemp === 59.8 && p.telemetry.remainingDiskSpaceGb === 6.25, "FFI telemetry decoded");
  });

  await step("automatic print queue: off by default, strict when on", async () => {
    const s = await one(`settings?organization_id=eq.${orgId}&select=auto_print_enabled`);
    assert(s.auto_print_enabled === false, "off by default");
    // Prepare: a proven 5M file, the 5M verified and clear, a paid job assigned to it.
    await rest(`print_files?id=eq.${fileId}`, { method: "PATCH", body: { compatible_models: ["AD5X", "Adventurer 5M"], colour: null } });
    await rest(`printers?id=eq.${m5.id}`, { method: "PATCH", body: { live_verified_at: new Date().toISOString(), bed_clear: true } });
    const orderD = await createOrder("D");
    const jobD = await jobFor(orderD);
    await rest(`production_jobs?id=eq.${jobD.id}`, { method: "PATCH", body: { printer_id: m5.id, colour: null } });
    await sleep(8000);
    assert((await one(`production_jobs?id=eq.${jobD.id}&select=status`)).status === "queued", "nothing starts while automation is off");
    await page.goto(`${BASE}/settings`);
    await page.locator("#auto-print").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Turn on" }).click();
    await toast("Production settings saved");
    await waitFor(async () => ["sending", "sent", "printing"].includes((await one(`production_jobs?id=eq.${jobD.id}&select=status`)).status), { what: "auto dispatched" });
    const d = await one(`production_jobs?id=eq.${jobD.id}&select=auto_dispatched`);
    assert(d.auto_dispatched, "flagged automatic");
    await waitFor(async () => (await one(`production_jobs?id=eq.${jobD.id}&select=status`)).status === "printed", { what: "FFI print completes", timeout: 90000 });
    const log = fs.readFileSync(path.join(FAKE_FNET, "calls.log"), "utf8");
    assert(log.includes(`dst=PF-JOB-${String(jobD.job_number).padStart(4, "0")}-dragon-egg-ad5x.gcode printNow=1`), "library received the file");
    // Plate not cleared → the next eligible job must wait.
    const orderE = await createOrder("E");
    const jobE = await jobFor(orderE);
    await rest(`production_jobs?id=eq.${jobE.id}`, { method: "PATCH", body: { printer_id: m5.id, colour: null } });
    await sleep(8000);
    assert((await one(`production_jobs?id=eq.${jobE.id}&select=status`)).status === "queued", "waits for plate confirmation");
    await page.locator("#auto-print").click();
    await toast("Production settings saved");
    assert(!(await one(`settings?organization_id=eq.${orgId}&select=auto_print_enabled`)).auto_print_enabled, "turned off");
  });
}

// ---------------------------------------------------------------- revocation & audit
await step("revoking an agent disconnects it immediately", async () => {
  await page.goto(`${BASE}/printers/agents`);
  const card = page.locator("div.rounded-lg", { hasText: "Workshop PC (simulated)" }).filter({ has: page.getByRole("button", { name: "Revoke" }) }).first();
  await card.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click();
  await toast("Agent revoked");
  const mockAgent = agents.filter((a) => a.name === "mock").at(-1);
  await waitFor(async () => mockAgent.exitCode === 2, { what: "agent exits with code 2", timeout: 20000 });
  assert(mockAgent.log.includes("Pair the agent again"), "agent explains");
  assert((await one(`printers?id=eq.${ad5x.id}&select=connection_state`)).connection_state === "not_configured", "printer not configured");
});

await step("audit log records printer activity", async () => {
  const events = (await rest(`audit_logs?organization_id=eq.${orgId}&select=event`)).data.map((e) => e.event);
  for (const e of ["printer_agent.created", "printer_agent.paired", "printer.connection_configured", "printer.verified", "print_file.created", "production_job.sent_to_printer", "printer.command_requested", "printer.command_completed", "production_job.completed", "production_job.reviewed", "printer_agent.revoked", "printer.disconnected", "printer.connected", "settings.updated"]) {
    assert(events.includes(e), `missing audit ${e}`);
  }
  await page.goto(`${BASE}/activity`);
  await page.getByText("sent to Flashforge AD5X").first().waitFor();
});

await step("printer statistics", async () => {
  await page.goto(`${BASE}/printers/stats?days=7`);
  const row = page.locator("tr", { hasText: "Flashforge AD5X" });
  await row.waitFor();
  const cells = await row.locator("td").allInnerTexts();
  assert(cells[3] === "1" && cells[4] === "1" && cells[5] === "50%", `stats ${cells.join("|")}`);
});

await step("no browser errors", async () => {
  assert(errors.length === 0, errors.join("\n"));
});

cleanup();
await browser.close();
console.log(`\nAll printer checks passed. Artifacts in ${work}`);
