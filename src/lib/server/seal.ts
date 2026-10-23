import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { hasLiveKey } from "../qloo/factory";
import { isHosted } from "./hosting";

export class SealConfigError extends Error {}

// Sessions round-trip through the browser between runs and replans.
// - seal()/verifySeal(): HMAC-SHA256 integrity over the public session (signed, NOT encrypted: the browser can read it).
// - encrypt()/decrypt(): AES-256-GCM for the server-only research context, which the browser must not read.
function secret(): string {
  const explicit = process.env.SESSION_SECRET?.trim();
  if (explicit && explicit.length >= 32) return explicit;
  if (isHosted() && hasLiveKey()) throw new SealConfigError("SESSION_SECRET (32+ chars) must be set on hosted deployments");
  return "territory-local-development-secret-not-for-production";
}

const key = (purpose: string) => createHash("sha256").update(`${purpose}:${secret()}`).digest();

export function seal(payload: unknown): string {
  return createHmac("sha256", key("hmac")).update(JSON.stringify(payload)).digest("base64url");
}

export function verifySeal(payload: unknown, token: string): boolean {
  const expected = Buffer.from(seal(payload));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function encrypt(payload: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("enc"), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Returns null if the blob was modified or sealed by another deployment. */
export function decrypt<T>(blob: string): T | null {
  try {
    const raw = Buffer.from(blob, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key("enc"), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}
