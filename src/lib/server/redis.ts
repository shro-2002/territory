// Minimal Upstash Redis REST client (no dependency). Enabled only when credentials are set; the
// Vercel Marketplace integration exposes them as KV_REST_API_URL / KV_REST_API_TOKEN.
const URL_ENV = () => process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const TOKEN_ENV = () => process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const TIMEOUT_MS = 2500;

export function hasRedis(): boolean {
  return Boolean(URL_ENV() && TOKEN_ENV());
}

/** Runs one Redis command; returns null on any failure so callers degrade to local behaviour. */
export async function redis(command: Array<string | number>): Promise<unknown> {
  if (!hasRedis()) return null;
  try {
    const res = await fetch(URL_ENV()!, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN_ENV()}`, "content-type": "application/json" },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return ((await res.json()) as { result?: unknown }).result ?? null;
  } catch {
    return null; // shared store unavailable: fall back, never block the request on it
  }
}
