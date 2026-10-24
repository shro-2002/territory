import { describe, expect, it } from "vitest";

import { encodeParams, QlooClient } from "@/lib/qloo/client";
import { createMockFetch, MOCK_PREFIX } from "@/lib/qloo/mock";
import { QlooError } from "@/lib/qloo/types";

const noSleep = async () => {};
const mockClient = (opts: ConstructorParameters<typeof QlooClient>[0] = {}) =>
  new QlooClient({ apiKey: "test", source: "mock", fetchImpl: createMockFetch(), sleep: noSleep, ...opts });

describe("QlooClient", () => {
  it("refuses to build a live client without a key", () => {
    expect(() => new QlooClient({ source: "live" })).toThrowError(/QLOO_API_KEY/);
  });

  it("sends GET with X-Api-Key to the hackathon host and never puts the key in the URL", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetchImpl: typeof fetch = async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    };
    await new QlooClient({ apiKey: "secret-key", fetchImpl }).search("Minari");
    expect(seen!.url.startsWith("https://hackathon.api.qloo.com/search?")).toBe(true);
    expect(seen!.url).not.toContain("secret-key");
    expect(seen!.init?.method).toBe("GET");
    expect(new Headers(seen!.init?.headers).get("X-Api-Key")).toBe("secret-key");
  });

  it("produces a stable, sorted query string so cache keys are order independent", () => {
    expect(encodeParams({ b: 2, a: "x y", c: undefined })).toBe(encodeParams({ a: "x y", b: 2 }));
  });

  it("retries 429 with backoff and then succeeds", async () => {
    const client = mockClient({ fetchImpl: createMockFetch({ rateLimitFirst: 2 }) });
    const results = await client.search("Minari");
    expect(results[0].name).toBe(`${MOCK_PREFIX}Minari`);
    expect(client.calls.filter((c) => c.status === 429)).toHaveLength(2);
  });

  it("meters every retry as a network call against the budget", async () => {
    const client = mockClient({ fetchImpl: createMockFetch({ rateLimitFirst: 2 }) });
    await client.search("Minari");
    expect(client.liveCallCount).toBe(3);
  });

  it("never sends a retry past the reserved budget, and fails closed", async () => {
    let sent = 0;
    const inner = createMockFetch({ rateLimitFirst: 10 });
    const counting: typeof fetch = (u, i) => (sent++, inner(u, i));
    const client = mockClient({ fetchImpl: counting, callBudget: 2, maxRetries: 3 });
    await expect(client.search("Minari")).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(sent).toBe(2);
    expect(client.liveCallCount).toBe(2);
  });

  it("counts a timed-out attempt, which the server may still have received", async () => {
    const hanging: typeof fetch = (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const client = new QlooClient({ apiKey: "k", fetchImpl: hanging, timeoutMs: 20, maxRetries: 1, sleep: noSleep });
    await expect(client.search("x")).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(client.liveCallCount).toBe(2);
  });

  it("concurrent calls with failures never send more requests than the budget", async () => {
    let sent = 0;
    const flaky: typeof fetch = async () => (sent++, new Response("down", { status: 503 }));
    const client = new QlooClient({ apiKey: "k", fetchImpl: flaky, callBudget: 7, maxRetries: 3, concurrency: 4, sleep: noSleep });
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => client.search(`t${i}`)));
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(sent).toBe(7);
    expect(client.meteredCallCount).toBe(7);
  });

  it("attributes each concurrent response to its own call record", async () => {
    const inner = createMockFetch();
    // Later requests answer first, so "the last recorded call" is usually someone else's.
    let n = 0;
    const reordered: typeof fetch = async (u, i) => { const delay = 30 - 3 * n++; await new Promise((r) => setTimeout(r, Math.max(delay, 0))); return inner(u, i); };
    const client = mockClient({ fetchImpl: reordered, concurrency: 10 });
    const markets = ["France", "Germany", "Japan", "Mexico", "Brazil", "Spain"];
    const traced = await Promise.all(markets.map((m) => client.insightsTraced({ "filter.type": "urn:entity:movie", "signal.location.query": m, "signal.interests.entities": "x" })));
    traced.forEach(({ callId }, i) => expect(client.calls.find((c) => c.id === callId)?.params["signal.location.query"]).toBe(markets[i]));
  });

  it("gives up with RATE_LIMITED after max retries", async () => {
    const client = mockClient({ fetchImpl: createMockFetch({ rateLimitFirst: 10 }), maxRetries: 2 });
    await expect(client.search("Minari")).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });

  it("times out a hanging request", async () => {
    const hanging: typeof fetch = (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const client = new QlooClient({ apiKey: "k", fetchImpl: hanging, timeoutMs: 20, maxRetries: 0, sleep: noSleep });
    await expect(client.search("x")).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("does not retry non-retryable 4xx (unsupported location)", async () => {
    const client = mockClient();
    await expect(client.insights({ "filter.type": "urn:entity:movie", "signal.location.query": "Atlantis" })).rejects.toMatchObject({ code: "HTTP", status: 400 });
    expect(client.calls).toHaveLength(1);
  });

  it("rejects insights without filter.type before calling the network", async () => {
    const client = mockClient();
    await expect(client.insights({})).rejects.toBeInstanceOf(QlooError);
    expect(client.calls).toHaveLength(0);
  });

  it("serves repeat requests from cache and records the cache hit", async () => {
    const client = mockClient();
    await client.search("Minari");
    await client.search("Minari");
    expect(client.calls.map((c) => c.cacheHit)).toEqual([false, true]);
    expect(client.liveCallCount).toBe(1);
  });

  it("enforces the call budget", async () => {
    const client = mockClient({ callBudget: 1 });
    await client.search("Minari");
    await expect(client.search("Roma")).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("caps concurrency", async () => {
    let active = 0;
    let peak = 0;
    const slow: typeof fetch = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    };
    const client = new QlooClient({ apiKey: "k", fetchImpl: slow, concurrency: 2 });
    await Promise.all(["a", "b", "c", "d", "e"].map((q) => client.search(q)));
    expect(peak).toBe(2);
  });

  it("returns empty entities (not an error) for an unknown signal, as documented", async () => {
    const res = await mockClient().insights({ "filter.type": "urn:entity:movie", "filter.results.entities": "does-not-exist" });
    expect(res.results?.entities).toEqual([]);
  });

  it("stops starting network calls after the deadline but still serves cache hits", async () => {
    const client = mockClient();
    await client.search("Minari");
    const late = mockClient({ deadlineAt: Date.now() - 1 });
    await expect(late.search("Roma")).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(late.liveCallCount).toBe(0); // no request was made
  });

  it("with a zero budget (quota guard) serves only cached responses", async () => {
    const { MemoryCache } = await import("@/lib/qloo/client");
    const cache = new MemoryCache();
    await mockClient({ cache }).search("Minari");
    const guarded = mockClient({ cache, callBudget: 0 });
    expect((await guarded.search("Minari"))[0].name).toContain("Minari");
    await expect(guarded.search("Roma")).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });
});
