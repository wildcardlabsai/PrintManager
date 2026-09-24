# Integration tests

These run the real app against a local Supabase-compatible stack and a
**test-only stub** of the Etsy, eBay and Royal Mail Click & Drop endpoints
(`stub-apis.mjs`). No live marketplace or carrier is contacted and no real
credentials are used.

The stub is only reachable when the app runs with `PRINTFLOW_TEST_API_OVERRIDES=1`
and the `*_TEST_*` base URLs set (see `src/lib/integrations/config.ts`).

## Run

1. Start Supabase locally (`npx supabase start`) and apply `supabase/migrations`.
2. Create `.env.local` with the local Supabase URL/keys, a
   `SUPABASE_SERVICE_ROLE_KEY`, `INTEGRATION_ENCRYPTION_KEY`, `CRON_SECRET`,
   test Etsy/eBay values, `ETSY_WEBHOOK_SECRET=whsec_<base64>` and:

   ```
   PRINTFLOW_TEST_API_OVERRIDES=1
   ETSY_TEST_AUTHORIZE_URL=http://127.0.0.1:4010/etsy-www/oauth/connect
   ETSY_TEST_TOKEN_URL=http://127.0.0.1:4010/etsy-api/v3/public/oauth/token
   ETSY_TEST_API_BASE=http://127.0.0.1:4010/etsy-api
   EBAY_ENVIRONMENT=sandbox
   EBAY_TEST_AUTHORIZE_URL=http://127.0.0.1:4010/ebay-auth/oauth2/authorize
   EBAY_TEST_TOKEN_URL=http://127.0.0.1:4010/ebay-api/identity/v1/oauth2/token
   EBAY_TEST_API_BASE=http://127.0.0.1:4010/ebay-api
   EBAY_TEST_IDENTITY_BASE=http://127.0.0.1:4010/ebay-apiz
   ROYAL_MAIL_TEST_API_BASE=http://127.0.0.1:4010/royalmail/api/v1
   ```

   Use `ETSY_CLIENT_ID=test-etsy-keystring`, `ETSY_CLIENT_SECRET=test-etsy-shared-secret`,
   `EBAY_CLIENT_ID=test-ebay-client`, `EBAY_CLIENT_SECRET=test-ebay-secret` (or pass the
   same values to the stub via env).
3. `npm run build && npm start`
4. In another shell (same env): `node tests/integration/stub-apis.mjs`
5. `node tests/integration/marketplace-e2e.mjs` and `node tests/integration/rls-integrations.mjs`

Restart the stub between runs (it keeps its data in memory).
