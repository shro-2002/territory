import type { MarketResearch, Revision, Session } from "../agent/agent";
import { marketByCode } from "./markets";
import type { LocalizationMode, Plan } from "./planner";

/**
 * Presentation-only derivations. Everything here is computed from a Session's plan, research and
 * constraints; nothing is estimated or invented. Markets are never graded "strong" or "weak": the score
 * is a relative taste-overlap ratio, so the UI states the ratio and how stable it is, nothing more.
 */

// 1× is the score's definition point (comps survive exactly as well as the genre baseline), not a tuned threshold.
const BASELINE = 1;
// Above this, "N× as much" reads more naturally than "N% more". Wording only.
const RATIO_WORDING = 2;

/** How the comps' overlap compares with the genre baseline across every leave-one-out baseline check. */
export type BaselineComparison = "above" | "mixed" | "below" | "unknown";
export type EvidenceStrength = "moderate" | "low" | "none";

export interface Reading {
  /** Plain-English ratio, e.g. "11% more of your comps' taste survives here than a typical genre's." */
  overlap: string;
  comparison: BaselineComparison;
  comparisonLabel: string;
}

const COMPARISON_LABEL: Record<BaselineComparison, string> = {
  above: "Above genre baseline in every check",
  mixed: "Depends on the baseline genre",
  below: "Below genre baseline in every check",
  unknown: "Not enough evidence to compare",
};

export function readingOf(r: Pick<MarketResearch, "score" | "scoreRange">): Reading {
  if (r.score === null) return { overlap: "Qloo returned too little overlapping data to read this market.", comparison: "unknown", comparisonLabel: COMPARISON_LABEL.unknown };
  const [lo, hi] = r.scoreRange ?? [r.score, r.score];
  const comparison: BaselineComparison = lo > BASELINE ? "above" : hi < BASELINE ? "below" : "mixed";
  const pct = Math.round(Math.abs(r.score - BASELINE) * 100);
  const overlap =
    r.score >= RATIO_WORDING ? `${r.score.toFixed(1)}× as much of your comps' taste survives here as a typical genre's.`
    : pct === 0 ? "About as much of your comps' taste survives here as a typical genre's."
    : `${pct}% ${r.score > BASELINE ? "more" : "less"} of your comps' taste survives here than a typical genre's.`;
  return { overlap, comparison, comparisonLabel: COMPARISON_LABEL[comparison] };
}

export function evidenceOf(r: Pick<MarketResearch, "confidence">): EvidenceStrength {
  return r.confidence ?? "none";
}

export const MODE_LABEL: Record<LocalizationMode, string> = { original: "Original language", subtitle: "Subtitles", dub: "Dubbing" };

export function formatLabel(mode: LocalizationMode, language: string): string {
  return mode === "original" ? "Original language — no localization" : `${MODE_LABEL[mode]} in ${language}`;
}

export interface StrategyItem {
  code: string;
  name: string;
  language: string;
  mode: LocalizationMode;
  formatLabel: string;
  score: number;
  reading: Reading;
  evidence: EvidenceStrength;
  scoreRange: [number, number] | null;
  localComps: string[];
  reason: string;
}

function costReason(m: Plan["markets"][number], plan: Plan): string {
  if (m.mode === "original") return "It plays in the original language, so it needs no localization spend.";
  const sharing = plan.markets.filter((x) => x.code !== m.code && x.language === m.language).map((x) => x.name);
  const what = `${MODE_LABEL[m.mode].toLowerCase()} in ${m.language}`;
  return sharing.length ? `It shares ${what} with ${sharing.join(" and ")}, so it adds no localization cost of its own.` : `The plan funds ${what} for it.`;
}

export function strategyItems(session: Session): StrategyItem[] {
  return session.plan.markets.map((m) => {
    const r = session.research[m.code];
    const reading = readingOf(r);
    return {
      code: m.code,
      name: m.name,
      language: m.language,
      mode: m.mode,
      formatLabel: formatLabel(m.mode, m.language),
      score: m.score,
      reading,
      evidence: evidenceOf(r),
      scoreRange: r.scoreRange,
      localComps: r.localNeighbours.slice(0, 3),
      reason: `${reading.overlap} ${costReason(m, session.plan)}`,
    };
  });
}

const listNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const overlaps = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1];

/** What the user should treat with care before acting. Derived, then topped up with standing caveats. */
export function uncertainties(session: Session): string[] {
  const out: string[] = [];
  const items = strategyItems(session);
  const low = items.filter((it) => it.evidence === "low").map((it) => it.name);
  if (low.length) out.push(`Low-confidence evidence for ${listNames(low)}: the ratio moves noticeably depending on which genre baseline is used.`);
  const tied = new Set<string>();
  for (let i = 0; i + 1 < items.length; i++) {
    const [a, b] = [items[i], items[i + 1]];
    if (a.scoreRange && b.scoreRange && overlaps(a.scoreRange, b.scoreRange)) tied.add(a.name).add(b.name);
  }
  if (tied.size) out.push(`The order of ${listNames([...tied])} is not meaningful: their score ranges overlap.`);
  for (const comp of session.comps) {
    if (comp.status === "ambiguous") out.push(`"${comp.input.name}" matches more than one title in Qloo; Territory used ${comp.name ?? "the closest match"}${comp.year ? ` (${comp.year})` : ""}. Add a release year to the brief to be sure.`);
    if (comp.status === "unresolved") out.push(`"${comp.input.name}" was not found in Qloo, so it did not shape any result.`);
  }
  for (const r of Object.values(session.research)) {
    if (r.score === null) out.push(`${marketByCode(r.code).name}: not enough Qloo evidence, so Territory will not plan it — this is a gap, not a rejection.`);
  }
  out.push("Every score is relative taste overlap. None of it says whether a buyer, screens or paying audience exist in a market.");
  out.push("An unreleased film is represented by its comps; different comps can change the shortlist.");
  return out;
}

export function nextSteps(session: Session): string[] {
  const top = session.plan.markets.slice(0, 3).map((m) => m.name);
  const thin = Object.values(session.research).filter((r) => r.score === null).map((r) => marketByCode(r.code).name);
  return [
    top.length ? `Pitch buyers in ${top.join(", ")} with the local comps shown for each market.` : "Loosen a constraint or try different comps, then re-run.",
    "Check rights availability and festival timing with a sales agent active in each territory.",
    "Replace the illustrative cost assumptions with real localization quotes and re-run.",
    ...(thin.length ? [`Gather market-specific evidence for ${thin.join(", ")} before ruling them out.`] : []),
  ];
}

export interface LanguageAction {
  language: string;
  mode: LocalizationMode;
  costUsd: number;
  share: number;
  markets: string[];
}

export interface DeferredOption {
  kind: "upgrade" | "excluded" | "unselected";
  title: string;
  detail: string;
  costUsd?: number;
}

export interface BudgetView {
  budget: number;
  planned: number;
  remaining: number;
  usedShare: number;
  actions: LanguageAction[];
  originalMarkets: string[];
  deferred: DeferredOption[];
}

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export function excludedReason(reason: string): string {
  if (reason === "market excluded by user") return "You removed this market.";
  if (reason.startsWith("language ")) return `You excluded ${reason.replace(/^language (.*) excluded by user$/, "$1")} localization.`;
  if (reason === "insufficient Qloo evidence") return "Not enough Qloo evidence to plan it.";
  if (reason.startsWith("no cost assumption")) return "No localization cost was entered for its language.";
  return "Outside the strongest candidates considered by the planner.";
}

export function budgetView(session: Session): BudgetView {
  const { plan, input, research } = session;
  const c = input.constraints;
  const planned = plan.totalCostUsd;
  const remaining = c.budgetUsd - planned;
  const actions = plan.languages.map((l) => ({
    language: l.language,
    mode: l.mode,
    costUsd: l.costUsd,
    share: planned > 0 ? l.costUsd / planned : 0,
    markets: plan.markets.filter((m) => m.language === l.language).map((m) => m.name),
  }));
  const deferred: DeferredOption[] = [];

  for (const l of plan.languages) {
    const cost = input.costs[l.language];
    if (l.mode !== "subtitle" || !cost) continue;
    const extra = cost.dubUsd - cost.subtitleUsd;
    deferred.push({
      kind: "upgrade",
      title: `Dubbing in ${l.language}`,
      costUsd: cost.dubUsd,
      detail: c.subtitleFirst ? "Switched off by your subtitle-first rule." : `Costs ${usd(extra)} more than subtitles; only ${usd(Math.max(remaining, 0))} is left, so it does not fit.`,
    });
  }
  for (const e of plan.excluded) {
    const m = marketByCode(e.code);
    deferred.push({ kind: "excluded", title: m.name, detail: excludedReason(e.reason) });
  }
  const capReached = plan.markets.length >= c.maxMarkets;
  const inPlan = new Set(plan.markets.map((m) => m.code));
  const excludedCodes = new Set(plan.excluded.map((e) => e.code));
  const paid = new Set(plan.languages.map((l) => l.language));
  for (const r of Object.values(research)) {
    if (r.score === null || inPlan.has(r.code) || excludedCodes.has(r.code)) continue;
    const m = marketByCode(r.code);
    const needsNew = m.language !== input.originalLanguage && !paid.has(m.language);
    const sub = input.costs[m.language]?.subtitleUsd;
    const parts = [capReached ? `Your ${c.maxMarkets}-market cap is reached and the selected markets add more together.` : "Adding it would cost more than the plan can absorb."];
    if (needsNew && sub !== undefined) parts.push(`${m.language} subtitles alone would add ${usd(sub)}.`);
    deferred.push({ kind: "unselected", title: `${m.name} · ${r.score.toFixed(2)}×`, detail: parts.join(" ") });
  }
  return { budget: c.budgetUsd, planned, remaining, usedShare: c.budgetUsd > 0 ? Math.min(1, planned / c.budgetUsd) : 0, actions, originalMarkets: plan.markets.filter((m) => m.mode === "original").map((m) => m.name), deferred };
}

export type RowChange = "kept" | "added" | "dropped" | "changed";

export interface CompareRow {
  code: string;
  name: string;
  change: RowChange;
  before: LocalizationMode | null;
  after: LocalizationMode | null;
  language: string;
}

/** One row per market that appears in either plan, ordered so the "after" plan reads top-down. */
export function compareRows(prev: Plan, next: Plan): CompareRow[] {
  const p = new Map(prev.markets.map((m) => [m.code, m]));
  const n = new Map(next.markets.map((m) => [m.code, m]));
  const rows: CompareRow[] = next.markets.map((m) => {
    const old = p.get(m.code);
    const change: RowChange = !old ? "added" : old.mode !== m.mode ? "changed" : "kept";
    return { code: m.code, name: m.name, change, before: old?.mode ?? null, after: m.mode, language: m.language };
  });
  for (const m of prev.markets) if (!n.has(m.code)) rows.push({ code: m.code, name: m.name, change: "dropped", before: m.mode, after: null, language: m.language });
  return rows;
}

export interface RevisionStats {
  reused: number;
  newlyResearched: number;
  retainedUnusable: number;
}

export function revisionStats(rev: Revision): RevisionStats {
  return { reused: rev.reusedMarkets.length - rev.retainedUnusable.length, newlyResearched: rev.newlyResearched.length, retainedUnusable: rev.retainedUnusable.length };
}
