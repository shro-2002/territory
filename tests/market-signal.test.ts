import { describe, expect, it } from "vitest";

import { anchorPercentile, computeMarketSignal, jaccard, spearman } from "@/lib/territory/market-signal";

const anchors = ["a1", "a2", "a3", "a4", "a5", "a6"];
const rowsWith = (compAff: number, anchorAffs: number[]) => [
  { entityId: "comp", affinity: compAff },
  ...anchorAffs.map((affinity, i) => ({ entityId: anchors[i], affinity })),
];

describe("anchor-calibrated market signal", () => {
  it("counts ties as half", () => {
    expect(anchorPercentile(0.5, [0.1, 0.5, 0.9, 0.9])).toBe(0.375);
  });

  it("is invariant to the per-query normalization constant", () => {
    // Same underlying taste, two queries normalized differently: the signal must not change.
    const a = computeMarketSignal(rowsWith(0.6, [0.2, 0.4, 0.5, 0.7, 0.8, 0.9]), ["comp"], anchors);
    const b = computeMarketSignal(rowsWith(0.6 * 0.37, [0.2, 0.4, 0.5, 0.7, 0.8, 0.9].map((x) => x * 0.37)), ["comp"], anchors);
    expect(a.score).toBe(b.score);
    expect(a.score).toBe(0.5);
  });

  it("flags insufficient evidence when too few reference titles return", () => {
    const s = computeMarketSignal(rowsWith(0.6, [0.2, 0.4]), ["comp"], anchors);
    expect(s.score).toBeNull();
    expect(s.insufficientReason).toMatch(/reference titles/);
  });

  it("flags insufficient evidence when no comp returns", () => {
    const s = computeMarketSignal(rowsWith(0.6, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]).slice(1), ["comp"], anchors);
    expect(s.score).toBeNull();
    expect(s.insufficientReason).toMatch(/no comparable/);
  });

  it("excludes a comp that is also an anchor from the panel", () => {
    const rows = [{ entityId: "a1", affinity: 0.9 }, ...anchors.slice(1).map((id, i) => ({ entityId: id, affinity: 0.1 * (i + 1) }))];
    const s = computeMarketSignal(rows, ["a1"], anchors);
    expect(s.anchorsFound).toBe(5);
    expect(s.score).toBe(1);
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
