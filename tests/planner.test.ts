import { describe, expect, it } from "vitest";

import { buildPlan, CandidateMarket, Constraints, ConstraintsSchema, LanguageCost, validatePlan } from "@/lib/territory/planner";

const costs: Record<string, LanguageCost> = {
  Spanish: { subtitleUsd: 3000, dubUsd: 25000 },
  French: { subtitleUsd: 3000, dubUsd: 30000 },
  German: { subtitleUsd: 3000, dubUsd: 30000 },
  Japanese: { subtitleUsd: 4000, dubUsd: 35000 },
};
const candidates: CandidateMarket[] = [
  { code: "US", name: "United States", language: "English", score: 0.55 },
  { code: "MX", name: "Mexico", language: "Spanish", score: 0.8 },
  { code: "ES", name: "Spain", language: "Spanish", score: 0.7 },
  { code: "FR", name: "France", language: "French", score: 0.75 },
  { code: "DE", name: "Germany", language: "German", score: 0.9 },
  { code: "JP", name: "Japan", language: "Japanese", score: 0.6 },
  { code: "BR", name: "Brazil", language: "Portuguese", score: null },
];
const base = (c: Partial<Constraints> = {}) => ConstraintsSchema.parse({ budgetUsd: 60000, maxMarkets: 4, ...c });
const plan = (c: Partial<Constraints> = {}) => buildPlan({ candidates, constraints: base(c), costs, originalLanguage: "English" });

describe("buildPlan", () => {
  it("never exceeds budget or market cap and passes the independent check", () => {
    for (const budgetUsd of [0, 5000, 20000, 60000, 200000]) {
      for (const maxMarkets of [1, 2, 4, 6]) {
        const c = base({ budgetUsd, maxMarkets });
        const p = buildPlan({ candidates, constraints: c, costs, originalLanguage: "English" });
        expect(validatePlan(p, c, costs, "English")).toEqual([]);
      }
    }
  });

  it("never selects a market with insufficient evidence", () => {
    expect(plan({ budgetUsd: 1e6, maxMarkets: 8 }).markets.map((m) => m.code)).not.toContain("BR");
    expect(plan().excluded).toContainEqual({ code: "BR", reason: "insufficient Qloo evidence" });
  });

  it("shares one language cost across markets that speak it", () => {
    const p = plan({ budgetUsd: 3000, maxMarkets: 2, excludedMarkets: ["US"] });
    const spanishMarkets = p.markets.filter((m) => m.language === "Spanish");
    expect(spanishMarkets.length).toBe(2);
    expect(p.languages.filter((l) => l.language === "Spanish")).toHaveLength(1);
  });

  it("honours exclusions and subtitle-first", () => {
    const c = base({ excludedMarkets: ["DE"], excludedLanguages: ["French"], subtitleFirst: true, budgetUsd: 1e6 });
    const p = buildPlan({ candidates, constraints: c, costs, originalLanguage: "English" });
    expect(p.markets.map((m) => m.code)).not.toContain("DE");
    expect(p.markets.map((m) => m.code)).not.toContain("FR");
    expect(p.markets.every((m) => m.mode !== "dub")).toBe(true);
  });

  it("downgrades dub to subtitles when budget is cut by 40%", () => {
    const rich = plan({ budgetUsd: 100000 });
    const cut = plan({ budgetUsd: 60000 });
    const dubs = (p: typeof rich) => p.languages.filter((l) => l.mode === "dub").length;
    expect(dubs(cut)).toBeLessThan(dubs(rich));
    expect(cut.totalCostUsd).toBeLessThanOrEqual(60000);
  });

  it("is deterministic", () => {
    expect(plan()).toEqual(plan());
  });

  it("returns an empty plan, not an error, when nothing is affordable", () => {
    const only = buildPlan({ candidates: candidates.filter((c) => c.language !== "English"), constraints: base({ budgetUsd: 100 }), costs, originalLanguage: "English" });
    expect(only.markets).toEqual([]);
  });

  it("validatePlan catches a tampered plan", () => {
    const p = plan();
    const tampered = { ...p, totalCostUsd: p.totalCostUsd - 1 };
    expect(validatePlan(tampered, base(), costs, "English")).not.toEqual([]);
  });
});
