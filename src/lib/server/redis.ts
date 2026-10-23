import { isHosted } from "./hosting";

// Minimal Upstash Redis REST client (no dependency). The Vercel Marketplace integration exposes the
// credentials as KV_REST_API_URL / KV_REST_API_TOKEN.
const URL_ENV = () => process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const TOKEN_ENV = () => process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const TIMEOUT_MS = 2500;
const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9-]{2,40}$/;

let hasWarned = false;
const warnOnce = (why: string) => {
  if (hasWarned) return;
  hasWarned = true;
  console.warn(`[territory] Redis credentials present but ignored: ${why}. Using in-memory limits and caches instead.`);
};

/** Key prefix for an isolated test/CI/local store, or null for the shared production keyspace. */
export function redisNamespace(): string | null {
  const ns = process.env.TERRITORY_REDIS_NAMESPACE?.trim();
  return ns ? ns : null;
}

/**
 * Whether this process may touch Redis. Production quota and cache keys are shared, so credentials alone are
 * not enough: the process must be a hosted deployment (and not flagged TERRITORY_TEST=1), or it must name an
 * isolated TERRITORY_REDIS_NAMESPACE. Anything else — `next dev`, `next start` on a laptop, Playwright, CI,
 * vitest — silently falls back to in-memory behaviour instead of spending production counters.
 */
export function hasRedis(): boolean {
  if (!(URL_ENV() && TOKEN_ENV())) return false;
  const ns = process.env.TERRITORY_REDIS_NAMESPACE?.trim();
  if (ns) {
    if (NAMESPACE_PATTERN.test(ns)) return true;
    warnOnce("TERRITORY_REDIS_NAMESPACE must be 3-41 chars of a-z, 0-9 and '-'");
    return false;
  }
  if (isHosted() && process.env.TERRITORY_TEST !== "1") return true;
  warnOnce("not a hosted deployment and no TERRITORY_REDIS_NAMESPACE set, so production counters stay untouched");
  return false;
}

/** Which store this process uses for quota, limits and cache; safe to expose (no names, no values). */
export function storeMode(): "production" | "namespace" | "memory" {
  if (!hasRedis()) return "memory";
  return redisNamespace() ? "namespace" : "production";
}

/** Runs one single-key Redis command; returns null on any failure so callers degrade to local behaviour. */
export async function redis(command: Array<string | number>): Promise<unknown> {
  if (!hasRedis()) return null;
  const ns = redisNamespace();
  const namespaced = ns && command.length > 1 ? [command[0], `${ns}:${command[1]}`, ...command.slice(2)] : command;
  try {
    const res = await fetch(URL_ENV()!, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN_ENV()}`, "content-type": "application/json" },
      body: JSON.stringify(namespaced),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return ((await res.json()) as { result?: unknown }).result ?? null;
  } catch {
    return null; // shared store unavailable: fall back, never block the request on it
  }
}
