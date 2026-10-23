/**
 * Audit of the taste-portability method on the E6 briefs (cached Qloo data; new calls only if the cache misses).
 *   npm run audit-scoring
 * Checks: reference-genre leave-one-out stability, list truncation (K=50 vs 100), missing data,
 * and localization-cost bias in the planner. Aggregates -> docs/experiments/scoring-audit-<mode>.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildContext, neighbourhood } from "../../src/lib/agent/research";
import { resolveComp } from "../../src/lib/agent/resolve";
import { createQlooClient } from "../../src/lib/qloo/factory";
import { portability, spearman } from "../../src/lib/territory/market-signal";
import { marketByCode } from "../../src/lib/territory/markets";
import { buildPlan } from "../../src/lib/territory/planner";
import { EVAL_SCENARIOS } from "../../src/lib/territory/scenarios";

const client = createQlooClient({ callBudget: 300 });
const round = (x: number) => Math.round(x * 1000) / 1000;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

async function scenarioAudit(id: string, input: (typeof EVAL_SCENARIOS)[number]["input"]) {
  const comps = (await Promise.all(input.comps.map((c) => resolveComp(client, c)))).filter((c) => c.entityId).map((c) => c.entityId!);
  if (!comps.length) return { id, skipped: "no comps resolved" };
  const ctx = await buildContext(client, comps);
  const refs = ctx.references.filter((r) => r.ids.length && r.globalIds.length);
  const rows: Array<{ code: string; p100: number; p50: number; refs100: number[]; refs50: number[] }> = [];
  for (const code of input.targetMarkets) {
    const loc = marketByCode(code).locationQuery;
    const local = await neighbourhood(client, ctx.compIds, loc);
    const refLists = await Promise.all(refs.map((r) => neighbourhood(client, r.ids, loc)));
    rows.push({
      code,
      p100: portability(ctx.global.ids, local.ids, 100).portability,
      p50: portability(ctx.global.ids, local.ids, 50).portability,
      refs100: refs.map((r, i) => portability(r.globalIds, refLists[i].ids, 100).portability),
      refs50: refs.map((r, i) => portability(r.globalIds, refLists[i].ids, 50).portability),
    });
  }
  const score = (p: number, rs: number[]) => {
    const u = rs.filter((x) => x > 0);
    return u.length >= 2 && p > 0 ? p / mean(u) : null;
  };
  const full = rows.map((r) => score(r.p100, r.refs100));
  const scoredIdx = full.map((s, i) => (s === null ? -1 : i)).filter((i) => i >= 0);
  const fullVec = scoredIdx.map((i) => full[i]!);

  // Leave one reference genre out.
  const loo = refs.map((ref, k) => {
    const v = scoredIdx.map((i) => score(rows[i].p100, rows[i].refs100.filter((_, j) => j !== k)) ?? 0);
    return { dropped: ref.id, spearmanVsFull: round(spearman(fullVec, v)), meanAbsDelta: round(mean(v.map((x, i) => Math.abs(x - fullVec[i])))) };
  });
  // Truncation: K=50 instead of 100.
  const k50 = scoredIdx.map((i) => score(rows[i].p50, rows[i].refs50) ?? 0);
  // Cost bias: same scores, flat cost per language vs the real cost table.
  const candidates = rows.map((r, i) => ({ ...marketByCode(r.code), score: full[i] }));
  const real = buildPlan({ candidates, constraints: input.constraints, costs: input.costs, originalLanguage: input.originalLanguage });
  const avg = { subtitleUsd: Math.round(mean(Object.values(input.costs).map((c) => c.subtitleUsd))), dubUsd: Math.round(mean(Object.values(input.costs).map((c) => c.dubUsd))) };
  const flat = buildPlan({ candidates, constraints: input.constraints, costs: Object.fromEntries(Object.keys(input.costs).map((l) => [l, avg])), originalLanguage: input.originalLanguage });
  const top5ByScore = scoredIdx.sort((a, b) => full[b]! - full[a]!).slice(0, 5).map((i) => rows[i].code);
  const originalShare = (codes: string[]) => round(codes.filter((c) => marketByCode(c).language === input.originalLanguage).length / Math.max(1, codes.length));
  return {
    id,
    marketsScored: fullVec.length,
    marketsInsufficient: rows.length - fullVec.length,
    zeroPortabilityReferences: rows.reduce((s, r) => s + r.refs100.filter((x) => x === 0).length, 0),
    referencesUsed: refs.map((r) => r.id),
    leaveOneReferenceOut: loo,
    truncationK50: { spearmanVsK100: round(spearman(fullVec, k50)) },
    costBias: {
      planRealCosts: real.markets.map((m) => m.code),
      planFlatCosts: flat.markets.map((m) => m.code),
      originalLanguageShare: { top5ByScore: originalShare(top5ByScore), planRealCosts: originalShare(real.markets.map((m) => m.code)) },
    },
  };
}

async function main() {
  const results = [];
  for (const s of EVAL_SCENARIOS) results.push(await scenarioAudit(s.id, s.input));
  const report = { mode: client.source, ran: new Date().toISOString(), qlooNetworkCalls: client.liveCallCount, results };
  const dir = path.join(process.cwd(), "docs", "experiments");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `scoring-audit-${client.source}.json`), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 1) + "\n");
}

main().catch((err) => {
  process.stderr.write(`audit failed: ${(err as Error).stack}\n`);
  process.exit(1);
});
