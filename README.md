# PrintFlow

Order, production and fulfilment management for small 3D-printing businesses — one place for Etsy, eBay, Facebook Marketplace, website and manual orders, the print queue, printers, filament, shipping and profit.

**Status: Phase 3** — the internal system (Phase 1), Etsy/eBay order sync and Royal Mail shipping (Phase 2), and Flashforge AD5X / Adventurer 5M printer integration through a local **PrintFlow Printer Agent** (Phase 3).

> Printer control has been tested against a simulated printer and a test double of Flashforge's network library, **not yet against physical printers**. Each printer must pass PrintFlow's live test checklist (with someone at the printer) before production jobs can be sent to it.

## Stack

Next.js 16 (App Router, Server Components, Server Actions) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui-style components on Radix · Supabase (Postgres, Auth, Storage, RLS) · Zod · Recharts · Vitest. Vercel-ready.

## Getting started

1. **Create a Supabase project** (or run `npx supabase start` locally with Docker).
2. **Apply the database migrations** in `supabase/migrations/` — either
   `npx supabase link --project-ref <ref> && npx supabase db push`, or paste each file (in order) into the SQL editor.
3. **Configure auth URLs** in Supabase → Authentication → URL Configuration:
   - Site URL: your app URL (e.g. `https://printflow.example.com`)
   - Redirect URLs: `https://printflow.example.com/auth/confirm` (and `http://localhost:3000/auth/confirm` for development)
4. **Environment:** `cp .env.example .env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL`.
5. `npm install && npm run dev`, open http://localhost:3000, sign up, name your business. Your Flashforge AD5X and Adventurer 5M are created automatically; tick **Load demo data** to explore with sample records (all marked *Demo*, removable from Settings).

### Connecting marketplaces and shipping (Phase 2)

Set the server-only variables in `.env.example` (`SUPABASE_SERVICE_ROLE_KEY`, `INTEGRATION_ENCRYPTION_KEY`, `CRON_SECRET`, and the Etsy/eBay app credentials), then use **Settings → Integrations**.

| Integration | You configure | PrintFlow does |
| --- | --- | --- |
| **Etsy** (Open API v3) | Etsy app keystring + shared secret; callback URL `…/api/integrations/etsy/callback`; webhook endpoint `…/api/webhooks/etsy` + its `whsec_` secret | OAuth 2.0 + PKCE, token refresh (rotating refresh tokens), receipt import, `order.*` webhooks (signature-verified, idempotent), tracking via `createReceiptShipment` |
| **eBay** (Sell Fulfillment API) | App ID / Cert ID, RuName whose accept/decline URLs point to `…/api/integrations/ebay/callback`, account-deletion endpoint + token | OAuth 2.0, token refresh, order import, `createShippingFulfillment` with tracking, account-deletion notifications (verified, data anonymised) |
| **Royal Mail Click & Drop** | Each business pastes its Click & Drop API key in Settings | Creates Click & Drop orders, returns label PDFs for OBA accounts, pulls tracking numbers |
| **Facebook / Meta** | — | Not supported: no public Marketplace order API. Facebook sales use the manual order form. |

### Connecting printers (Phase 3)

Flashforge printers are reached over their **LAN mode** with Flashforge's own network library (shipped with Orca-Flashforge). Because a cloud app can't reach your local network, a small **PrintFlow Printer Agent** (`agent/`) runs on a computer next to the printers, pairs with PrintFlow using a one-time code, and polls PrintFlow over HTTPS. See [`agent/README.md`](agent/README.md).

```
Browser ──server action──▶ PrintFlow (auth → role check → validation → queue a whitelisted command)
Printer Agent ──HTTPS heartbeat──▶ PrintFlow   (telemetry in, config + commands out)
Printer Agent ──FlashNetwork LAN (IP, serial, check code)──▶ AD5X / Adventurer 5M
```

- **Live status** — state, progress, layers, temperatures, loaded filament / IFS slots, firmware, errors; anything the printer doesn't report shows "Not available". Printers go offline only after repeated failures *and* a configurable time without status.
- **Sending prints** — upload sliced files (`.gcode`, `.gx`, sliced `.3mf`; never STL — PrintFlow doesn't slice) under **Print files**, then **Send to printer** from a job. A confirmation dialog shows printer, product, file and estimate, runs pre-flight checks (connected, idle, plate confirmed clear, verified printer, compatible file, IFS slot mapping) and requires every warning to be acknowledged.
- **Controls** — pause, resume and stop (with confirmation) act only on the print PrintFlow started. Job states: Awaiting print → Assigned → Ready → Sending → Queued on printer → Printing / Paused → Completed / Failed / Cancelled, driven by telemetry; completion moves the order to **Printed**.
- **Failures** — stopped/failed/missed prints are flagged **Needs attention** with Retry, Reassign and Mark failed. Nothing is retried automatically.
- **Automatic print queue** — **off by default** (Settings → Production). When on, it only starts a job a person assigned to a verified, idle, live printer whose plate was confirmed clear, with a proven single-colour file and matching loaded filament, for a paid order, on the first attempt.
- **Filament** — the printer doesn't report actual usage, so finished prints are reviewed: actual grams vs estimate (variance) are recorded and deducted from a spool.
- **Roles** — Viewer (monitor), Operator (send/pause/resume/stop), Admin (configure, pair, remove, settings), Owner (also team roles). Enforced in server actions and by RLS.
- **Diagnostics, events, statistics, notifications** — per-printer diagnostics (connection, IP, firmware, agent, latency, last seen, capabilities, recent errors, Test connection / Refresh), an event log, utilisation/success-rate stats by date range, and in-app notifications.

Orders arrive through **Sync now**, Etsy webhooks and the scheduled sync (`vercel.json` runs `/api/cron/integrations` daily; Vercel Pro can run it more often). Items whose SKU doesn't match a product are held under **Needs mapping** — no order or production job is created until they are mapped.

### Deploying to Vercel

Import the repo, set the three `NEXT_PUBLIC_*` variables, deploy. Add the production `/auth/confirm` URL to Supabase's redirect list.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (domain logic, validation, timezones, OAuth/PKCE, adapters, webhooks, retries) |
| `npm run test:integration` | End-to-end marketplace/shipping flow against the local stack + stub APIs (see `tests/integration/README.md`) |
| `npm run test:printers` | End-to-end printer flow with the Printer Agent in mock mode (see `tests/integration/README.md`) |
| `npm run agent:build` | Build the Printer Agent (`agent/`) |
| `npm run check` | All three |

## Architecture

```
src/
  app/                  Routes. (auth)/ = login, signup, password reset; (app)/ = the signed-in app
    auth/confirm/       Handles email links (confirmation, recovery)
    api/health/         Health check
  actions/              Server Actions — thin: validate input, call a service, revalidate
  lib/
    domain/             Pure business rules: costing, order pricing, order workflow,
                        production state machine, SKU matching, dates. Unit tested.
    validation/         Zod schemas shared by forms and actions
    services/           Database access + business logic (server-only), one module per area
    integrations/       Provider adapters, isolated per provider:
                          etsy/ ebay/ (OAuth, client, normalisation, webhooks)
                          shipping/ (ShippingIntegration + Royal Mail Click & Drop)
                          meta/ (documented "not supported" status), printers/ (adapter contract, re-exported from agent/)
                        plus shared http (timeouts, retries, backoff), crypto, PKCE
    services/integrations/  credentials (encrypted, locked refresh), sync engine,
                        shared import pipeline, mappings, fulfilment, labels, webhooks
    supabase/           Browser, server and proxy Supabase clients
  components/           ui/ primitives, layout/ shell, and feature components
    printers/           Printer domain rules: status mapping, telemetry → job reconciliation,
                        dispatch checks, suggestions, permissions, checklist, stats, slicer metadata
    services/printers/  Agents (pairing, tokens), heartbeat/telemetry, commands, dispatch
  proxy.ts              Session refresh + route protection (Next 16 "proxy", formerly middleware)
agent/                  PrintFlow Printer Agent (Node/TS): protocol, PrinterIntegration contract,
                        Flashforge AD5X / Adventurer 5M adapters, FlashNetwork FFI transport, mock printer
supabase/migrations/    Schema, RLS policies, SQL functions, storage buckets
tests/                  Vitest unit tests (+ tests/integration end-to-end scripts)
```

Key decisions:

- **Marketplace-agnostic orders.** Orders carry `sales_channel` + `external_order_id`; a unique index on `(organization_id, sales_channel, external_order_id)` prevents duplicate imports.
- **Atomic writes where it matters.** `create_order()` inserts the order, items, one production job per line, the shipment record, status history and audit entries in one transaction. `record_filament_usage()` locks the spool row while deducting. `next_order_number()` allocates numbers under a row lock.
- **Calculations live in TypeScript** (`lib/domain`), so the same costing/pricing code powers the live form previews and the server-side saved values.
- **Filament is only deducted when usage is recorded** (on job completion, failed-print waste, or manually) — never when a job is created.
- **Printers are manual until connected.** Unconnected printers keep hand-set status; connected printers take status only from telemetry (a database trigger stops anyone overwriting it).
- **Multi-tenant ready.** Every row belongs to an `organization`; RLS allows access only to members (`organization_members`). Adding team members later needs no schema change.

### Marketplace flow

```
Etsy receipt / eBay order ──adapter──▶ NormalizedOrder
  → processNormalizedOrder()   (lib/services/integrations/import.ts)
      duplicate check (sales_channel + external_order_id, DB-unique)
        existing → update (cancellation, marketplace shipment, address)
        new      → paid & unshipped only → product mapping (listing/SKU)
                   → MAPPING REQUIRED (held)  or  customer match → createOrder()
  → production jobs → queue → pack → label (Click & Drop) → tracking
  → Mark shipped (+ explicit "send to Etsy/eBay") → marketplace confirms → Synced
```

Secrets: application credentials live in environment variables; per-seller tokens and API keys are AES-256-GCM encrypted and stored in `integration_credentials`, a table with RLS and no policies, readable only by the server's service-role client.

## Database

Phase 3 adds `printer_agents`, `printer_commands`, `printer_events`, `print_files` (+ private `print-files` bucket), `notifications`, `notification_reads`, printer connection/telemetry columns, job dispatch/telemetry columns, production settings and the `viewer` role.

Phase 2 adds `integration_connections`, `integration_credentials`, `oauth_states`, `integration_sync_logs`, `external_orders`, `product_mappings`, `marketplace_fulfillments`, `webhook_events`, plus marketplace/package columns on `orders`, `order_items` and `shipments`.

`organizations`, `organization_members`, `profiles`, `settings`, `customers`, `products`, `product_variants`, `product_images`, `product_compatible_printers`, `printers`, `filaments`, `filament_usage`, `orders`, `order_items`, `production_jobs`, `shipments`, `status_history`, `audit_logs` — UUID keys, foreign keys, indexes, check constraints, `updated_at` triggers and RLS on every table. `status_history` and `audit_logs` are append-only for users.
