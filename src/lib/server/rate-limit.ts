import { isHosted } from "./hosting";
import { hasRedis, redis } from "./redis";

// With Upstash configured, limits are global (shared counters). Without it they fall back to
// per-instance memory: best-effort guards only, stated in docs/ARCHITECTURE.md.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_RUNS_PER_WINDOW = 12;
const MAX_QLOO_CALLS_PER_INSTANCE_PER_DAY = 3000;
const MAX_QLOO_CALLS_PER_DAY_GLOBAL = 5000;

const hits = new Map<string, number[]>();

export function checkRateLimit(ip: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_RUNS_PER_WINDOW) {
    return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - recent[0])) / 1000) };
  }
  hits.set(ip, [...recent, now]);
  if (hits.size > 5000) hits.clear(); // bound memory
  return { ok: true };
}



export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Global variants: use Redis counters when available, otherwise the in-memory versions above. */
export async function checkRateLimitShared(ip: string): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  if (!hasRedis()) return checkRateLimit(ip);
  const bucket = Math.floor(Date.now() / WINDOW_MS);
  const key = `rl:${bucket}:${ip}`;
  const count = Number(await redis(["INCR", key]));
  if (!Number.isFinite(count) || count === 0) return checkRateLimit(ip); // Redis failed
  if (count === 1) await redis(["EXPIRE", key, Math.ceil(WINDOW_MS / 1000)]);
  return count > MAX_RUNS_PER_WINDOW ? { ok: false, retryAfterSec: Math.ceil(((bucket + 1) * WINDOW_MS - Date.now()) / 1000) } : { ok: true };
}

const dayKey = () => `qloo-calls:${new Date().toISOString().slice(0, 10)}`;
let localReserved = 0;
let localDay = new Date().toISOString().slice(0, 10);

export interface QlooReservation {
  /** Network calls this request may make. 0 = cache-only. */
  granted: number;
  reason?: string;
  /** Return unused calls to the pool. */
  release(used: number): Promise<void>;
}

/**
 * Reserve live Qloo calls before a run so concurrent requests cannot overshoot the daily cap.
 * Fails closed: on a hosted deployment without a reachable shared store, no live calls are granted
 * (cached evidence still works). Locally, an in-memory pool is used.
 */
export async function reserveQlooCalls(wanted: number): Promise<QlooReservation> {
  if (!hasRedis()) {
    if (isHosted()) return { granted: 0, reason: "shared quota store not configured", release: async () => {} };
    const today = new Date().toISOString().slice(0, 10);
    if (today !== localDay) {
      localDay = today;
      localReserved = 0;
    }
    const granted = Math.max(0, Math.min(wanted, MAX_QLOO_CALLS_PER_INSTANCE_PER_DAY - localReserved));
    localReserved += granted;
    return { granted, ...(granted ? {} : { reason: "daily Qloo quota reached" }), release: async (used) => void (localReserved -= Math.max(0, granted - used)) };
  }
  const key = dayKey();
  const total = Number(await redis(["INCRBY", key, wanted]));
  if (!Number.isFinite(total) || total <= 0) return { granted: 0, reason: "shared quota store unreachable", release: async () => {} };
  await redis(["EXPIRE", key, 2 * 24 * 60 * 60]);
  const granted = Math.max(0, Math.min(wanted, MAX_QLOO_CALLS_PER_DAY_GLOBAL - (total - wanted)));
  if (granted < wanted) await redis(["DECRBY", key, wanted - granted]);
  return {
    granted,
    ...(granted ? {} : { reason: "daily Qloo quota reached" }),
    release: async (used) => {
      const unused = Math.max(0, granted - used);
      if (unused) await redis(["DECRBY", key, unused]);
    },
  };
}
