import { describe, expect, it } from "vitest";

import { replan, runAgent } from "@/lib/agent/agent";
import { assertClaimsGrounded } from "@/lib/agent/claims";
import { pickCandidate } from "@/lib/agent/resolve";
import { QlooClient } from "@/lib/qloo/client";
import { createMockFetch, MOCK_PREFIX } from "@/lib/qloo/mock";

const client = () => new QlooClient({ apiKey: "mock", source: "mock", fetchImpl: createMockFetch(), sleep: async () => {} });

const input = {
  title: "Paper Lanterns (working title)",
  synopsis: "Two estranged sisters reunite in Seoul.",
  genre: "drama",
  originalLanguage: "English",
  comps: [{ name: "Past Lives", year: 2023 }, { name: "Minari" }, { name: "Aftersun" }, { name: "Not A Real Film 9999" }],
  targetMarkets: ["US", "GB", "FR", "DE", "ES", "MX", "KR", "JP"],
  costs: { French: { subtitleUsd: 3000, dubUsd: 30000 }, German: { subtitleUsd: 3000, dubUsd: 30000 }, Spanish: { subtitleUsd: 3000, dubUsd: 25000 }, Korean: { subtitleUsd: 4000, dubUsd: 35000 }, Japanese: { subtitleUsd: 4000, dubUsd: 35000 }, Italian: { subtitleUsd: 3000, dubUsd: 28000 }, Portuguese: { subtitleUsd: 3000, dubUsd: 25000 } },
  constraints: { budgetUsd: 70000, maxMarkets: 5 },
};

describe("pickCandidate (disambiguation)", () => {
  const e = (name: string, subtype: string, year: number, popularity: number) => ({ entity_id: `${name}-${subtype}-${year}`, name, subtype, popularity, properties: { release_year: year } });
  it("uses year to choose between a film and its remake", () => {
    const r = pickCandidate({ name: "Oldboy", year: 2013 }, [e("Oldboy", "urn:entity:movie", 2003, 0.9), e("Oldboy", "urn:entity:movie", 2013, 0.5)]);
    expect(r.status).toBe("resolved");
    expect(r.year).toBe(2013);
  });
  it("flags ambiguity when two films share a title and no year is given", () => {
    const r = pickCandidate({ name: "Oldboy" }, [e("Oldboy", "urn:entity:movie", 2003, 0.9), e("Oldboy", "urn:entity:movie", 2013, 0.5)]);
    expect(r.status).toBe("ambiguous");
    expect(r.year).toBe(2003);
  });
  it("prefers the film over a same-named series", () => {
    const r = pickCandidate({ name: "Fargo" }, [e("Fargo", "urn:entity:tv_show", 2014, 0.95), e("Fargo", "urn:entity:movie", 1996, 0.8)]);
    expect(r).toMatchObject({ status: "resolved", type: "urn:entity:movie" });
  });
  it("reports unresolved for an empty search", () => {
    expect(pickCandidate({ name: "Zzz" }, []).status).toBe("unresolved");
  });
});

describe("runAgent (mock backend, end to end)", () => {
  it("resolves comps, researches markets, builds a valid plan and grounds every Qloo claim", async () => {
    const s = await runAgent(input, { client: client() });
    expect(s.comps.find((c) => c.input.name === "Not A Real Film 9999")?.status).toBe("unresolved");
    expect(Object.keys(s.research).sort()).toEqual([...input.targetMarkets].sort());
    expect(s.violations).toEqual([]);
    expect(s.plan.markets.length).toBeGreaterThan(0);
    expect(s.plan.totalCostUsd).toBeLessThanOrEqual(70000);
    expect(assertClaimsGrounded(s.claims)).toEqual([]);
    expect(s.claims.filter((c) => c.provenance === "qloo").every((c) => c.source === "mock")).toBe(true);
    expect(s.comps.filter((c) => c.name).every((c) => c.name!.startsWith(MOCK_PREFIX))).toBe(true);
    expect(s.trace.map((e) => e.state)).toEqual(["INPUT_VALIDATION", "ENTITY_RESOLUTION", "RESEARCH_PLANNING", "QLOO_INVESTIGATION", "EVIDENCE_VERIFICATION", "STRATEGY_CONSTRUCTION", "CONSTRAINT_VALIDATION", "FINAL_REPORT"]);
  });

  it("is reproducible for identical inputs", async () => {
    const a = await runAgent(input, { client: client() });
    const b = await runAgent(input, { client: client() });
    expect(a.plan).toEqual(b.plan);
  });

  it("rejects invalid input with a clear message", async () => {
    await expect(runAgent({ ...input, comps: [{ name: "x" }] }, { client: client() })).rejects.toThrow(/comps/);
    await expect(runAgent({ ...input, targetMarkets: ["ZZ"] }, { client: client() })).rejects.toThrow(/Unsupported market/);
  });

  it("fails gracefully when no comp resolves (cold start with unknown comps)", async () => {
    const s = await runAgent({ ...input, comps: [{ name: "Nope 1" }, { name: "Nope 2" }, { name: "Nope 3" }] }, { client: client() });
    expect(s.status).toBe("failed");
    expect(s.research).toEqual({});
  });

  it("returns a failed session, not a crash, when Qloo insights is down", async () => {
    const broken: typeof fetch = async (url, init) => (String(url).includes("/search") ? createMockFetch()(url, init) : new Response("boom", { status: 500 }));
    const s = await runAgent(input, { client: new QlooClient({ apiKey: "k", source: "mock", fetchImpl: broken, sleep: async () => {}, maxRetries: 1 }) });
    expect(s.plan.markets).toEqual([]);
    expect(s.status).toBe("failed");
    expect(s.trace.at(-1)?.message).toMatch(/unavailable/);
  });
});

describe("replan (Distribution War Room)", () => {
  it("removing a planned market invalidates only that decision, reuses research and investigates reserves", async () => {
    const c = client();
    const s1 = await runAgent(input, { client: c });
    const target = s1.plan.markets.find((m) => m.language !== "English")!;
    const callsBefore = c.liveCallCount;
    const s2 = await replan(s1, { excludedMarkets: [target.code] }, { client: c });

    const rev = s2.revisions.at(-1)!;
    expect(rev.invalidated.some((x) => x.startsWith(target.code))).toBe(true);
    expect(rev.reusedMarkets.sort()).toEqual(Object.keys(s1.research).sort());
    expect(rev.newlyResearched.length).toBeGreaterThan(0);
    // Each new market costs comps + every usable reference baseline, 2 pages each; reused markets cost nothing.
    const usableRefs = s1.context!.references.filter((r) => r.ids.length && r.globalIds.length).length;
    expect(c.liveCallCount - callsBefore).toBe(rev.newlyResearched.length * 2 * (1 + usableRefs));
    expect(s2.plan.markets.map((m) => m.code)).not.toContain(target.code);
    expect(s2.violations).toEqual([]);
    expect(s2.trace.map((e) => e.state)).toContain("IMPACT_ANALYSIS");
  });

  it("a 40% budget cut needs no new Qloo calls and stays within budget", async () => {
    const c = client();
    const s1 = await runAgent({ ...input, constraints: { budgetUsd: 100000, maxMarkets: 5 } }, { client: c });
    const before = c.liveCallCount;
    const s2 = await replan(s1, { budgetUsd: 60000 }, { client: c });
    expect(c.liveCallCount).toBe(before);
    expect(s2.plan.totalCostUsd).toBeLessThanOrEqual(60000);
    expect(s2.revisions.at(-1)!.changes.length).toBeGreaterThan(0);
  });

  it("subtitle-first removes every dub", async () => {
    const c = client();
    const s1 = await runAgent({ ...input, constraints: { budgetUsd: 200000, maxMarkets: 5 } }, { client: c });
    const s2 = await replan(s1, { subtitleFirst: true }, { client: c });
    expect(s2.plan.markets.every((m) => m.mode !== "dub")).toBe(true);
    expect(s2.violations).toEqual([]);
  });
});
