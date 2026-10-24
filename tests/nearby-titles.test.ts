import { describe, expect, it } from "vitest";

import { slimBody } from "@/lib/qloo/client";
import { classifyNearby, localOriginSentence, NO_LOCAL_ORIGIN, NOT_PROOF_OF_ABSENCE } from "@/lib/territory/nearby-titles";

// Shaped on the live Germany/Mexico finding: every local-origin title near the comps also appears for unrelated genres.
const base = {
  ids: ["wunderschoen", "next-door", "ammonite", "corsage", "the-son"],
  names: { wunderschoen: "Wunderschön", "next-door": "Next Door", ammonite: "Ammonite", corsage: "Corsage", "the-son": "The Son" },
  origins: { wunderschoen: ["Germany"], "next-door": ["Germany"], ammonite: ["United Kingdom"], corsage: ["Austria"], "the-son": ["United Kingdom"] },
  controlIds: new Set(["wunderschoen", "next-door"]),
  controlsTested: 4,
  country: "Germany",
};

describe("classifyNearby", () => {
  it("counts titles that unrelated genres also return as catalogue, never as distinctive", () => {
    const n = classifyNearby(base);
    expect(n.genericCount).toBe(2);
    expect(n.genericExamples).toEqual(["Wunderschön", "Next Door"]);
    expect(n.localOrigin).toEqual([]);
    expect(n.international).toEqual(["Ammonite", "Corsage", "The Son"]);
  });

  it("states the exact no-local-origin sentence when no local title passes the controls, without claiming absence", () => {
    const s = localOriginSentence(classifyNearby(base), "Germany");
    expect(s).toContain(NO_LOCAL_ORIGIN);
    expect(s).toContain(NOT_PROOF_OF_ABSENCE);
  });

  it("applies the same rule to Mexico", () => {
    const n = classifyNearby({ ...base, ids: ["roma", "farewell"], names: { roma: "Roma", farewell: "The Farewell" }, origins: { roma: ["Mexico"], farewell: ["United States"] }, controlIds: new Set(["roma"]), country: "Mexico" });
    expect(n.localOrigin).toEqual([]);
    expect(localOriginSentence(n, "Mexico")).toContain(NO_LOCAL_ORIGIN);
  });

  it("lists a local-origin title only when it is absent from every control list", () => {
    const n = classifyNearby({ ...base, ids: ["asadas", "suzume"], names: { asadas: "The Asadas", suzume: "Suzume" }, origins: { asadas: ["Japan"], suzume: ["Japan"] }, controlIds: new Set(["suzume"]), country: "Japan" });
    expect(n.localOrigin).toEqual(["The Asadas"]);
    expect(localOriginSentence(n, "Japan")).toMatch(/^Distinctive under the 4 tested genre controls and produced in Japan: The Asadas\.$/);
  });

  it("does not report 'none found' when origin was never recorded", () => {
    const n = classifyNearby({ ...base, origins: {} });
    expect(n.originUnknown).toHaveLength(3);
    const s = localOriginSentence(n, "Germany");
    expect(s).not.toContain(NO_LOCAL_ORIGIN);
    expect(s).toContain("not recorded for 3");
  });

  it("calls nothing distinctive when no controls were available", () => {
    const n = classifyNearby({ ...base, controlsTested: 0 });
    expect([n.genericCount, n.localOrigin.length, n.international.length, n.originUnknown.length]).toEqual([0, 0, 0, 0]);
    expect(localOriginSentence(n, "Germany")).toMatch(/^Not tested/);
  });
});

describe("slimBody", () => {
  it("keeps release_country so local origin can be verified, and drops other properties", () => {
    const body = { success: true, results: { entities: [{ entity_id: "x", name: "X", properties: { release_year: 2021, release_country: ["Japan"], plot_summary: "drop me" } }] } };
    const slim = slimBody(body) as { results: { entities: Array<{ properties: Record<string, unknown> }> } };
    expect(slim.results.entities[0].properties).toEqual({ release_year: 2021, release_country: ["Japan"] });
  });
});
