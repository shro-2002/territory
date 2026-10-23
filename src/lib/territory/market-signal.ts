/**
 * Cross-market comparability: "taste portability".
 *
 * Live findings (docs/API_FEASIBILITY.md): affinity is normalized per query, and
 * filter.results.entities + a location only returns entities already in the localized pool,
 * so raw affinities cannot be compared across markets and a fixed anchor panel does not work.
 *
 * Instead we compare *sets*, which are scale-free:
 *   N0  = top-K titles Qloo associates with the comps (no location)
 *   Qm  = top-K titles for the same comps, conditioned on market m (signal.location.query)
 *   portability(m) = |Qm ∩ N0| / K     — how much of the comps' taste neighbourhood survives in m
 * Markets differ in how "portable" any taste is (data density, local catalogue), so each market's
 * portability is divided by the mean portability of fixed reference genre comp sets in that market:
 *   score(m) = portability(m) / mean_ref portability_ref(m)    — >1 means the comps travel to m
 *   better than typical genres do there.
 * It is a relative, ordinal signal about taste alignment. It is NOT audience size or demand.
 */

export const NEIGHBOURHOOD_SIZE = 100;
export const MIN_OVERLAP_FOR_SIGNAL = 3;
export const MIN_REFERENCE_BASELINES = 2;
// Below this overlap, one title more or less moves the score a lot.
const LOW_CONFIDENCE_OVERLAP = 8;
const LOW_CONFIDENCE_RANGE = 0.35;

export type Confidence = "low" | "moderate";

export interface MarketSignal {
  /** Portability lift vs reference genres in the same market; null when evidence is insufficient. */
  score: number | null;
  overlap: number;
  portability: number;
  baselinePortability: number | null;
  /** Titles in the market's comp neighbourhood that are absent globally: buyer-facing local comps. */
  localNeighbourIds: string[];
  /** Score range when each reference genre is left out in turn (sensitivity to baseline choice). */
  scoreRange: [number, number] | null;
  /** Never "high": the signal is relative and untested against outcomes. */
  confidence: Confidence | null;
  insufficientReason?: string;
}

export function portability(globalIds: string[], localIds: string[], k = NEIGHBOURHOOD_SIZE): { overlap: number; portability: number } {
  const global = new Set(globalIds.slice(0, k));
  const overlap = new Set(localIds.slice(0, k).filter((id) => global.has(id))).size;
  return { overlap, portability: overlap / k };
}

export function computeMarketSignal(globalIds: string[], localIds: string[], referencePortabilities: number[]): MarketSignal {
  const { overlap, portability: p } = portability(globalIds, localIds);
  const global = new Set(globalIds);
  const localNeighbourIds = localIds.filter((id) => !global.has(id)).slice(0, 10);
  const usableRefs = referencePortabilities.filter((r) => r > 0);
  const mean = (xs: number[]) => xs.reduce((s, r) => s + r, 0) / xs.length;
  const baselinePortability = usableRefs.length ? mean(usableRefs) : null;
  const base = { overlap, portability: p, baselinePortability, localNeighbourIds, scoreRange: null, confidence: null };
  if (localIds.length === 0) return { ...base, score: null, insufficientReason: "Qloo returned no titles for the comps in this market" };
  if (overlap < MIN_OVERLAP_FOR_SIGNAL) return { ...base, score: null, insufficientReason: `only ${overlap} of the comps' ${NEIGHBOURHOOD_SIZE} closest titles survive here (need ${MIN_OVERLAP_FOR_SIGNAL})` };
  if (usableRefs.length < MIN_REFERENCE_BASELINES) return { ...base, score: null, insufficientReason: `only ${usableRefs.length} reference genre baseline(s) available (need ${MIN_REFERENCE_BASELINES})` };
  const score = p / baselinePortability!;
  const loo = usableRefs.length > 2 ? usableRefs.map((_, i) => p / mean(usableRefs.filter((__, j) => j !== i))) : [score];
  const scoreRange: [number, number] = [Math.min(...loo), Math.max(...loo)];
  const confidence: Confidence = overlap < LOW_CONFIDENCE_OVERLAP || scoreRange[1] - scoreRange[0] > LOW_CONFIDENCE_RANGE ? "low" : "moderate";
  return { ...base, score, scoreRange, confidence };
}

/** Spearman rank correlation of two equal-length vectors (average ranks for ties). */
export function spearman(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 2) throw new Error("spearman needs two vectors of equal length >= 2");
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (ra.length + 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - mean) * (rb[i] - mean);
    da += (ra[i] - mean) ** 2;
    db += (rb[i] - mean) ** 2;
  }
  return da === 0 || db === 0 ? 1 : num / Math.sqrt(da * db);
}

function ranks(v: number[]): number[] {
  const order = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
  const out = new Array<number>(v.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

export function jaccard<T>(a: T[], b: T[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 1 : inter / union;
}
