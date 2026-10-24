import { describe, expect, it } from "vitest";

import { buildPlan, CandidateMarket, Constraints, ConstraintsSchema, LanguageCost, validatePlan } from "@/lib/territory/planner";

const costs: Record<string, LanguageCost> = {
  Spanish: { subtitleUsd: 3000, dubUsd: 25000 },
  French: { subtitleUsd: 3000, dubUsd: 30000 },
  German: { subtitleUsd: 3000, dubUsd: 30000 },
  Japanese: { subtitleUsd: 4000, dubUsd: 35000 },
};
// Priority = the filmmaker's selection order. BR has no Portuguese cost entered.
const candidates: CandidateMarket[] = [
  { code: "US", name: "United States", language: "English", priority: 0 },
  { code: "MX", name: "Mexico", language: "Spanish", priority: 1 },
  { code: "ES", name: "Spain", language: "Spanish", priority: 2 },
  { code: "FR", name: "France", language: "French", priority: 3 },
  { code: "DE", name: "Germany", language: "German", priority: 4 },
  { code: "JP", name: "Japan", language: "Japanese", priority: 5 },
  { code: "BR", name: "Brazil", language: "Portuguese", priority: 6 },
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

  it("never selects a market whose language has no cost assumption", () => {
    expect(plan({ budgetUsd: 1e6, maxMarkets: 8 }).markets.map((m) => m.code)).not.toContain("BR");
    expect(plan().excluded).toContainEqual({ code: "BR", reason: "no cost assumption for Portuguese" });
  });

  it("follows the filmmaker's priority order: the first markets that fit are kept", () => {
    expect(plan({ budgetUsd: 1e6, maxMarkets: 4 }).markets.map((m) => m.code).sort()).toEqual(["ES", "FR", "MX", "US"]);
  });

  it("never gives up a higher-priority market to fit more lower-priority ones", () => {
    // Japanese subtitles (4000) fit only if JP is first; covering it beats three cheaper later markets.
    const jpFirst = candidates.map((c) => (c.code === "JP" ? { ...c, priority: -1 } : c));
    const p = buildPlan({ candidates: jpFirst, constraints: base({ budgetUsd: 7000, maxMarkets: 4 }), costs, originalLanguage: "English" });
    expect(p.markets.map((m) => m.code)).toContain("JP");
  });

  it("prefers dubbing over subtitles only when the same markets are covered and the budget allows", () => {
    const p = plan({ budgetUsd: 1e6, maxMarkets: 3 });
    expect(p.languages.every((l) => l.mode === "dub")).toBe(true);
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
    const rich = plan({ budgetUsd: 60000 });
    const cut = plan({ budgetUsd: 36000 });
    const dubs = (p: typeof rich) => p.languages.filter((l) => l.mode === "dub").length;
    expect(dubs(cut)).toBeLessThan(dubs(rich));
    expect(cut.totalCostUsd).toBeLessThanOrEqual(36000);
    expect(cut.markets.map((m) => m.code)).toEqual(rich.markets.map((m) => m.code));
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
