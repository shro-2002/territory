import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StreamMessage } from "@/app/api/agent/route";
import { createMockFetch } from "@/lib/qloo/mock";
import { QlooClient } from "@/lib/qloo/client";
import { hasRedis, redis, storeMode } from "@/lib/server/redis";
import { checkRateLimitShared, reserveQlooCalls } from "@/lib/server/rate-limit";
import { SHOWCASE_INPUT } from "@/lib/territory/scenarios";

const UPSTASH = "https://fake.upstash.test";
const DAY = `qloo-calls:${new Date().toISOString().slice(0, 10)}`;
const ENV_KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "TERRITORY_REDIS_NAMESPACE", "TERRITORY_HOSTED", "TERRITORY_TEST", "QLOO_API_KEY", "SESSION_SECRET"] as const;

/** Atomic in-memory Upstash. Records every command so tests can prove what was (not) touched. */
function fakeUpstash(store: Map<string, string>, log: string[][] = []) {
  let peak = 0;
  const handler = async (_url: unknown, init?: RequestInit) => {
    const [cmd, key, arg] = JSON.parse(String(init?.body)) as [string, string, string | number];
    log.push([cmd, key]);
    let result: unknown = null;
    if (cmd === "GET") result = store.get(key) ?? null;
    if (cmd === "SET") store.set(key, String(arg));
    if (cmd === "INCR" || cmd === "INCRBY" || cmd === "DECRBY") {
      result = Number(store.get(key) ?? 0) + (cmd === "INCR" ? 1 : cmd === "DECRBY" ? -Number(arg) : Number(arg));
      store.set(key, String(result));
      peak = Math.max(peak, Number(result));
    }
    if (cmd === "EXPIRE") result = 1;
    return new Response(JSON.stringify({ result }), { status: 200 });
  };
  return Object.assign(vi.fn(handler), { peak: () => peak });
}

/** Routes Upstash traffic to the fake and any other URL (the Qloo API) to the mock, so no test touches the network. */
function stubNetwork(store: Map<string, string>, log: string[][] = []) {
  const upstash = fakeUpstash(store, log);
  const qloo = createMockFetch();
  const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => (String(url).startsWith(UPSTASH) ? upstash(url, init) : qloo(url as string, init)));
  vi.stubGlobal("fetch", fetchStub);
  return { upstash, fetchStub };
}

function withEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
}

async function post(body: unknown, ip: string): Promise<{ source: string | null; messages: StreamMessage[] }> {
  const { POST } = await import("@/app/api/agent/route");
  const res = await POST(new Request("http://test/api/agent", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify(body) }));
  const text = await res.text();
  return { source: res.headers.get("x-territory-source"), messages: text.trim().split("\n").map((l) => JSON.parse(l) as StreamMessage) };
}

const credentials = { UPSTASH_REDIS_REST_URL: UPSTASH, UPSTASH_REDIS_REST_TOKEN: "test-token" };

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => {
  withEnv({});
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("production Redis is unreachable without explicit isolation", () => {
  it("ignores credentials on a local, CI or test process", async () => {
    withEnv(credentials);
    const store = new Map<string, string>([[DAY, "5000"]]);
    const log: string[][] = [];
    stubNetwork(store, log);
    expect(hasRedis()).toBe(false);
    expect(await redis(["INCRBY", DAY, 220])).toBeNull();
    expect((await reserveQlooCalls(220)).granted).toBe(220); // local in-memory pool, not the shared counter
    expect(log).toEqual([]);
    expect(store.get(DAY)).toBe("5000");
  });

  it("blocks the production keyspace on a hosted-looking test run flagged TERRITORY_TEST=1", () => {
    withEnv({ ...credentials, TERRITORY_HOSTED: "1", TERRITORY_TEST: "1" });
    expect(hasRedis()).toBe(false);
  });

  it("allows a hosted deployment, and a process with a valid isolated namespace", () => {
    withEnv({ ...credentials, TERRITORY_HOSTED: "1" });
    expect(hasRedis()).toBe(true);
    withEnv({ ...credentials, TERRITORY_REDIS_NAMESPACE: "ci-run-42" });
    expect(hasRedis()).toBe(true);
  });

  it("reports which store it uses without exposing names or values", () => {
    withEnv(credentials);
    expect(storeMode()).toBe("memory");
    withEnv({ ...credentials, TERRITORY_HOSTED: "1" });
    expect(storeMode()).toBe("production");
    withEnv({ ...credentials, TERRITORY_REDIS_NAMESPACE: "ci-run-42" });
    expect(storeMode()).toBe("namespace");
  });

  it("rejects a malformed namespace instead of falling back to production keys", () => {
    withEnv({ ...credentials, TERRITORY_HOSTED: "1", TERRITORY_REDIS_NAMESPACE: "Prod/../x" });
    expect(hasRedis()).toBe(false);
  });

  it("writes only inside its namespace and leaves unprefixed production keys untouched", async () => {
    withEnv({ ...credentials, TERRITORY_REDIS_NAMESPACE: "ci-run-42" });
    const store = new Map<string, string>([[DAY, "5000"], ["qloo:cached", "{}"]]);
    stubNetwork(store);
    const r = await reserveQlooCalls(220);
    await r.release(10);
    await checkRateLimitShared("198.51.100.1");
    expect(store.get(DAY)).toBe("5000");
    expect(store.get(`ci-run-42:${DAY}`)).toBe("10");
    expect([...store.keys()].filter((k) => !k.startsWith("ci-run-42:"))).toEqual([DAY, "qloo:cached"]);
  });
});

describe("mock runs never consume quota", () => {
  it("reserving for the mock source touches neither Redis nor the local pool", async () => {
    withEnv({ ...credentials, TERRITORY_HOSTED: "1" }); // Redis would be allowed here
    const log: string[][] = [];
    stubNetwork(new Map(), log);
    const r = await reserveQlooCalls(220, "mock");
    await r.release(220);
    await checkRateLimitShared("198.51.100.2", "mock");
    expect(log).toEqual([]);
  });

  it("a mock client reports zero live calls however many it makes", async () => {
    const client = new QlooClient({ apiKey: "mock", source: "mock", fetchImpl: createMockFetch(), sleep: async () => {}, callBudget: 500 });
    await client.get("/search", { query: "Minari" });
    await client.get("/search", { query: "Aftersun" });
    expect(client.calls.length).toBe(2);
    expect(client.meteredCallCount).toBe(0);
  });

  it("a full showcase run and a replan on a Redis-enabled mock server leave the shared counter unchanged", async () => {
    withEnv({ ...credentials, TERRITORY_HOSTED: "1" }); // no QLOO_API_KEY: mock
    const store = new Map<string, string>([[DAY, "4321"]]);
    const log: string[][] = [];
    stubNetwork(store, log);
    const run = await post({ action: "run", input: SHOWCASE_INPUT }, "198.51.100.3");
    expect(run.source).toBe("mock");
    const result = run.messages.at(-1);
    if (result?.type !== "result") throw new Error("run failed");
    expect(result.calls.length).toBeGreaterThan(50);
    await post({ action: "replan", session: result.session, token: result.token, context: result.context, patch: { excludedMarkets: [result.session.plan.markets[0].code] } }, "198.51.100.3");
    expect(log).toEqual([]);
    expect(store.get(DAY)).toBe("4321");
  });

  it("is not blocked when the production counter is exhausted", async () => {
    withEnv({ ...credentials, TERRITORY_HOSTED: "1" });
    stubNetwork(new Map([[DAY, "5000"]]));
    const run = await post({ action: "run", input: SHOWCASE_INPUT }, "198.51.100.4");
    expect(run.messages.at(-1)?.type).toBe("result");
  });
});

describe("live runs are metered exactly and capped", () => {
  it("charges the shared counter for precisely the network calls the run made", async () => {
    withEnv({ ...credentials, TERRITORY_HOSTED: "1", QLOO_API_KEY: "test-key", SESSION_SECRET: "unit-test-secret-unit-test-secret-0123" });
    const store = new Map<string, string>();
    stubNetwork(store);
    const tag = randomUUID().slice(0, 8); // unique comps: guaranteed cache misses, so every call is real
    const input = { ...SHOWCASE_INPUT, targetMarkets: ["US", "FR"], comps: [{ name: `Past Lives ${tag}` }, { name: `Minari ${tag}` }, { name: `Aftersun ${tag}` }] };
    const run = await post({ action: "run", input }, "198.51.100.5");
    expect(run.source).toBe("live");
    const result = run.messages.at(-1);
    if (result?.type !== "result") throw new Error(`run failed: ${JSON.stringify(run.messages.at(-1))}`);
    const network = result.calls.filter((c) => !c.cacheHit).length;
    expect(network).toBeGreaterThan(0);
    expect(result.calls.every((c) => c.source === "live")).toBe(true);
    expect(Number(store.get(DAY))).toBe(network);
  });

  it("stays fail-closed: an exhausted counter grants zero live calls and the run reports it", async () => {
    withEnv({ ...credentials, TERRITORY_HOSTED: "1", QLOO_API_KEY: "test-key", SESSION_SECRET: "unit-test-secret-unit-test-secret-0123" });
    const store = new Map([[DAY, "5000"]]);
    const { fetchStub } = stubNetwork(store);
    const input = { ...SHOWCASE_INPUT, comps: [{ name: `Lunar ${randomUUID().slice(0, 8)}` }, { name: "Minari" }, { name: "Aftersun" }] };
    const run = await post({ action: "run", input }, "198.51.100.6");
    expect(run.messages.some((m) => m.type === "notice" && /paused/.test(m.message))).toBe(true);
    const qlooCalls = fetchStub.mock.calls.filter(([u]) => !String(u).startsWith(UPSTASH));
    expect(qlooCalls.length).toBe(0);
    expect(store.get(DAY)).toBe("5000");
  });

  it("never lets concurrent reservations push the counter past the daily cap", async () => {
    withEnv({ ...credentials, TERRITORY_HOSTED: "1" });
    const store = new Map<string, string>();
    const upstash = fakeUpstash(store);
    vi.stubGlobal("fetch", upstash);
    const grants = await Promise.all(Array.from({ length: 60 }, () => reserveQlooCalls(220)));
    const granted = grants.reduce((s, g) => s + g.granted, 0);
    expect(granted).toBeLessThanOrEqual(5000);
    expect(grants.some((g) => g.granted === 0)).toBe(true);
    await Promise.all(grants.map((g) => g.release(Math.floor(g.granted / 2))));
    expect(Number(store.get(DAY))).toBe(grants.reduce((s, g) => s + Math.floor(g.granted / 2), 0));
    // The counter transiently exceeds the cap while over-asking requests are trimmed back; it must stay bounded by the asks.
    expect(upstash.peak()).toBeLessThanOrEqual(5000 + 220 * 60);
  });
});
