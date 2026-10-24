import { describe, expect, it } from "vitest";

import { checkClaims, MarketEvidence, screenMarket, ScreenInput } from "@/lib/territory/claim-check";
import { classifyNearby, NOT_PROOF_OF_ABSENCE } from "@/lib/territory/nearby-titles";

// Shaped on the cached Japan case: genre controls remove most titles; an unrelated-film control removes a local
// arthouse title (The Asadas) that the genre-only filter let through; origins are not recorded.
const japan: ScreenInput = {
  ids: ["generic", "asadas", "chihiro", "tunnel", "shared"],
  names: { generic: "Generic Hit", asadas: "The Asadas", chihiro: "Call Me Chihiro", tunnel: "The Tunnel to Summer", shared: "All of Us Strangers" },
  origins: { asadas: ["Japan"] },
  country: "Japan",
  genreControlIds: new Set(["generic"]),
  genreControls: 4,
  filmControlIds: new Set(["asadas"]),
  filmControls: ["crime-thriller", "spanish-coming-of-age"],
  calls: { local: ["q1", "q2"], genre: ["q3"], film: ["q4", "q5"] },
};
const other = (ids: string[]): MarketEvidence => screenMarket({ ...japan, ids, names: {}, origins: {}, country: "Germany", genreControlIds: new Set(), filmControlIds: new Set(), calls: { local: ["q9"], genre: [], film: [] } });

describe("screenMarket", () => {
  it("applies genre controls, then unrelated-film controls, and keeps local-origin titles that fail a control on record", () => {
    const e = screenMarket(japan);
    expect(e.genreGeneric).toBe(1);
    expect(e.filmGeneric).toEqual({ count: 1, names: ["The Asadas"] });
    expect(e.localOriginGeneric).toEqual({ count: 1, names: ["The Asadas"] });
    expect(e.survivors.map((s) => s.name)).toEqual(["Call Me Chihiro", "The Tunnel to Summer", "All of Us Strangers"]);
  });
});

describe("checkClaims", () => {
  const all = { JP: screenMarket(japan), DE: other(["shared"]) };

  it("adversarial: a local-origin title that passes the old genre-only filter fails the stronger checker", () => {
    const genreOnly = classifyNearby({ ids: japan.ids, names: japan.names, origins: japan.origins, controlIds: japan.genreControlIds, controlsTested: 4, country: "Japan" });
    expect(genreOnly.localOrigin).toEqual(["The Asadas"]);
    const c = checkClaims(all, "JP");
    expect(c.candidates.map((x) => x.name)).not.toContain("The Asadas");
    expect(c.failedStronger.names).toContain("The Asadas");
    expect(c.decision).toContain("also appears for an unrelated genre or film here, so none is a film-specific local comparable");
  });

  it("presents survivors as candidates to verify, never as established local matches", () => {
    const c = checkClaims(all, "JP");
    expect(c.status).toBe("verify");
    expect(c.candidates.map((x) => x.name)).toEqual(["Call Me Chihiro", "The Tunnel to Summer"]);
    expect(c.decision).toMatch(/^No local comparable is established in Japan yet\./);
    expect(c.decision).toContain("They are candidates to verify, not proven local matches");
    expect(c.action).toMatch(/^Human review before citing any as a comparable/);
  });

  it("keeps a missing production origin unknown, never local or foreign", () => {
    const c = checkClaims(all, "JP");
    expect(c.candidates.every((x) => x.origin === "unknown" && x.originCountries.length === 0)).toBe(true);
    expect(c.decision).toContain("Production origin not recorded for 2 (unverified, neither local nor foreign)");
  });

  it("treats every candidate's release format as unverified, whatever the title says", () => {
    const concert = screenMarket({ ...japan, ids: ["gig"], names: { gig: "Band: World Tour - Global Premiere" }, genreControlIds: new Set(), filmControlIds: new Set() });
    const film = screenMarket({ ...japan, ids: ["drama"], names: { drama: "A Quiet Drama" }, genreControlIds: new Set(), filmControlIds: new Set() });
    const [a, b] = [checkClaims({ JP: concert }, "JP"), checkClaims({ JP: film }, "JP")];
    expect(a.candidates[0].format).toBe("unverified");
    expect(b.candidates[0].format).toBe("unverified");
    expect(a.decision.replace("Band: World Tour - Global Premiere", "X")).toBe(b.decision.replace("A Quiet Drama", "X"));
  });

  it("drops a survivor that another researched market also lists, and says uniqueness is only within those top-K lists", () => {
    const c = checkClaims(all, "JP");
    expect(c.failedStronger.names).toContain("All of Us Strangers");
    expect(c.funnel?.marketsCompared).toEqual(["DE"]);
    expect(c.decision).toContain("appear in none of the other 1 researched markets' top-100 lists");
    expect(c.provenance).toEqual({ local: ["q1", "q2"], genreControls: ["q3"], filmControls: ["q4", "q5"], crossMarket: ["q9"] });
  });

  it("changes the decision when the Qloo evidence changes", () => {
    expect(checkClaims(all, "JP").candidateCount).toBe(2);
    const noFilmHit = { ...all, JP: screenMarket({ ...japan, filmControlIds: new Set() }) };
    expect(checkClaims(noFilmHit, "JP").candidates.map((x) => x.name)).toContain("The Asadas");
    const everywhere = { ...all, DE: other(["shared", "chihiro", "tunnel"]) };
    const c = checkClaims(everywhere, "JP");
    expect(c.status).toBe("none");
    expect(c.decision).toContain("No defensible local comparable is established in Japan");
    expect(c.decision).toContain(NOT_PROOF_OF_ABSENCE);
    expect(c.action).toContain("Make no local taste-match claim");
  });

  it("stays honest with zero qualifying titles", () => {
    const empty = screenMarket({ ...japan, genreControlIds: new Set(japan.ids) });
    const c = checkClaims({ JP: empty }, "JP");
    expect(c.status).toBe("none");
    expect(c.candidates).toEqual([]);
    expect(c.funnel).toMatchObject({ titles: 5, afterGenre: 0, afterFilm: 0, afterCrossMarket: 0 });
    expect(c.provenance.local).toEqual(["q1", "q2"]);
  });

  it("reports insufficient evidence instead of a genre-only decision when no unrelated-film control ran", () => {
    const e = screenMarket({ ...japan, filmControlIds: new Set(), filmControls: [], filmGap: "quota guard" });
    const c = checkClaims({ JP: e }, "JP");
    expect(c.status).toBe("insufficient");
    expect(c.candidates).toEqual([]);
    expect(c.decision).toContain("no unrelated-film control could be run (quota guard)");
  });

  it("reports a research gap as insufficient evidence, not as a negative finding", () => {
    const c = checkClaims({}, "MX", "Qloo returned no titles near the comps here");
    expect(c.status).toBe("insufficient");
    expect(c.decision).toBe("No claim decision for Mexico: Qloo returned no titles near the comps here. No local comparable is put forward.");
  });
});

describe("session size", () => {
  it("worst case — all 22 markets researched with real-length Qloo ids — stays within the replan limit and fails closed", async () => {
    process.env.SESSION_SECRET ??= "unit-test-secret-unit-test-secret-0123";
    const { decrypt, encryptContext, MAX_CONTEXT_CHARS } = await import("@/lib/server/seal");
    const { attachClaimChecks } = await import("@/lib/agent/research");
    const { MARKETS } = await import("@/lib/territory/markets");
    const { NEIGHBOURHOOD_SIZE } = await import("@/lib/territory/market-signal");
    const uuid = (i: number) => `${String(i).padStart(8, "0")}-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const name = (i: number) => `A Fairly Long Real-World Film Title Number ${i}`;
    let n = 0;
    const list = (k: number) => Array.from({ length: k }, () => uuid(n++));
    const evidence = Object.fromEntries(MARKETS.map((m) => {
      const ids = list(NEIGHBOURHOOD_SIZE);
      // Every non-generic title survives: the largest evidence a market can carry.
      return [m.code, screenMarket({ ...japan, ids, names: Object.fromEntries(ids.map((id, i) => [id, name(i)])), origins: Object.fromEntries(ids.map((id) => [id, ["United States of America"]])), genreControlIds: new Set(), filmControlIds: new Set(), calls: { local: ["abc123-1", "abc123-2"], genre: list(8).map((x) => x.slice(0, 9)), film: list(4).map((x) => x.slice(0, 9)) } })];
    }));
    const global = list(NEIGHBOURHOOD_SIZE);
    const context = {
      compIds: list(6), global: { ids: global, names: Object.fromEntries(global.map((id, i) => [id, name(i)])), origins: {}, callIds: ["c1", "c2"] },
      references: Array.from({ length: 4 }, (_, i) => ({ id: `ref${i}`, ids: list(4), globalIds: list(NEIGHBOURHOOD_SIZE) })),
      filmControls: [{ id: "crime-thriller", ids: list(4) }, { id: "spanish-coming-of-age", ids: list(4) }], evidence,
    };
    const blob = encryptContext(context);
    expect(blob.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(blob.length).toBeLessThan(400_000 - 120_000); // leaves room for the sealed session in the 400 kB body
    // Evidence too large to keep: dropped and flagged, so a revision reports insufficient evidence, never a confident claim.
    const restored = decrypt<typeof context & { evidenceDropped?: boolean }>(blob)!;
    expect(restored.evidence).toBeUndefined();
    expect(restored.evidenceDropped).toBe(true);
    const research = { JP: { code: "JP", callIds: [], compIds: [], titlesFound: 100, nearby: classifyNearby({ ids: [], names: {}, origins: {}, controlIds: new Set(), controlsTested: 4, country: "Japan" }) } };
    const { research: checked } = attachClaimChecks(restored, research);
    expect(checked.JP.claimCheck!.status).toBe("insufficient");
    expect(checked.JP.claimCheck!.decision).toContain("too large to keep in the session");
  });

  it("a realistic context keeps its evidence", async () => {
    const { decrypt, encryptContext } = await import("@/lib/server/seal");
    const context = { compIds: ["a"], global: { ids: [], names: {}, origins: {}, callIds: [] }, references: [], evidence: { JP: screenMarket(japan) } };
    expect(decrypt<typeof context>(encryptContext(context))!.evidence.JP.survivors).toHaveLength(3);
  });
});
