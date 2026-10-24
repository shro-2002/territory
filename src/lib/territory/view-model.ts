import type { MarketResearch, Revision, Session } from "../agent/agent";
import type { ClaimStatus } from "./claim-check";
import { marketByCode } from "./markets";
import type { LocalizationMode, Plan } from "./planner";

/**
 * Presentation-only derivations. Everything here is computed from a Session's plan, research and
 * constraints; nothing is estimated or invented. Markets are never ranked or graded by Qloo evidence:
 * the plan follows the filmmaker's priority order and stated costs, and Qloo evidence is shown as
 * associations to investigate (general catalogue vs candidates that survive the claim check), never as demand.
 */

export const MODE_LABEL: Record<LocalizationMode, string> = { original: "Original language", subtitle: "Subtitles", dub: "Dubbing" };

export function formatLabel(mode: LocalizationMode, language: string): string {
  return mode === "original" ? "Original language — no localization" : `${MODE_LABEL[mode]} in ${language}`;
}

/** What Qloo surfaced for one market, as counts the UI can show without implying fit or demand. */
export interface EvidenceSummary {
  gap: string | null;
  titlesFound: number;
  catalogue: number;
  /** Claim-check outcome; null when the market has no claim check. */
  claim: ClaimStatus | null;
  /** Titles that survived every tested control: candidates to verify, never established local matches. */
  candidates: number;
}

export function evidenceSummary(r: MarketResearch | undefined): EvidenceSummary {
  if (!r) return { gap: "Not researched", titlesFound: 0, catalogue: 0, claim: null, candidates: 0 };
  return { gap: r.evidenceGap ?? null, titlesFound: r.titlesFound, catalogue: r.nearby.genericCount, claim: r.claimCheck?.status ?? null, candidates: r.claimCheck?.candidateCount ?? 0 };
}

export const CLAIM_BADGE: Record<ClaimStatus, (n: number) => string> = {
  verify: (n) => `${n} candidate${n === 1 ? "" : "s"} to verify`,
  none: () => "No local comparable established",
  insufficient: () => "Insufficient evidence",
};

/** One short line on what Qloo found, e.g. "67 of 100 associated titles are general catalogue here; 1 survives every tested control…" */
export function evidenceLine(e: EvidenceSummary): string {
  if (e.gap) return `Research gap: ${e.gap}.`;
  const base = `${e.catalogue} of ${e.titlesFound} associated titles are general catalogue here`;
  if (e.claim === "verify") return `${base}; ${e.candidates} survive${e.candidates === 1 ? "s" : ""} every tested control and need${e.candidates === 1 ? "s" : ""} human verification before being cited.`;
  if (e.claim === "none") return `${base}; none survives every tested control, so no local comparable is established (not proof that none exists).`;
  return `${base}; the claim check could not run in full, so no local comparable is claimed.`;
}

export interface StrategyItem {
  code: string;
  name: string;
  language: string;
  mode: LocalizationMode;
  formatLabel: string;
  /** 1-based position in the filmmaker's candidate list; null for a Territory-suggested reserve. */
  priority: number | null;
  evidence: EvidenceSummary;
  /** Claim-check candidates (at most a few): to verify, never established local matches. */
  candidates: string[];
  reason: string;
}

function costReason(m: Plan["markets"][number], plan: Plan): string {
  if (m.mode === "original") return "It plays in the original language, so it needs no localization spend.";
  const sharing = plan.markets.filter((x) => x.code !== m.code && x.language === m.language).map((x) => x.name);
  const what = `${MODE_LABEL[m.mode].toLowerCase()} in ${m.language}`;
  return sharing.length ? `It shares ${what} with ${sharing.join(" and ")}, so it adds no localization cost of its own.` : `The plan funds ${what} for it.`;
}

/** 1-based position on the filmmaker's candidate list, or null for a Territory-suggested reserve. */
export function candidateRank(session: Session, code: string): number | null {
  const i = session.input.targetMarkets.indexOf(code);
  return i >= 0 ? i + 1 : null;
}

function priorityReason(code: string, session: Session): string {
  const rank = candidateRank(session, code);
  return rank ? `#${rank} on your candidate list.` : "Suggested by Territory after a market was lost (same language or no localization cost), not by audience evidence.";
}

export function strategyItems(session: Session): StrategyItem[] {
  return session.plan.markets.map((m) => {
    const r = session.research[m.code];
    return {
      code: m.code,
      name: m.name,
      language: m.language,
      mode: m.mode,
      formatLabel: formatLabel(m.mode, m.language),
      priority: candidateRank(session, m.code),
      evidence: evidenceSummary(r),
      candidates: r?.claimCheck?.candidates.slice(0, 3).map((c) => c.name) ?? [],
      reason: `${priorityReason(m.code, session)} ${costReason(m, session.plan)}`,
    };
  });
}

const listNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** What the user should treat with care before acting. Derived, then topped up with standing caveats. */
export function uncertainties(session: Session): string[] {
  const out: string[] = [];
  const researched = Object.values(session.research);
  const gaps = researched.filter((r) => r.evidenceGap).map((r) => marketByCode(r.code).name);
  if (gaps.length) out.push(`Research gaps for ${listNames(gaps)}: Qloo associations could not be qualified there. That is missing evidence, not a reason to drop them.`);
  const unknownOrigin = researched.filter((r) => r.claimCheck?.candidates.some((c) => c.origin === "unknown")).map((r) => marketByCode(r.code).name);
  if (unknownOrigin.length) out.push(`Production origin was not recorded for some candidate titles in ${listNames(unknownOrigin)}, so local-origin links there are unverified.`);
  for (const comp of session.comps) {
    if (comp.status === "ambiguous") out.push(`"${comp.input.name}" matches more than one title in Qloo; Territory used ${comp.name ?? "the closest match"}${comp.year ? ` (${comp.year})` : ""}. Add a release year to the brief to be sure.`);
    if (comp.status === "unresolved") out.push(`"${comp.input.name}" was not found in Qloo, so it did not shape any result.`);
  }
  out.push("Most titles Qloo associates with your comps in a country are that country's general catalogue. A candidate only survived the tested controls: that is not proof it is specific to your film.");
  out.push("Nothing here measures audience preference, buyer interest or demand. Markets were chosen by your priority order and costs, not by Qloo.");
  out.push("An unreleased film is represented by its comps; different comps change every association.");
  return out;
}

/** Questions to investigate next, built from what Qloo did and did not surface for the planned markets. */
export function nextSteps(session: Session): string[] {
  const out: string[] = [];
  for (const m of session.plan.markets.slice(0, 3)) {
    const r = session.research[m.code];
    if (!r || r.evidenceGap) {
      out.push(`${m.name}: Qloo gave no qualified associations. What recent releases like your comps did local distributors acquire there?`);
      continue;
    }
    if (r.claimCheck) out.push(`${m.name}: ${r.claimCheck.action}`);
  }
  if (!session.plan.markets.length) out.push("Loosen a constraint or add candidate markets, then re-run.");
  out.push("Check rights availability and festival timing with a sales agent active in each territory.");
  out.push("Replace the illustrative cost assumptions with real localization quotes and re-run.");
  return out;
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
  if (reason.startsWith("no cost assumption")) return "No localization cost was entered for its language.";
  return "Beyond the candidates the planner considers.";
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
    if (inPlan.has(r.code) || excludedCodes.has(r.code)) continue;
    const m = marketByCode(r.code);
    const needsNew = m.language !== input.originalLanguage && !paid.has(m.language);
    const sub = input.costs[m.language]?.subtitleUsd;
    const parts = [capReached ? `Your ${c.maxMarkets}-market cap is reached by markets higher on your list.` : "Adding it would cost more than the plan can absorb."];
    if (needsNew && sub !== undefined) parts.push(`${m.language} subtitles alone would add ${usd(sub)}.`);
    const rank = candidateRank(session, r.code);
    deferred.push({ kind: "unselected", title: rank ? `${m.name} · #${rank} on your list` : `${m.name} · suggested reserve`, detail: parts.join(" ") });
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
