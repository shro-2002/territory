import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Sessions round-trip through the browser between runs and replans. The seal lets the server
// reject a session whose evidence was edited client-side, without keeping server state.
function secret(): string {
  const explicit = process.env.SESSION_SECRET?.trim();
  if (explicit) return explicit;
  const key = process.env.QLOO_API_KEY?.trim();
  if (key) return createHash("sha256").update(`territory-seal:${key}`).digest("hex");
  return "territory-mock-only-secret";
}

export function seal(payload: unknown): string {
  return createHmac("sha256", secret()).update(JSON.stringify(payload)).digest("base64url");
}

export function verifySeal(payload: unknown, token: string): boolean {
  const expected = Buffer.from(seal(payload));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
