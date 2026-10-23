import { beforeAll, describe, expect, it } from "vitest";

import { LIMITS, replan, runAgent, type Session } from "@/lib/agent/agent";
import { QlooClient } from "@/lib/qloo/client";
import { createMockFetch } from "@/lib/qloo/mock";
import { SHOWCASE_INPUT } from "@/lib/territory/scenarios";
import { budgetView, compareRows, formatLabel, nextSteps, readingOf, revisionStats, strategyItems, uncertainties } from "@/lib/territory/view-model";

const client = () => new QlooClient({ apiKey: "mock", source: "mock", fetchImpl: createMockFetch(), sleep: async () => {}, callBudget: LIMITS.maxQlooCalls * 2 });

describe("readingOf", () => {
  it("states the overlap ratio in plain English without grading the market", () => {
    const r = readingOf({ score: 1.11, scoreRange: [1.02, 1.2] });
    expect(r.overlap).toContain("11% more");
    expect(r.comparison).toBe("above");
    expect(JSON.stringify(r)).not.toMatch(/strong|weak|promising/i);
  });
  it("reports a range that straddles the baseline as mixed, not as a fit", () => {
    expect(readingOf({ score: 1.3, scoreRange: [0.9, 1.6] }).comparison).toBe("mixed");
    expect(readingOf({ score: 0.7, scoreRange: [0.6, 0.8] })).toMatchObject({ comparison: "below" });
    expect(readingOf({ score: 0.7, scoreRange: [0.6, 0.8] }).overlap).toContain("30% less");
  });
  it("uses a ratio for large lifts and says nothing when evidence is missing", () => {
    expect(readingOf({ score: 2.1, scoreRange: null }).overlap).toContain("2.1× as much");
    expect(readingOf({ score: null, scoreRange: null }).comparison).toBe("unknown");
  });
});

describe("formatLabel", () => {
  it("describes original-language markets as needing no localization", () => {
    expect(formatLabel("original", "English")).toContain("no localization");
    expect(formatLabel("dub", "German")).toBe("Dubbing in German");
  });
});

describe("derivations from a real mock-backed session", () => {
  let v1: Session;
  let v2: Session;
  beforeAll(async () => {
    v1 = await runAgent(SHOWCASE_INPUT, { client: client() });
    const dropped = v1.plan.markets.find((m) => m.mode !== "original") ?? v1.plan.markets[0];
    v2 = await replan(v1, { excludedMarkets: [dropped.code] }, { client: client() });
  });

  it("budget view reconciles available, planned and remaining", () => {
    const b = budgetView(v1);
    expect(b.planned + b.remaining).toBe(b.budget);
    expect(b.actions.reduce((s, a) => s + a.costUsd, 0)).toBe(b.planned);
  });

  it("every localized market is attributed to exactly one language action", () => {
    const b = budgetView(v1);
    const attributed = b.actions.flatMap((a) => a.markets);
    const localized = v1.plan.markets.filter((m) => m.mode !== "original").map((m) => m.name);
    expect([...attributed].sort()).toEqual([...localized].sort());
  });

  it("every excluded market in the plan is explained as a deferred option", () => {
    const b = budgetView(v2);
    expect(b.deferred.filter((d) => d.kind === "excluded")).toHaveLength(v2.plan.excluded.length);
    expect(b.deferred.some((d) => d.kind === "excluded" && d.detail === "You removed this market.")).toBe(true);
  });

  it("strategy items carry plain-English reasons and standing caveats are always listed", () => {
    const items = strategyItems(v1);
    expect(items).toHaveLength(v1.plan.markets.length);
    for (const i of items) expect(i.reason.length).toBeGreaterThan(20);
    expect(uncertainties(v1).some((u) => u.includes("relative taste overlap"))).toBe(true);
    expect(nextSteps(v1).length).toBeGreaterThanOrEqual(3);
  });

  it("an unresolved comp is called out as an uncertainty instead of silently shaping results", async () => {
    const s = await runAgent({ ...SHOWCASE_INPUT, comps: [...SHOWCASE_INPUT.comps.slice(0, 3), { name: "Not A Real Film 9999" }] }, { client: client() });
    expect(uncertainties(s).some((u) => u.includes('"Not A Real Film 9999" was not found in Qloo'))).toBe(true);
  });

  it("compare rows classify dropped, added and kept markets", () => {
    const rows = compareRows(v1.plan, v2.plan);
    const droppedCode = v2.input.constraints.excludedMarkets[0];
    expect(rows.find((r) => r.code === droppedCode)?.change).toBe("dropped");
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
    const stats = revisionStats(v2.revisions.at(-1)!);
    expect(stats.reused).toBeGreaterThan(0);
  });
});
