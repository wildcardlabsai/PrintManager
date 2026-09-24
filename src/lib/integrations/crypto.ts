import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for integration secrets (OAuth tokens, API keys)
 * before they are written to the database. The key comes from
 * INTEGRATION_ENCRYPTION_KEY (32 bytes, base64) and never leaves the server.
 *
 * Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>"
 */
function key(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured.");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ct] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised encrypted secret format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hasEncryptionKey() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
