# PrintFlow

Order, production and fulfilment management for small 3D-printing businesses — one place for Etsy, eBay, Facebook Marketplace, website and manual orders, the print queue, printers, filament, shipping and profit.

**Status: Phase 1** — the complete internal system. Marketplace/shipping integrations (Phase 2) and live printer integration (Phase 3) are architected but not implemented; the UI says so wherever they would appear.

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

### Deploying to Vercel

Import the repo, set the three `NEXT_PUBLIC_*` variables, deploy. Add the production `/auth/confirm` URL to Supabase's redirect list.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (domain logic, validation, timezones) |
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
    integrations/       Phase 2/3 contracts: MarketplaceIntegration, ShippingIntegration,
                        PrinterIntegration, and a registry of planned integrations
    supabase/           Browser, server and proxy Supabase clients
  components/           ui/ primitives, layout/ shell, and feature components
  proxy.ts              Session refresh + route protection (Next 16 "proxy", formerly middleware)
supabase/migrations/    Schema, RLS policies, SQL functions, storage bucket
tests/                  Vitest unit tests
```

Key decisions:

- **Marketplace-agnostic orders.** Orders carry `sales_channel` + `external_order_id`; a unique index on `(organization_id, sales_channel, external_order_id)` prevents duplicate imports.
- **Atomic writes where it matters.** `create_order()` inserts the order, items, one production job per line, the shipment record, status history and audit entries in one transaction. `record_filament_usage()` locks the spool row while deducting. `next_order_number()` allocates numbers under a row lock.
- **Calculations live in TypeScript** (`lib/domain`), so the same costing/pricing code powers the live form previews and the server-side saved values.
- **Filament is only deducted when usage is recorded** (on job completion, failed-print waste, or manually) — never when a job is created.
- **Printer status is manual in Phase 1.** Starting/completing a job records the implied status; the UI labels it "Manual status — live printer integration coming in Phase 3".
- **Multi-tenant ready.** Every row belongs to an `organization`; RLS allows access only to members (`organization_members`). Adding team members later needs no schema change.

### Future integration flow (Phase 2)

```
Marketplace adapter.fetchOrders()  →  NormalizedOrder
  → importNormalizedOrder()  (lib/services/order-import.ts, already implemented)
      duplicate check → SKU matching → customer match/create → createOrder()
  → production jobs → production queue
```

Adapters implement `MarketplaceIntegration` / `ShippingIntegration` / `PrinterIntegration`, run server-side only, and read credentials from environment variables (see `.env.example`).

## Database

`organizations`, `organization_members`, `profiles`, `settings`, `customers`, `products`, `product_variants`, `product_images`, `product_compatible_printers`, `printers`, `filaments`, `filament_usage`, `orders`, `order_items`, `production_jobs`, `shipments`, `status_history`, `audit_logs` — UUID keys, foreign keys, indexes, check constraints, `updated_at` triggers and RLS on every table. `status_history` and `audit_logs` are append-only for users.
