/**
 * Cross-market comparability.
 *
 * Qloo affinity is normalized per query, so the raw affinity of a film in a Brazil query
 * cannot be compared with its raw affinity in a Japan query. Instead, every market query
 * asks for the comps AND a fixed reference panel of globally known films in the same call
 * (filter.results.entities). Within one query all scores share one normalization, so the
 * comp's *position relative to the panel* is meaningful. That relative position (0..1) is
 * what we compare across markets.
 *
 * Interpretation: "In market M, the comps out-rank X% of the reference panel."
 * It is an ordinal, relative signal. It is NOT audience size or demand.
 */

export const MIN_ANCHORS_FOR_SIGNAL = 5;
export const MIN_COMPS_FOR_SIGNAL = 1;

export interface AffinityRow {
  entityId: string;
  affinity: number;
}

export interface MarketSignal {
  /** Mean anchor-percentile of comps, null when evidence is insufficient. */
  score: number | null;
  compsFound: number;
  compsRequested: number;
  anchorsFound: number;
  perComp: Array<{ entityId: string; percentile: number }>;
  insufficientReason?: string;
}

/** Share of anchors the value beats; ties count half. */
export function anchorPercentile(value: number, anchorValues: number[]): number {
  if (anchorValues.length === 0) throw new Error("anchorPercentile needs at least one anchor");
  let beaten = 0;
  for (const a of anchorValues) {
    if (value > a) beaten += 1;
    else if (value === a) beaten += 0.5;
  }
  return beaten / anchorValues.length;
}

export function computeMarketSignal(rows: AffinityRow[], compIds: string[], anchorIds: string[]): MarketSignal {
  const byId = new Map(rows.map((r) => [r.entityId, r.affinity]));
  // An entity that is both comp and anchor would compare with itself; exclude it from the panel.
  const compSet = new Set(compIds);
  const anchorValues = anchorIds.filter((id) => !compSet.has(id) && byId.has(id)).map((id) => byId.get(id)!);
  const perComp = compIds.filter((id) => byId.has(id)).map((id) => ({ entityId: id, percentile: 0 }));
  const base = { compsFound: perComp.length, compsRequested: compIds.length, anchorsFound: anchorValues.length };

  if (anchorValues.length < MIN_ANCHORS_FOR_SIGNAL) {
    return { ...base, score: null, perComp: [], insufficientReason: `only ${anchorValues.length} reference titles returned (need ${MIN_ANCHORS_FOR_SIGNAL})` };
  }
  if (perComp.length < MIN_COMPS_FOR_SIGNAL) {
    return { ...base, score: null, perComp: [], insufficientReason: "no comparable titles returned for this market" };
  }
  const scored = perComp.map((c) => ({ entityId: c.entityId, percentile: anchorPercentile(byId.get(c.entityId)!, anchorValues) }));
  const score = scored.reduce((s, c) => s + c.percentile, 0) / scored.length;
  return { ...base, score, perComp: scored };
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
