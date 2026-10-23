// ponytail: per-instance in-memory limits; a serverless deploy runs several instances, so these are
// best-effort guards against casual abuse, not a global quota. Upgrade path: Upstash/Vercel KV counter.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_RUNS_PER_WINDOW = 12;
const MAX_QLOO_CALLS_PER_INSTANCE_PER_DAY = 3000;
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
