import { beforeAll, describe, expect, it } from "vitest";

import type { StreamMessage } from "@/app/api/agent/route";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { SHOWCASE_INPUT } from "@/lib/territory/scenarios";

// Tests must never hit the live API: without a key the factory uses the labelled mock.
beforeAll(() => {
  delete process.env.QLOO_API_KEY;
});

async function post(body: unknown, ip = "203.0.113.1"): Promise<{ status: number; messages: StreamMessage[] }> {
  const { POST } = await import("@/app/api/agent/route");
  const res = await POST(new Request("http://test/api/agent", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify(body) }));
  if (!res.headers.get("content-type")?.includes("ndjson")) return { status: res.status, messages: [] };
  const text = await res.text();
  return { status: res.status, messages: text.trim().split("\n").map((l) => JSON.parse(l) as StreamMessage) };
}

describe("POST /api/agent", () => {
  it("streams trace events then a sealed session, and replans from it", async () => {
    const run = await post({ action: "run", input: SHOWCASE_INPUT }, "203.0.113.10");
    expect(run.messages.some((m) => m.type === "trace")).toBe(true);
    const result = run.messages.at(-1);
    expect(result?.type).toBe("result");
    if (result?.type !== "result") return;
    expect(result.calls.every((c) => c.source === "mock")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/x-api-key/i);

    const target = result.session.plan.markets[0].code;
    const re = await post({ action: "replan", session: result.session, token: result.token, patch: { excludedMarkets: [target] } }, "203.0.113.10");
    const revised = re.messages.at(-1);
    expect(revised?.type).toBe("result");
    if (revised?.type === "result") expect(revised.session.plan.markets.map((m) => m.code)).not.toContain(target);
  });

  it("rejects a replan whose session evidence was tampered with", async () => {
    const run = await post({ action: "run", input: SHOWCASE_INPUT }, "203.0.113.11");
    const result = run.messages.at(-1);
    if (result?.type !== "result") throw new Error("run failed");
    const forged = structuredClone(result.session);
    const first = Object.values(forged.research)[0];
    first.score = 99;
    const res = await post({ action: "replan", session: forged, token: result.token, patch: { budgetUsd: 1000 } }, "203.0.113.11");
    expect(res.status).toBe(400);
  });

  it("rejects malformed bodies and invalid briefs without crashing", async () => {
    expect((await post({ action: "nope" }, "203.0.113.12")).status).toBe(400);
    const bad = await post({ action: "run", input: { ...SHOWCASE_INPUT, comps: [] } }, "203.0.113.12");
    expect(bad.messages.at(-1)).toMatchObject({ type: "error", code: "INVALID_INPUT" });
  });
});

describe("rate limit", () => {
  it("blocks an address after the window quota and reports retry-after", () => {
    const ip = "198.51.100.7";
    const now = 1_000_000;
    for (let i = 0; i < 12; i++) expect(checkRateLimit(ip, now + i).ok).toBe(true);
    const blocked = checkRateLimit(ip, now + 20);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(checkRateLimit(ip, now + 11 * 60 * 1000).ok).toBe(true);
  });
});
