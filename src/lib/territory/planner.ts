import { z } from "zod";

/**
 * Deterministic strategy construction. No LLM touches this arithmetic.
 * Chooses which markets to prioritise and how to localise each language
 * (subtitle vs dub) under a hard budget, maximising evidence-weighted value.
 */

export const LocalizationMode = z.enum(["original", "subtitle", "dub"]);
export type LocalizationMode = z.infer<typeof LocalizationMode>;

export const ConstraintsSchema = z.object({
  budgetUsd: z.number().nonnegative(),
  maxMarkets: z.number().int().min(1).max(8),
  excludedMarkets: z.array(z.string()).default([]),
  excludedLanguages: z.array(z.string()).default([]),
  subtitleFirst: z.boolean().default(false),
});
export type Constraints = z.infer<typeof ConstraintsSchema>;

/** User-provided cost assumptions per language. Never presented as market facts. */
export const LanguageCostSchema = z.object({ subtitleUsd: z.number().nonnegative(), dubUsd: z.number().nonnegative() });
export type LanguageCost = z.infer<typeof LanguageCostSchema>;

export interface CandidateMarket {
  code: string;
  name: string;
  language: string;
  /** Anchor-calibrated signal in [0,1]; null = insufficient evidence (never selected). */
  score: number | null;
}

export interface MarketDecision {
  code: string;
  name: string;
  language: string;
  mode: LocalizationMode;
  score: number;
  value: number;
}

export interface Plan {
  markets: MarketDecision[];
  languages: Array<{ language: string; mode: LocalizationMode; costUsd: number }>;
  totalCostUsd: number;
  totalValue: number;
  excluded: Array<{ code: string; reason: string }>;
}

// Modelling assumption: a dub reaches more of a market's audience than subtitles.
// Exposed in the report and adjustable; not an empirical claim.
export const MODE_REACH: Record<LocalizationMode, number> = { original: 1, subtitle: 0.7, dub: 1 };
const MAX_CANDIDATES = 14;

export interface PlanInput {
  candidates: CandidateMarket[];
  constraints: Constraints;
  costs: Record<string, LanguageCost>;
  originalLanguage: string;
}

export function buildPlan({ candidates, constraints, costs, originalLanguage }: PlanInput): Plan {
  const excluded: Plan["excluded"] = [];
  const eligible: CandidateMarket[] = [];
  for (const c of candidates) {
    if (constraints.excludedMarkets.includes(c.code)) excluded.push({ code: c.code, reason: "market excluded by user" });
    else if (constraints.excludedLanguages.includes(c.language) && c.language !== originalLanguage) excluded.push({ code: c.code, reason: `language ${c.language} excluded by user` });
    else if (c.score === null) excluded.push({ code: c.code, reason: "insufficient Qloo evidence" });
    else if (c.language !== originalLanguage && !costs[c.language]) excluded.push({ code: c.code, reason: `no cost assumption for ${c.language}` });
    else eligible.push(c);
  }
  // ponytail: exhaustive search, fine for <=14 candidates x <=8 markets; switch to ILP if candidate lists grow.
  const pool = [...eligible].sort((a, b) => b.score! - a.score!).slice(0, MAX_CANDIDATES);
  for (const c of eligible.slice(MAX_CANDIDATES)) excluded.push({ code: c.code, reason: "outside top candidates" });

  let best: Plan | null = null;
  for (const subset of subsetsUpTo(pool, constraints.maxMarkets)) {
    const plan = bestModesFor(subset, constraints, costs, originalLanguage);
    if (plan && (!best || better(plan, best))) best = plan;
  }
  return { ...(best ?? emptyPlan()), excluded };
}

function bestModesFor(subset: CandidateMarket[], constraints: Constraints, costs: Record<string, LanguageCost>, originalLanguage: string): Plan | null {
  const langs = [...new Set(subset.map((m) => m.language).filter((l) => l !== originalLanguage))];
  const modeOptions: LocalizationMode[] = constraints.subtitleFirst ? ["subtitle"] : ["subtitle", "dub"];
  let best: Plan | null = null;
  for (const assignment of cartesian(langs.length, modeOptions)) {
    const languages = langs.map((language, i) => ({ language, mode: assignment[i], costUsd: assignment[i] === "dub" ? costs[language].dubUsd : costs[language].subtitleUsd }));
    const totalCostUsd = languages.reduce((s, l) => s + l.costUsd, 0);
    if (totalCostUsd > constraints.budgetUsd) continue;
    const modeOf = new Map(languages.map((l) => [l.language, l.mode]));
    const markets = subset.map((m) => {
      const mode: LocalizationMode = m.language === originalLanguage ? "original" : modeOf.get(m.language)!;
      return { code: m.code, name: m.name, language: m.language, mode, score: m.score!, value: round(m.score! * MODE_REACH[mode]) };
    });
    const plan = { markets, languages, totalCostUsd, totalValue: round(markets.reduce((s, m) => s + m.value, 0)), excluded: [] };
    if (!best || better(plan, best)) best = plan;
  }
  return best;
}

// Higher value wins; ties go to the cheaper plan, then fewer markets, then alphabetical codes (determinism).
function better(a: Plan, b: Plan): boolean {
  if (a.totalValue !== b.totalValue) return a.totalValue > b.totalValue;
  if (a.totalCostUsd !== b.totalCostUsd) return a.totalCostUsd < b.totalCostUsd;
  if (a.markets.length !== b.markets.length) return a.markets.length < b.markets.length;
  return key(a) < key(b);
}

const key = (p: Plan) => p.markets.map((m) => m.code).sort().join(",");
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const emptyPlan = (): Plan => ({ markets: [], languages: [], totalCostUsd: 0, totalValue: 0, excluded: [] });

function* subsetsUpTo<T>(items: T[], k: number): Generator<T[]> {
  const n = items.length;
  function* rec(start: number, acc: T[]): Generator<T[]> {
    if (acc.length > 0) yield acc;
    if (acc.length === k) return;
    for (let i = start; i < n; i++) yield* rec(i + 1, [...acc, items[i]]);
  }
  yield* rec(0, []);
}

function* cartesian<T>(len: number, options: T[]): Generator<T[]> {
  if (len === 0) {
    yield [];
    return;
  }
  for (const rest of cartesian(len - 1, options)) for (const o of options) yield [...rest, o];
}

/** Independent checker: re-validates a plan against constraints without trusting the builder. */
export function validatePlan(plan: Plan, constraints: Constraints, costs: Record<string, LanguageCost>, originalLanguage: string): string[] {
  const violations: string[] = [];
  if (plan.markets.length > constraints.maxMarkets) violations.push(`selects ${plan.markets.length} markets, max is ${constraints.maxMarkets}`);
  const recomputed = plan.languages.reduce((s, l) => s + (l.mode === "dub" ? costs[l.language]?.dubUsd ?? NaN : costs[l.language]?.subtitleUsd ?? NaN), 0);
  if (Math.abs(recomputed - plan.totalCostUsd) > 1e-6) violations.push(`cost mismatch: reported ${plan.totalCostUsd}, recomputed ${recomputed}`);
  if (plan.totalCostUsd > constraints.budgetUsd) violations.push(`cost ${plan.totalCostUsd} exceeds budget ${constraints.budgetUsd}`);
  for (const m of plan.markets) {
    if (constraints.excludedMarkets.includes(m.code)) violations.push(`excluded market ${m.code} selected`);
    if (m.language !== originalLanguage && constraints.excludedLanguages.includes(m.language)) violations.push(`excluded language ${m.language} used`);
    if (constraints.subtitleFirst && m.mode === "dub") violations.push(`${m.code} dubbed under subtitle-first`);
  }
  return violations;
}
