/**
 * Catalogue audit of the taste-portability score (npm run audit-catalogue). PRIVATE CACHE ONLY: callBudget 0,
 * so any cache miss throws and no Qloo call is made. Does not change the scoring algorithm.
 * For each brief x market it splits the overlap behind the score into titles the same market also returns
 * for an unrelated reference genre (catalogue) and the rest, and recomputes a diagnostic "residual" ratio
 * without catalogue titles. Writes aggregates only (no titles) to docs/experiments/catalogue-audit-live.json.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { buildContext, neighbourhood, retiredPortabilitySignal } from "../../src/lib/agent/research";
import { resolveComp } from "../../src/lib/agent/resolve";
import { QlooClient } from "../../src/lib/qloo/client";
import { FileCache, PRIVATE_DIR } from "../../src/lib/qloo/factory";
import { spearman } from "../../src/lib/territory/market-signal";
import { marketByCode } from "../../src/lib/territory/markets";
import { EVAL_SCENARIOS } from "../../src/lib/territory/scenarios";

/* eslint-disable @typescript-eslint/no-explicit-any */
const client = new QlooClient({ apiKey: "cache-only", source: "live", cache: new FileCache(path.join(PRIVATE_DIR, "qloo-cache")), callBudget: 0 });
const K = 100;
const r2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

const out: Record<string, any> = {};
for (const { id, input } of EVAL_SCENARIOS.filter((s: any) => s.id !== "cold-start-unknown-comps")) {
  const comps = await Promise.all(input.comps.map((c: any) => resolveComp(client, c)));
  const compIds = comps.filter((c: any) => c.entityId).map((c: any) => c.entityId);
  const ctx = await buildContext(client, compIds);
  const N0 = new Set(ctx.global.ids.slice(0, K));
  const rows: any[] = [];
  for (const code of input.targetMarkets) {
    const loc = marketByCode(code).locationQuery;
    const r = await retiredPortabilitySignal(client, code, ctx);
    const Q = (await neighbourhood(client, compIds, loc)).ids.slice(0, K);
    const refs = ctx.references.filter((x: any) => x.ids.length && x.globalIds.length);
    const refLocal: Record<string, string[]> = {};
    for (const x of refs) refLocal[x.id] = (await neighbourhood(client, x.ids, loc)).ids.slice(0, K);
    const pool = (exclude?: string) => new Set(Object.entries(refLocal).filter(([k]) => k !== exclude).flatMap(([, v]) => v));
    const P = pool();
    const overlapIds = Q.filter((t) => N0.has(t));
    const overlapGeneric = overlapIds.filter((t) => P.has(t)).length;
    // Residual portability: overlap titles NOT returned for any unrelated genre in the same market (leave-self-out pool for refs).
    const resShow = overlapIds.filter((t) => !P.has(t)).length / K;
    const resRefs = refs.map((x: any) => { const g = new Set(x.globalIds.slice(0, K)); const pl = pool(x.id); return refLocal[x.id].filter((t) => g.has(t) && !pl.has(t)).length / K; });
    rows.push({
      code, score: r.score === null ? null : r2(r.score), range: r.scoreRange?.map(r2) ?? null, confidence: r.confidence,
      overlap: r.overlap, overlapGeneric, overlapGenericShare: overlapIds.length ? r2(overlapGeneric / overlapIds.length) : null,
      neighbourhoodGenericShare: r2(Q.filter((t) => P.has(t)).length / Q.length),
      portability: r2(r.portability), refMean: r.baselinePortability === null ? null : r2(r.baselinePortability),
      residualOverlap: Math.round(resShow * K), residualRefMean: r2(mean(resRefs) * K),
      residualScore: mean(resRefs) > 0 ? r2(resShow / mean(resRefs)) : null,
    });
  }
  out[id] = rows;
}
// Normalization check: does the reference baseline track the showcase's market factor? (corr across markets)
const pearson = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return r2(n / Math.sqrt(da * db)); };
const briefs = Object.keys(out);
const summary: Record<string, any> = {};
for (const b of briefs) {
  const rows = out[b].filter((x: any) => x.score !== null);
  summary[b] = {
    pearson_portability_vs_refMean: pearson(rows.map((x: any) => x.portability), rows.map((x: any) => x.refMean)),
    spearman_score_vs_residual: rows.every((x: any) => x.residualScore !== null) ? r2(spearman(rows.map((x: any) => x.score), rows.map((x: any) => x.residualScore))) : "residual undefined in some market",
    meanOverlapGenericShare: r2(mean(rows.filter((x: any) => x.overlapGenericShare !== null).map((x: any) => x.overlapGenericShare))),
    above1: rows.filter((x: any) => x.range && x.range[0] > 1).map((x: any) => x.code),
    below1: rows.filter((x: any) => x.range && x.range[1] < 1).map((x: any) => x.code),
  };
}
// Is the ranking a market constant? Spearman of per-market scores between briefs (same markets).
const pair: Record<string, number> = {};
const portPair: Record<string, number> = {};
for (let i = 0; i < briefs.length; i++) for (let j = i + 1; j < briefs.length; j++) {
  const codes = out[briefs[i]].filter((x: any) => x.score !== null).map((x: any) => x.code).filter((c: string) => out[briefs[j]].some((y: any) => y.code === c && y.score !== null));
  const v = (b: string, f: string) => codes.map((c: string) => out[b].find((x: any) => x.code === c)[f]);
  pair[`${briefs[i]}~${briefs[j]}`] = r2(spearman(v(briefs[i], "score"), v(briefs[j], "score")));
  portPair[`${briefs[i]}~${briefs[j]}`] = r2(spearman(v(briefs[i], "portability"), v(briefs[j], "portability")));
}
const live = client.calls.filter((c: any) => !c.cacheHit).length;
const report = { out, summary, crossBriefSpearman: { score: pair, rawPortability: portPair }, calls: client.calls.length, network: live };
writeFileSync(path.join(process.cwd(), "docs", "experiments", "catalogue-audit-live.json"), JSON.stringify(report, null, 1) + "\n");
console.log(JSON.stringify(report, null, 1));
