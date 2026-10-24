import { beforeAll, describe, expect, it } from "vitest";

import { LIMITS, replan, runAgent, type Session } from "@/lib/agent/agent";
import { QlooClient } from "@/lib/qloo/client";
import { createMockFetch } from "@/lib/qloo/mock";
import { SHOWCASE_INPUT } from "@/lib/territory/scenarios";
import { budgetView, compareRows, evidenceLine, evidenceSummary, formatLabel, nextSteps, revisionStats, strategyItems, uncertainties } from "@/lib/territory/view-model";

const client = () => new QlooClient({ apiKey: "mock", source: "mock", fetchImpl: createMockFetch(), sleep: async () => {}, callBudget: LIMITS.maxQlooCalls * 2 });

describe("evidenceLine", () => {
  it("states catalogue counts and claim-check candidates without grading the market", () => {
    const line = evidenceLine({ gap: null, titlesFound: 100, catalogue: 67, claim: "verify", candidates: 4 });
    expect(line).toContain("67 of 100");
    expect(line).toContain("4 survive every tested control and need human verification before being cited");
    expect(evidenceLine({ gap: null, titlesFound: 100, catalogue: 67, claim: "none", candidates: 0 })).toContain("not proof that none exists");
    expect(evidenceLine({ gap: null, titlesFound: 100, catalogue: 67, claim: "insufficient", candidates: 0 })).toContain("no local comparable is claimed");
    expect(line).not.toMatch(/strong|weak|promising|fit|demand|×/i);
  });
  it("reports a research gap as a gap", () => {
    expect(evidenceLine(evidenceSummary(undefined))).toMatch(/^Research gap/);
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
    for (const i of items) expect(i.reason).toMatch(/on your candidate list|Suggested by Territory/);
    expect(uncertainties(v1).some((u) => u.includes("Markets were chosen by your priority order"))).toBe(true);
    // The first next steps are the claim checker's research action for each leading planned market.
    expect(nextSteps(v1).slice(0, Math.min(3, items.length))).toEqual(v1.plan.markets.slice(0, 3).map((m) => `${m.name}: ${v1.research[m.code].claimCheck!.action}`));
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
