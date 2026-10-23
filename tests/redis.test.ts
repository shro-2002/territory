import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RedisCache } from "@/lib/qloo/factory";
import { checkRateLimitShared } from "@/lib/server/rate-limit";

/** In-memory fake of the Upstash REST endpoint. */
function fakeUpstash(store = new Map<string, string>(), isDown = false) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (isDown) throw new Error("ECONNREFUSED");
    const [cmd, key, arg] = JSON.parse(String(init?.body)) as [string, string, string | number];
    let result: unknown = null;
    if (cmd === "GET") result = store.get(key) ?? null;
    if (cmd === "SET") store.set(key, String(arg));
    if (cmd === "INCR" || cmd === "INCRBY") {
      result = Number(store.get(key) ?? 0) + (cmd === "INCR" ? 1 : Number(arg));
      store.set(key, String(result));
    }
    if (cmd === "EXPIRE") result = 1;
    return new Response(JSON.stringify({ result }), { status: 200 });
  });
}

describe("Upstash-backed shared state", () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  });
  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.unstubAllGlobals();
  });

  it("round-trips cached Qloo bodies", async () => {
    vi.stubGlobal("fetch", fakeUpstash());
    const cache = new RedisCache();
    await cache.set("k", { results: [1] });
    expect(await cache.get("k")).toEqual({ results: [1] });
    expect(await cache.get("missing")).toBeUndefined();
  });

  it("enforces a global per-IP limit through shared counters", async () => {
    vi.stubGlobal("fetch", fakeUpstash());
    const results = [];
    for (let i = 0; i < 13; i++) results.push((await checkRateLimitShared("192.0.2.50")).ok);
    expect(results.slice(0, 12).every(Boolean)).toBe(true);
    expect(results[12]).toBe(false);
  });

  it("falls back to local behaviour when Redis is unreachable", async () => {
    vi.stubGlobal("fetch", fakeUpstash(new Map(), true));
    expect(await new RedisCache().get("k")).toBeUndefined();
    expect((await checkRateLimitShared("192.0.2.51")).ok).toBe(true);
  });
});
