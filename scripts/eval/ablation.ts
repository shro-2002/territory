/**
 * Qloo ablation: identical briefs, planner, cost table and validator; only Qloo cultural evidence differs.
 *   npm run ablation
 * Qloo-disabled = every candidate market gets the same uninformative score (no cultural evidence),
 * so the planner can only optimise cost and constraints. Aggregates -> docs/experiments/ablation-<mode>.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { replan, runAgent, Session } from "../../src/lib/agent/agent";
import { createQlooClient } from "../../src/lib/qloo/factory";
import { jaccard } from "../../src/lib/territory/market-signal";
import { marketByCode } from "../../src/lib/territory/markets";
import { buildPlan, Constraints, Plan, validatePlan } from "../../src/lib/territory/planner";
import { EVAL_SCENARIOS } from "../../src/lib/territory/scenarios";
import type { AgentInput } from "../../src/lib/agent/agent";

const client = createQlooClient({ callBudget: 400 });
const UNINFORMATIVE_SCORE = 1;

function disabledPlan(input: AgentInput, constraints: Constraints): Plan {
  const candidates = input.targetMarkets.map((c) => ({ ...marketByCode(c), score: UNINFORMATIVE_SCORE }));
  return buildPlan({ candidates, constraints, costs: input.costs, originalLanguage: input.originalLanguage });
}

const codes = (p: Plan) => p.markets.map((m) => m.code);

function qlooStats(s: Session) {
  const marketClaims = s.claims.filter((c) => c.provenance === "qloo" && Object.values(s.research).some((r) => c.text.startsWith(marketByCode(r.code).name)));
  return {
    status: s.status,
    plan: codes(s.plan),
    valid: s.violations.length === 0,
    marketsWithScores: Object.values(s.research).filter((r) => r.score !== null).length,
    marketsInsufficient: Object.values(s.research).filter((r) => r.score === null).length,
    localCompsTotal: Object.values(s.research).reduce((n, r) => n + r.localNeighbours.length, 0),
    marketClaimsBackedByQlooCalls: marketClaims.filter((c) => c.callIds.length > 0).length,
    marketClaimsUnbacked: marketClaims.filter((c) => c.callIds.length === 0).length,
  };
}

async function main() {
  const rows = [];
  for (const { id, input } of EVAL_SCENARIOS) {
    const s1 = await runAgent(input, { client });
    if (!s1.context) {
      rows.push({ scenario: id, qloo: qlooStats(s1), disabled: { plan: codes(disabledPlan(input, input.constraints)) }, note: "Qloo condition declined (no comps resolved); the disabled condition still produces a plan with no cultural basis" });
      continue;
    }
    const lost = s1.plan.markets.find((m) => m.mode !== "original")?.code;
    const c2 = { ...input.constraints, excludedMarkets: lost ? [lost] : [] };
    const c3 = { ...c2, budgetUsd: Math.round(input.constraints.budgetUsd * 0.6) };
    const s2 = lost ? await replan(s1, { excludedMarkets: [lost] }, { client }) : s1;
    const s3 = await replan(s2, { budgetUsd: c3.budgetUsd }, { client });
    const d = [disabledPlan(input, input.constraints), disabledPlan(input, c2), disabledPlan(input, c3)];
    const q = [s1, s2, s3];
    rows.push({
      scenario: id,
      removedMarket: lost ?? null,
      qloo: { ...qlooStats(s1), afterRemoval: codes(s2.plan), afterBudgetCut: codes(s3.plan), reservesResearched: s2.revisions.at(-1)?.newlyResearched ?? [] },
      disabled: { plan: codes(d[0]), afterRemoval: codes(d[1]), afterBudgetCut: codes(d[2]), localCompsTotal: 0, marketClaimsBackedByEvidence: 0 },
      constraintValid: { qloo: q.map((s) => s.violations.length === 0), disabled: d.map((p, i) => validatePlan(p, [input.constraints, c2, c3][i], input.costs, input.originalLanguage).length === 0) },
      planOverlapJaccard: q.map((s, i) => Math.round(jaccard(codes(s.plan), codes(d[i])) * 1000) / 1000),
      marketsChangedByCulturalEvidence: q.map((s, i) => new Set([...codes(s.plan), ...codes(d[i])]).size - codes(s.plan).filter((c) => codes(d[i]).includes(c)).length),
    });
  }
  const report = {
    mode: client.source,
    ran: new Date().toISOString(),
    qlooNetworkCalls: client.liveCallCount,
    design: "Same deterministic planner, cost table, constraints and validator in both conditions. Disabled = uniform score for every market (no cultural evidence). Constraint validity and arithmetic are identical by construction and are not attributed to Qloo.",
    rows,
  };
  const dir = path.join(process.cwd(), "docs", "experiments");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `ablation-${client.source}.json`), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 1) + "\n");
}

main().catch((err) => {
  process.stderr.write(`ablation failed: ${(err as Error).stack}\n`);
  process.exit(1);
});
