import { hasRedis, redis } from "./redis";

// With Upstash configured, limits are global (shared counters). Without it they fall back to
// per-instance memory: best-effort guards only, stated in docs/ARCHITECTURE.md.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_RUNS_PER_WINDOW = 12;
const MAX_QLOO_CALLS_PER_INSTANCE_PER_DAY = 3000;
const MAX_QLOO_CALLS_PER_DAY_GLOBAL = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

const hits = new Map<string, number[]>();
let dayStart = Date.now();
let qlooCallsToday = 0;

export function checkRateLimit(ip: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_RUNS_PER_WINDOW) {
    return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - recent[0])) / 1000) };
  }
  hits.set(ip, [...recent, now]);
  if (hits.size > 5000) hits.clear(); // bound memory
  return { ok: true };
}

export function qlooBudgetRemaining(now = Date.now()): number {
  if (now - dayStart > DAY_MS) {
    dayStart = now;
    qlooCallsToday = 0;
  }
  return Math.max(0, MAX_QLOO_CALLS_PER_INSTANCE_PER_DAY - qlooCallsToday);
}

export function recordQlooCalls(n: number) {
  qlooCallsToday += n;
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

export async function qlooBudgetRemainingShared(): Promise<number> {
  if (!hasRedis()) return qlooBudgetRemaining();
  const used = Number(await redis(["GET", dayKey()]));
  return Math.max(0, MAX_QLOO_CALLS_PER_DAY_GLOBAL - (Number.isFinite(used) ? used : 0));
}

export async function recordQlooCallsShared(n: number) {
  recordQlooCalls(n);
  if (!hasRedis() || n === 0) return;
  await redis(["INCRBY", dayKey(), n]);
  await redis(["EXPIRE", dayKey(), 2 * 24 * 60 * 60]);
}
