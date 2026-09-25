import "server-only";
import crypto from "node:crypto";

/**
 * Agent credentials. Pairing codes are short-lived and single use; agent
 * tokens are long random secrets. Only SHA-256 hashes are stored.
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export const PAIRING_CODE_TTL_MINUTES = 15;
export const TOKEN_ROTATE_AFTER_DAYS = 7;

export function hashSecret(secret: string) {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

/** e.g. "K7QX-9MNP-4TRW" (60 bits) */
export function generatePairingCode() {
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export function normalisePairingCode(code: string) {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 12 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}` : null;
}

export function generateAgentToken() {
  return `pfa_${crypto.randomBytes(32).toString("base64url")}`;
}

export function bearerToken(header: string | null) {
  const m = header?.match(/^Bearer\s+(pfa_[A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : null;
}
