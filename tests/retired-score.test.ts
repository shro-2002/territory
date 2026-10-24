import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LIMITS, replan, runAgent } from "@/lib/agent/agent";
import { QlooClient } from "@/lib/qloo/client";
import { createMockFetch } from "@/lib/qloo/mock";
import { SHOWCASE_INPUT } from "@/lib/territory/scenarios";

// The taste-portability score was invalidated by the catalogue audit (docs/EVALUATION.md).
// These tests fail if it, or any other Qloo-derived number, can steer which markets are planned.
const client = (ignoreLocation = false) => new QlooClient({ apiKey: "mock", source: "mock", fetchImpl: createMockFetch({ ignoreLocation }), sleep: async () => {}, callBudget: LIMITS.maxQlooCalls * 2 });
const codes = (s: { plan: { markets: Array<{ code: string; mode: string }> } }) => s.plan.markets.map((m) => `${m.code}:${m.mode}`);
const OTHER_COMPS = [{ name: "Parasite" }, { name: "Oldboy" }, { name: "Burning" }, { name: "City of God" }];

describe("retired score cannot influence market selection", () => {
  it("identical constraints give identical plans whatever Qloo returns", async () => {
    const drama = await runAgent(SHOWCASE_INPUT, { client: client() });
    const other = await runAgent({ ...SHOWCASE_INPUT, comps: OTHER_COMPS }, { client: client() });
    const noLocation = await runAgent(SHOWCASE_INPUT, { client: client(true) });
    // Precondition: Qloo evidence genuinely differs between the runs.
    expect(JSON.stringify(Object.values(other.research).map((r) => r.nearby))).not.toEqual(JSON.stringify(Object.values(drama.research).map((r) => r.nearby)));
    expect(codes(other)).toEqual(codes(drama));
    expect(codes(noLocation)).toEqual(codes(drama));
  });

  it("War Room revisions are identical whatever Qloo returns", async () => {
    const drama = await runAgent(SHOWCASE_INPUT, { client: client() });
    const other = await runAgent({ ...SHOWCASE_INPUT, comps: OTHER_COMPS }, { client: client() });
    const lost = drama.plan.markets.find((m) => m.mode !== "original")!.code;
    const [d2, t2] = await Promise.all([replan(drama, { excludedMarkets: [lost] }, { client: client() }), replan(other, { excludedMarkets: [lost] }, { client: client() })]);
    expect(codes(t2)).toEqual(codes(d2));
    const [d3, t3] = await Promise.all([replan(d2, { budgetUsd: 48000 }, { client: client() }), replan(t2, { budgetUsd: 48000 }, { client: client() })]);
    expect(codes(t3)).toEqual(codes(d3));
    for (const ch of [...d2.revisions, ...d3.revisions].flatMap((r) => r.changes)) expect(ch.text).not.toMatch(/taste|lift|×|outscored|stronger/i);
  });

  it("plans and revisions ignore every Qloo-derived field in the research", async () => {
    const s1 = await runAgent(SHOWCASE_INPUT, { client: client() });
    const scrambled = structuredClone(s1);
    Object.values(scrambled.research).forEach((r, i) => {
      r.titlesFound = (i * 37) % 101;
      r.nearby = { ...r.nearby, genericCount: (i * 13) % 100, localOrigin: [`Local ${i}`], counts: { localOrigin: i, international: 9 - i, originUnknown: i * 2 } };
      if (i % 2) r.evidenceGap = "scrambled";
    });
    for (const patch of [{}, { budgetUsd: 48000 }, { excludedMarkets: [s1.plan.markets.find((m) => m.mode !== "original")!.code] }, { maxMarkets: 3 }]) {
      const [a, b] = await Promise.all([replan(s1, patch, { client: client() }), replan(scrambled, patch, { client: client() })]);
      expect(codes(b)).toEqual(codes(a));
    }
  });

  it("sessions carry no score fields for the UI or export to show", async () => {
    const s = await runAgent(SHOWCASE_INPUT, { client: client() });
    expect(JSON.stringify(s)).not.toMatch(/"(score|scoreRange|portability|baselinePortability|confidence|totalValue)"/);
  });

  it("only the evaluation scripts can reach the retired signal", () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? files(path.join(dir, f)) : [path.join(dir, f)]));
    const allowed = new Set([path.join("src", "lib", "agent", "research.ts"), path.join("src", "lib", "territory", "market-signal.ts")]);
    const offenders = files("src").filter((f) => !allowed.has(f) && /retiredPortabilitySignal|computeMarketSignal/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
