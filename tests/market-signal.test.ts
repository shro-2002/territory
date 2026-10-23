import { describe, expect, it } from "vitest";

import { computeMarketSignal, jaccard, MIN_OVERLAP_FOR_SIGNAL, portability, spearman } from "@/lib/territory/market-signal";

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const global = ids("g", 100);
/** A local list keeping the first `keep` global titles, padded with market-only titles. */
const local = (keep: number) => [...global.slice(0, keep), ...ids("l", 100 - keep)];

describe("taste portability signal", () => {
  it("counts overlap within the top-K only", () => {
    expect(portability(global, local(20))).toEqual({ overlap: 20, portability: 0.2 });
    expect(portability(global, [...ids("l", 100), ...global]).overlap).toBe(0);
  });

  it("depends only on membership, so per-query affinity scaling cannot change it", () => {
    // Inputs are ordered id lists; no affinity value enters the computation.
    expect(computeMarketSignal(global, local(30), [0.15])).toEqual(computeMarketSignal(global, local(30), [0.15]));
  });

  it("scores lift against the market's own reference baseline", () => {
    const s = computeMarketSignal(global, local(30), [0.1, 0.2]);
    expect(s.score).toBeCloseTo(2);
    expect(s.localNeighbourIds).toEqual(ids("l", 10));
  });

  it("ignores zero-overlap reference sets in the baseline", () => {
    expect(computeMarketSignal(global, local(30), [0, 0.15]).baselinePortability).toBeCloseTo(0.15);
  });

  it("flags thin overlap as insufficient", () => {
    const s = computeMarketSignal(global, local(MIN_OVERLAP_FOR_SIGNAL - 1), [0.1]);
    expect(s.score).toBeNull();
    expect(s.insufficientReason).toMatch(/closest titles survive/);
  });

  it("flags an empty market list and a missing baseline", () => {
    expect(computeMarketSignal(global, [], [0.1]).insufficientReason).toMatch(/no titles/);
    expect(computeMarketSignal(global, local(30), [0, 0]).insufficientReason).toMatch(/baseline/);
  });
});

describe("rank statistics", () => {
  it("spearman is 1 for monotone, -1 for reversed", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });
  it("jaccard of disjoint sets is 0", () => {
    expect(jaccard(["a"], ["b"])).toBe(0);
  });
});
