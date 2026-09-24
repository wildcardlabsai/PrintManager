import { createHash, randomBytes } from "node:crypto";

/** RFC 7636 PKCE helpers. */
export function base64Url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 43–128 characters from the unreserved set (RFC 7636 §4.1). */
export function createCodeVerifier(bytes = 48) {
  return base64Url(randomBytes(bytes));
}

export function codeChallengeS256(verifier: string) {
  return base64Url(createHash("sha256").update(verifier).digest());
}

/** Opaque, unguessable OAuth state value. Only its hash is stored. */
export function createState() {
  return base64Url(randomBytes(32));
}

export const OAUTH_STATE_TTL_MINUTES = 15;
