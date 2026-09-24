import { createHash, createPublicKey, createVerify } from "node:crypto";

/**
 * eBay Marketplace Account Deletion notifications (mandatory for production
 * apps that store eBay user data).
 *
 * Endpoint validation: eBay sends GET ?challenge_code=… and expects
 *   { challengeResponse: hex(SHA-256(challengeCode + verificationToken + endpointUrl)) }
 * Notifications: POST with an `x-ebay-signature` header — base64 JSON
 *   { alg: "ECDSA", kid, signature, digest: "SHA1" } — verified against the
 * public key fetched from the Notification API (getPublicKey).
 */
export function ebayChallengeResponse(challengeCode: string, verificationToken: string, endpointUrl: string) {
  return createHash("sha256").update(challengeCode).update(verificationToken).update(endpointUrl).digest("hex");
}

export interface EbaySignatureHeader {
  alg: string;
  kid: string;
  signature: string;
  digest: string;
}

export function parseEbaySignatureHeader(header: string | null): EbaySignatureHeader | null {
  if (!header) return null;
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    if (typeof parsed?.kid !== "string" || typeof parsed?.signature !== "string") return null;
    return { alg: String(parsed.alg ?? "ECDSA"), kid: parsed.kid, signature: parsed.signature, digest: String(parsed.digest ?? "SHA1") };
  } catch {
    return null;
  }
}

/** eBay returns the key as a single line with PEM armour; rebuild a standard PEM. */
export function toPem(key: string) {
  const body = key
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

export function verifyEbaySignature(rawBody: string, sig: EbaySignatureHeader, publicKey: string) {
  const algo = sig.digest.toUpperCase() === "SHA256" ? "SHA256" : "SHA1";
  const verifier = createVerify(algo);
  verifier.update(rawBody);
  verifier.end();
  return verifier.verify(createPublicKey(toPem(publicKey)), Buffer.from(sig.signature, "base64"));
}

export interface EbayDeletionPayload {
  metadata?: { topic?: string };
  notification?: { notificationId?: string; eventDate?: string; data?: { username?: string; userId?: string; eiasToken?: string } };
}
