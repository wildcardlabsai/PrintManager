/**
 * Provider endpoints and application credentials, read from server-side
 * environment variables only.
 *
 * Base-URL overrides exist solely so automated tests can point adapters at a
 * local stub server; they are ignored unless PRINTFLOW_TEST_API_OVERRIDES=1.
 */
const override = (name: string, fallback: string) =>
  process.env.PRINTFLOW_TEST_API_OVERRIDES === "1" && process.env[name] ? process.env[name]! : fallback;

export function etsyConfig() {
  return {
    clientId: process.env.ETSY_CLIENT_ID ?? "",
    clientSecret: process.env.ETSY_CLIENT_SECRET ?? "",
    redirectUri: process.env.ETSY_REDIRECT_URI ?? "",
    webhookSecret: process.env.ETSY_WEBHOOK_SECRET ?? "",
    authorizeUrl: override("ETSY_TEST_AUTHORIZE_URL", "https://www.etsy.com/oauth/connect"),
    tokenUrl: override("ETSY_TEST_TOKEN_URL", "https://api.etsy.com/v3/public/oauth/token"),
    apiBase: override("ETSY_TEST_API_BASE", "https://api.etsy.com"),
    scopes: ["transactions_r", "transactions_w", "shops_r", "email_r"],
  };
}

export function etsyMissingConfig() {
  const c = etsyConfig();
  return [
    !c.clientId && "ETSY_CLIENT_ID",
    !c.clientSecret && "ETSY_CLIENT_SECRET",
    !c.redirectUri && "ETSY_REDIRECT_URI",
  ].filter(Boolean) as string[];
}

export function ebayConfig() {
  const sandbox = (process.env.EBAY_ENVIRONMENT ?? "production") === "sandbox";
  return {
    environment: sandbox ? ("sandbox" as const) : ("production" as const),
    clientId: process.env.EBAY_CLIENT_ID ?? "",
    clientSecret: process.env.EBAY_CLIENT_SECRET ?? "",
    /** eBay's redirect_uri is the RuName ("eBay Redirect URL name"), not a URL. */
    ruName: process.env.EBAY_REDIRECT_URI ?? "",
    deletionVerificationToken: process.env.EBAY_DELETION_VERIFICATION_TOKEN ?? "",
    deletionEndpoint: process.env.EBAY_DELETION_ENDPOINT_URL ?? "",
    authorizeUrl: override("EBAY_TEST_AUTHORIZE_URL", sandbox ? "https://auth.sandbox.ebay.com/oauth2/authorize" : "https://auth.ebay.com/oauth2/authorize"),
    tokenUrl: override("EBAY_TEST_TOKEN_URL", sandbox ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token" : "https://api.ebay.com/identity/v1/oauth2/token"),
    apiBase: override("EBAY_TEST_API_BASE", sandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com"),
    identityBase: override("EBAY_TEST_IDENTITY_BASE", sandbox ? "https://apiz.sandbox.ebay.com" : "https://apiz.ebay.com"),
    scopes: [
      "https://api.ebay.com/oauth/api_scope",
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
      "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
    ],
  };
}

export function ebayMissingConfig() {
  const c = ebayConfig();
  return [!c.clientId && "EBAY_CLIENT_ID", !c.clientSecret && "EBAY_CLIENT_SECRET", !c.ruName && "EBAY_REDIRECT_URI"].filter(
    Boolean,
  ) as string[];
}

export function royalMailConfig() {
  return { apiBase: override("ROYAL_MAIL_TEST_API_BASE", "https://api.parcel.royalmail.com/api/v1") };
}

/** Secrets every integration needs on the server. */
export function platformMissingConfig() {
  return [
    !process.env.SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
    !process.env.INTEGRATION_ENCRYPTION_KEY && "INTEGRATION_ENCRYPTION_KEY",
  ].filter(Boolean) as string[];
}
