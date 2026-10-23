/**
 * E6 — Qloo-enabled Territory vs an LLM-only planner on identical inputs.
 *   npm run e6        (needs QLOO_API_KEY and a local ollama with qwen3:14b)
 * Both conditions get the same scenario, markets, cost table and constraints, and the same two
 * revisions (remove the top localized market, then cut budget 40%). Both outputs are scored by the
 * same independent checker. Aggregates -> docs/experiments/e6-<mode>.json; full outputs -> .private/.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { replan, runAgent, Session } from "../../src/lib/agent/agent";
import { pickCandidate } from "../../src/lib/agent/resolve";
import { createQlooClient, PRIVATE_DIR } from "../../src/lib/qloo/factory";
import { jaccard, spearman } from "../../src/lib/territory/market-signal";
import { MARKETS } from "../../src/lib/territory/markets";
import { Constraints, LocalizationMode, Plan, validatePlan } from "../../src/lib/territory/planner";
import { EVAL_SCENARIOS } from "../../src/lib/territory/scenarios";
import type { AgentInput } from "../../src/lib/agent/agent";

const MODEL = process.env.E6_MODEL ?? "qwen3:14b";
const OLLAMA = "http://localhost:11434/api/chat";
const client = createQlooClient({ callBudget: 400 });

interface LlmPlan {
  markets: Array<{ code: string; mode: LocalizationMode; rationale?: string; local_comps?: string[] }>;
  total_cost_usd: number;
  claims?: Array<{ text: string; source?: string }>;
  abstain?: boolean;
  abstain_reason?: string;
}

const SYSTEM = `You are an international film distribution strategist. You have NO tools and NO data access.
Return ONLY JSON: {"markets":[{"code":"<2-letter>","mode":"original|subtitle|dub","rationale":"...","local_comps":["<film title popular with this market's audience, similar to the comps>"]}],
"total_cost_usd":<number>,"claims":[{"text":"<factual claim supporting the plan>","source":"<where it comes from>"}],"abstain":<true if you cannot responsibly plan>,"abstain_reason":"..."}
Rules: pick at most maxMarkets markets from the candidates; a market whose language equals the film's original language uses mode "original" and costs 0;
each other language is paid once (subtitle or dub) no matter how many markets share it; total cost must not exceed the budget; never pick excluded markets;
if subtitleFirst is true, never dub.`;

function describe(input: AgentInput) {
  const markets = input.targetMarkets.map((c) => MARKETS.find((m) => m.code === c)!).map((m) => `${m.code} (${m.name}, ${m.language})`);
  return JSON.stringify({
    title: input.title, synopsis: input.synopsis, genre: input.genre, originalLanguage: input.originalLanguage,
    comps: input.comps, candidateMarkets: markets, languageCostsUsd: input.costs, constraints: input.constraints,
  });
}

async function llm(messages: Array<{ role: string; content: string }>): Promise<{ plan: LlmPlan | null; raw: string; ms: number }> {
  const started = Date.now();
  const res = await fetch(OLLAMA, {
    method: "POST",
    body: JSON.stringify({ model: MODEL, messages, stream: false, think: false, format: "json", options: { temperature: 0, seed: 42, num_ctx: 8192 } }),
  });
  const body = (await res.json()) as { message?: { content?: string } };
  const raw = body.message?.content ?? "";
  try {
    return { plan: JSON.parse(raw) as LlmPlan, raw, ms: Date.now() - started };
  } catch {
    return { plan: null, raw, ms: Date.now() - started };
  }
}

/** Convert an LLM plan into Territory's Plan shape, recomputing cost from the shared cost table. */
function toPlan(p: LlmPlan, input: AgentInput): { plan: Plan; problems: string[] } {
  const problems: string[] = [];
  const markets = (p.markets ?? []).flatMap((m) => {
    const market = MARKETS.find((x) => x.code === m.code);
    if (!market || !input.targetMarkets.includes(m.code)) {
      problems.push(`unknown or non-candidate market ${m.code}`);
      return [];
    }
    const mode: LocalizationMode = market.language === input.originalLanguage ? "original" : m.mode === "original" ? "subtitle" : m.mode;
    if (market.language !== input.originalLanguage && m.mode === "original") problems.push(`${m.code} marked original but its language is ${market.language}`);
    return [{ code: m.code, name: market.name, language: market.language, mode, score: 0, value: 0 }];
  });
  const languages = new Map<string, LocalizationMode>();
  for (const m of markets) {
    if (m.mode === "original") continue;
    const prev = languages.get(m.language);
    if (prev && prev !== m.mode) problems.push(`${m.language} assigned both ${prev} and ${m.mode}`);
    if (prev !== "dub") languages.set(m.language, m.mode);
  }
  const langs = [...languages].map(([language, mode]) => ({ language, mode, costUsd: input.costs[language] ? (mode === "dub" ? input.costs[language].dubUsd : input.costs[language].subtitleUsd) : NaN }));
  const recomputed = langs.reduce((s, l) => s + l.costUsd, 0);
  if (Math.abs(recomputed - (p.total_cost_usd ?? NaN)) > 1) problems.push(`reported cost ${p.total_cost_usd} vs recomputed ${recomputed}`);
  return { plan: { markets, languages: langs, totalCostUsd: recomputed, totalValue: 0, excluded: [] }, problems };
}

const QUANT = /(\d[\d,.]*\s*(%|percent|million|billion|k\b|viewers|admissions|box office|\$))|(\$\s?\d)/i;

function scoreLlm(p: LlmPlan | null, input: AgentInput, constraints: Constraints) {
  if (!p) return { parsed: false };
  const { plan, problems } = toPlan(p, input);
  const violations = [...validatePlan(plan, constraints, input.costs, input.originalLanguage), ...problems.filter((x) => !x.startsWith("reported cost"))];
  const claims = p.claims ?? [];
  return {
    parsed: true,
    abstained: Boolean(p.abstain),
    markets: plan.markets.map((m) => m.code),
    recomputedCostUsd: plan.totalCostUsd,
    reportedCostUsd: p.total_cost_usd,
    costArithmeticCorrect: !problems.some((x) => x.startsWith("reported cost")),
    violations,
    valid: violations.length === 0,
    claims: claims.length,
    quantitativeClaims: claims.filter((c) => QUANT.test(c.text)).length,
    claimsWithCheckableSource: claims.filter((c) => /https?:\/\/|doi|box office mojo|the numbers|netflix top 10/i.test(c.source ?? "")).length,
    localCompsNamed: (p.markets ?? []).flatMap((m) => m.local_comps ?? []),
  };
}

function scoreTerritory(s: Session) {
  return {
    status: s.status,
    markets: s.plan.markets.map((m) => m.code),
    costUsd: s.plan.totalCostUsd,
    violations: s.violations,
    valid: s.violations.length === 0,
    claims: s.claims.length,
    qlooClaimsWithoutCall: s.claims.filter((c) => c.provenance === "qloo" && c.callIds.length === 0).length,
    byProvenance: Object.fromEntries(["qloo", "user", "hypothesis", "insufficient", "external"].map((k) => [k, s.claims.filter((c) => c.provenance === k).length])),
    quantitativeDemandClaims: s.claims.filter((c) => /viewers|admissions|box office|revenue/i.test(c.text) && !c.text.startsWith("No claim")).length,
    marketScores: Object.fromEntries(Object.values(s.research).map((r) => [r.code, r.score === null ? null : Math.round(r.score * 1000) / 1000])),
  };
}

/** How many LLM-named local comps exist in Qloo at all (exact title match). Capped to protect quota. */
async function verifyTitles(titles: string[], cap = 12) {
  const unique = [...new Set(titles.map((t) => t.trim()).filter(Boolean))].slice(0, cap);
  let found = 0;
  for (const t of unique) if (pickCandidate({ name: t }, await client.search(t, ["urn:entity:movie", "urn:entity:tv_show"], 5)).status !== "unresolved") found++;
  return { checked: unique.length, foundInQloo: found };
}

async function main() {
  const startedAt = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  const privateOut: Record<string, unknown>[] = [];
  const territoryRank: Record<string, string[]> = {};
  const llmRank: Record<string, string[]> = {};

  for (const { id, input } of EVAL_SCENARIOS) {
    process.stdout.write(`\n# ${id}\n`);
    // Territory: initial + two revisions.
    const t1 = await runAgent(input, { client });
    const lost = t1.plan.markets.find((m) => m.mode !== "original")?.code ?? t1.plan.markets[0]?.code;
    const t2 = lost ? await replan(t1, { excludedMarkets: [lost] }, { client }) : t1;
    const t3 = t1.context ? await replan(t2, { budgetUsd: Math.round(input.constraints.budgetUsd * 0.6) }, { client }) : t2;
    territoryRank[id] = Object.values(t1.research).filter((r) => r.score !== null).sort((a, b) => b.score! - a.score!).map((r) => r.code);

    // LLM-only: same input, then the SAME revisions (removing the market Territory removed, for comparability).
    const msgs = [{ role: "system", content: SYSTEM }, { role: "user", content: `Plan the release.\n${describe(input)}` }];
    const l1 = await llm(msgs);
    const c2 = { ...input.constraints, excludedMarkets: lost ? [lost] : [] };
    const l2 = await llm([...msgs, { role: "assistant", content: l1.raw }, { role: "user", content: `Constraint change: market ${lost} is no longer available. Revise the plan under constraints ${JSON.stringify(c2)}.` }]);
    const c3 = { ...c2, budgetUsd: Math.round(input.constraints.budgetUsd * 0.6) };
    const l3 = await llm([...msgs, { role: "assistant", content: l1.raw }, { role: "user", content: `Constraint change: market ${lost} unavailable and budget cut 40%. Revise under constraints ${JSON.stringify(c3)}.` }, ]);
    llmRank[id] = (l1.plan?.markets ?? []).map((m) => m.code);

    const s1 = scoreLlm(l1.plan, input, input.constraints);
    const titles = await verifyTitles((s1 as { localCompsNamed?: string[] }).localCompsNamed ?? []);
    const row = {
      scenario: id,
      removedMarket: lost ?? null,
      territory: { initial: scoreTerritory(t1), afterRemoval: scoreTerritory(t2), afterBudgetCut: scoreTerritory(t3), newMarketsResearched: t2.revisions.at(-1)?.newlyResearched ?? [] },
      llmOnly: { model: MODEL, initial: { ...s1, localCompsNamed: undefined, localCompTitlesVerified: titles }, afterRemoval: { ...scoreLlm(l2.plan, input, c2), localCompsNamed: undefined }, afterBudgetCut: { ...scoreLlm(l3.plan, input, c3), localCompsNamed: undefined }, latencyMs: [l1.ms, l2.ms, l3.ms] },
    };
    rows.push(row);
    privateOut.push({ id, territory: [t1, t2, t3], llm: [l1.raw, l2.raw, l3.raw] });
    process.stdout.write(`territory valid ${[t1, t2, t3].map((s) => s.violations.length === 0)} markets ${t1.plan.markets.map((m) => m.code)} | llm valid ${[s1, row.llmOnly.afterRemoval, row.llmOnly.afterBudgetCut].map((s) => (s as { valid?: boolean }).valid)} markets ${llmRank[id]}\n`);
  }

  // Differentiation: do market choices change with the film's taste profile?
  const ids = EVAL_SCENARIOS.map((s) => s.id).filter((id) => !id.startsWith("cold"));
  const pairwise = (rank: Record<string, string[]>) => {
    const out: Record<string, number> = {};
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out[`${ids[i]}~${ids[j]}`] = Math.round(jaccard(rank[ids[i]]?.slice(0, 5) ?? [], rank[ids[j]]?.slice(0, 5) ?? []) * 1000) / 1000;
    return out;
  };
  const scoreVector = (a: string, b: string) => {
    const sa = (rows.find((r) => r.scenario === a) as { territory: { initial: { marketScores: Record<string, number | null> } } }).territory.initial.marketScores;
    const sb = (rows.find((r) => r.scenario === b) as { territory: { initial: { marketScores: Record<string, number | null> } } }).territory.initial.marketScores;
    const common = Object.keys(sa).filter((k) => sa[k] !== null && sb[k] !== null);
    return common.length >= 4 ? Math.round(spearman(common.map((k) => sa[k]!), common.map((k) => sb[k]!)) * 1000) / 1000 : null;
  };
  const report = {
    mode: client.source, model: MODEL, startedAt, finishedAt: new Date().toISOString(),
    note: "Aggregates only. Taste portability is relative taste alignment, not a box-office or audience forecast. LLM-only = local model with no tools, temperature 0, seed 42, single run per prompt.",
    scenarios: rows,
    differentiation: {
      top5JaccardAcrossScenarios: { territory: pairwise(territoryRank), llmOnly: pairwise(llmRank) },
      territoryScoreSpearmanAcrossScenarios: Object.fromEntries(ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [`${a}~${b}`, scoreVector(a, b)]))),
    },
    qlooNetworkCalls: client.liveCallCount,
  };
  const dir = path.join(process.cwd(), "docs", "experiments");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `e6-${client.source}.json`), JSON.stringify(report, null, 2) + "\n");
  await mkdir(PRIVATE_DIR, { recursive: true });
  await writeFile(path.join(PRIVATE_DIR, `e6-${client.source}-full.json`), JSON.stringify(privateOut, null, 2));
  process.stdout.write(`\nQloo network calls ${client.liveCallCount}; written docs/experiments/e6-${client.source}.json\n`);
}

main().catch((err) => {
  process.stderr.write(`e6 failed: ${(err as Error).stack}\n`);
  process.exit(1);
});
