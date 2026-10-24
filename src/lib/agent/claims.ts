import type { CallRecord } from "../qloo/types";
import { marketByCode } from "../territory/markets";
import { catalogueSentence, internationalSentence, localOriginSentence } from "../territory/nearby-titles";
import type { LocalizationMode, Plan } from "../territory/planner";
import type { AgentInput, MarketResearch } from "./agent";
import type { ResolvedComp } from "./resolve";

export type Provenance = "qloo" | "external" | "user" | "hypothesis" | "insufficient";

export interface Claim {
  id: string;
  text: string;
  provenance: Provenance;
  /** Qloo call ids backing a "qloo" claim; required for that provenance. */
  callIds: string[];
  /** "mock" when backing calls hit the mock backend: such claims are never live evidence. */
  source?: "live" | "mock";
}

interface ClaimContext {
  input: AgentInput;
  comps: ResolvedComp[];
  research: Record<string, MarketResearch>;
  plan: Plan;
  calls: CallRecord[];
  modeReach: Record<LocalizationMode, number>;
}

/** Deterministic claim ledger. Every sentence the report shows comes from here, tagged with provenance. */
export function claimsFor({ input, comps, research, plan, calls, modeReach }: ClaimContext): Claim[] {
  const claims: Claim[] = [];
  const source = calls[0]?.source;
  const add = (text: string, provenance: Provenance, callIds: string[] = []) => claims.push({ id: `c${claims.length + 1}`, text, provenance, callIds, ...(provenance === "qloo" ? { source } : {}) });

  add(`"${input.title}" is unreleased; it is represented only by ${input.comps.length} user-chosen comparable titles.`, "user");
  for (const c of comps) {
    if (c.status === "unresolved") add(`Comp "${c.input.name}" was not found in Qloo and is not used.`, "insufficient", c.callId ? [c.callId] : []);
    else if (c.status === "ambiguous") add(`Comp "${c.input.name}" matched several Qloo entities; using ${c.name}${c.year ? ` (${c.year})` : ""}. This choice is a guess until a year is given.`, "hypothesis", c.callId ? [c.callId] : []);
    else add(`Comp "${c.input.name}" resolved to Qloo entity ${c.name}${c.year ? ` (${c.year})` : ""}.`, "qloo", c.callId ? [c.callId] : []);
  }
  for (const r of Object.values(research)) {
    const name = marketByCode(r.code).name;
    const ids = r.callIds;
    if (r.evidenceGap) {
      add(`${name}: research gap — ${r.evidenceGap}. This is missing evidence, not a reason to drop the market.`, "insufficient", ids);
      continue;
    }
    const n = r.nearby;
    add(`${name}: ${catalogueSentence(n, name)}${r.fallback ? " (after adding substitute comps)" : ""}`, "qloo", ids);
    add(`${name}: ${localOriginSentence(n, name)}`, n.counts.localOrigin ? "qloo" : "insufficient", ids);
    if (n.counts.international) add(`${name}: ${internationalSentence(n)}`, "qloo", ids);
  }
  if (plan.markets.length) add(`Markets were chosen from your candidate list in your priority order, within the budget and cap. Qloo evidence did not rank or select them.`, "user");
  for (const l of plan.languages) add(`${l.language} ${l.mode} costs $${l.costUsd.toLocaleString("en-US")} (user cost assumption).`, "user");
  add(`Budget $${input.constraints.budgetUsd.toLocaleString("en-US")}, at most ${input.constraints.maxMarkets} markets${input.constraints.subtitleFirst ? ", subtitle-first" : ""}.`, "user");
  if (plan.languages.length) add(`Subtitles are assumed to reach ${Math.round(modeReach.subtitle * 100)}% of the value of a dub. This weighting is a model assumption, not measured.`, "hypothesis");
  add("No claim here estimates box office, viewers, revenue or audience preference: Qloo associations are related titles, not demand.", "insufficient");
  return claims;
}

export function assertClaimsGrounded(claims: Claim[]): string[] {
  return claims.filter((c) => c.provenance === "qloo" && c.callIds.length === 0).map((c) => `${c.id} is tagged qloo but cites no call`);
}
