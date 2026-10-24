import { beforeAll, describe, expect, it } from "vitest";

import type { StreamMessage } from "@/app/api/agent/route";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { SHOWN_PER_GROUP } from "@/lib/territory/nearby-titles";
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
    // The browser gets no raw neighbourhood lists: context is null in the session and only present encrypted.
    expect(result.session.context).toBeNull();
    expect(result.context).toBeTruthy();
    // Only a few labelled catalogue examples per market, never the neighbourhood list itself.
    const exposed = new Set(JSON.stringify(result).match(/Related [0-9a-f]{6}/g) ?? []);
    expect(exposed.size).toBeLessThanOrEqual(Object.keys(result.session.research).length * SHOWN_PER_GROUP);
    expect(JSON.stringify(result.session.research)).not.toContain('"evidence"');
    for (const r of Object.values(result.session.research)) expect(r.claimCheck!.candidates.length).toBeLessThanOrEqual(SHOWN_PER_GROUP);

    const target = result.session.plan.markets[0].code;
    const re = await post({ action: "replan", session: result.session, token: result.token, context: result.context, patch: { excludedMarkets: [target] } }, "203.0.113.10");
    const revised = re.messages.at(-1);
    expect(revised?.type).toBe("result");
    if (revised?.type === "result") {
      expect(revised.session.plan.markets.map((m) => m.code)).not.toContain(target);
      // Claim-check evidence travels only inside the encrypted context and is restored from it for the revision.
      expect(JSON.stringify(revised.session.research)).not.toContain('"evidence"');
      expect(Object.values(revised.session.research).every((r) => r.evidenceGap || (r.claimCheck && r.claimCheck.status !== "insufficient"))).toBe(true);
    }
  });

  it("a budget-only patch keeps earlier exclusions (no schema defaults leak into the patch)", async () => {
    const run = (await post({ action: "run", input: SHOWCASE_INPUT }, "203.0.113.13")).messages.at(-1);
    if (run?.type !== "result") throw new Error("run failed");
    const target = run.session.plan.markets[0].code;
    const r2 = (await post({ action: "replan", session: run.session, token: run.token, context: run.context, patch: { excludedMarkets: [target] } }, "203.0.113.13")).messages.at(-1);
    if (r2?.type !== "result") throw new Error("replan failed");
    const r3 = (await post({ action: "replan", session: r2.session, token: r2.token, context: r2.context, patch: { budgetUsd: 30000 } }, "203.0.113.13")).messages.at(-1);
    if (r3?.type !== "result") throw new Error("replan failed");
    expect(r3.session.input.constraints.excludedMarkets).toEqual([target]);
    expect(r3.session.plan.markets.map((m) => m.code)).not.toContain(target);
  });

  it("rejects a replan whose session evidence was tampered with", async () => {
    const run = await post({ action: "run", input: SHOWCASE_INPUT }, "203.0.113.11");
    const result = run.messages.at(-1);
    if (result?.type !== "result") throw new Error("run failed");
    const forged = structuredClone(result.session);
    const first = Object.values(forged.research)[0];
    first.titlesFound = 99;
    const res = await post({ action: "replan", session: forged, token: result.token, context: result.context, patch: { budgetUsd: 1000 } }, "203.0.113.11");
    expect(res.status).toBe(400);
    const badContext = `${result.context!.slice(0, -4)}AAAA`;
    const res2 = await post({ action: "replan", session: result.session, token: result.token, context: badContext, patch: { budgetUsd: 1000 } }, "203.0.113.11");
    expect(res2.status).toBe(400);
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
