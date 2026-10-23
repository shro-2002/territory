import { z } from "zod";

import type { QlooClient } from "../qloo/client";
import { MARKETS, marketByCode, REFERENCE_SETS } from "../territory/markets";
import { buildPlan, Constraints, ConstraintsSchema, LanguageCostSchema, MODE_REACH, Plan, validatePlan } from "../territory/planner";
import { Claim, claimsFor } from "./claims";
import { buildContext, MarketResearch, ResearchContext, researchMarket, substituteContext } from "./research";
import { resolveComp, ResolvedComp } from "./resolve";

export type { MarketResearch } from "./research";

export const AgentInputSchema = z.object({
  title: z.string().min(1).max(120),
  synopsis: z.string().max(2000).default(""),
  genre: z.string().max(80).default(""),
  originalLanguage: z.string().min(1).max(40),
  comps: z.array(z.object({ name: z.string().min(1).max(120), year: z.number().int().min(1900).max(2100).optional() })).min(3).max(6),
  targetMarkets: z.array(z.string().length(2)).min(1).max(12),
  costs: z.record(z.string(), LanguageCostSchema),
  constraints: ConstraintsSchema,
});
export type AgentInput = z.infer<typeof AgentInputSchema>;

export type AgentState =
  | "INPUT_VALIDATION" | "ENTITY_RESOLUTION" | "RESEARCH_PLANNING" | "QLOO_INVESTIGATION" | "EVIDENCE_VERIFICATION"
  | "STRATEGY_CONSTRUCTION" | "CONSTRAINT_VALIDATION" | "FINAL_REPORT"
  | "IMPACT_ANALYSIS" | "SELECTIVE_RESEARCH" | "STRATEGY_REVISION" | "VERIFICATION";

export interface TraceEvent {
  state: AgentState;
  message: string;
  callIds?: string[];
  at: number;
  /** Intermediate progress inside a state (e.g. one market finished). */
  kind?: "progress";
  /** Market code a progress event refers to. */
  market?: string;
}

export interface Session {
  version: number;
  input: AgentInput;
  comps: ResolvedComp[];
  context: ResearchContext | null;
  research: Record<string, MarketResearch>;
  plan: Plan;
  violations: string[];
  claims: Claim[];
  trace: TraceEvent[];
  status: "complete" | "degraded" | "failed";
  revisions: Revision[];
}

/** What drove a change: Qloo taste evidence, money, or a hard user constraint. */
export type ChangeDriver = "cultural-evidence" | "cost" | "constraint";

export interface PlanChange {
  text: string;
  driver: ChangeDriver | "summary";
}

/** One agent decision about which tool to use (or not) during a revision, with its reason. */
export interface ToolDecision {
  action: "reuse_evidence" | "research_reserve_markets" | "skip_research";
  reason: string;
  markets?: string[];
}

export interface Revision {
  version: number;
  constraints: Constraints;
  invalidated: string[];
  reusedMarkets: string[];
  newlyResearched: string[];
  /** Prior evidence that is still valid but no longer usable (e.g. excluded market). */
  retainedUnusable: string[];
  decisions: ToolDecision[];
  changes: PlanChange[];
}

// Worst case: 12 markets x 10 calls + comps/baselines + fallback retries ≈ 200.
export const LIMITS = { maxQlooCalls: 220, maxReserveResearch: 3, maxFallbackMarkets: 4 } as const;

class Tracer {
  readonly events: TraceEvent[] = [];
  constructor(private readonly client: QlooClient, private readonly onEvent?: (e: TraceEvent) => void) {}
  private mark = 0;
  /** Progress events cite only their own market's calls (markets run in parallel); state events cite every call since the last state. */
  log(state: AgentState, message: string, kind?: "progress", market?: string, ownCallIds?: string[]) {
    const callIds = kind === "progress" ? (ownCallIds ?? []) : this.client.calls.slice(this.mark).map((c) => c.id);
    if (kind !== "progress") this.mark = this.client.calls.length;
    const e = { state, message, at: Date.now(), ...(callIds.length ? { callIds } : {}), ...(kind ? { kind } : {}), ...(market ? { market } : {}) };
    this.events.push(e);
    this.onEvent?.(e);
  }
}

export interface AgentDeps {
  client: QlooClient;
  onEvent?: (e: TraceEvent) => void;
}

export async function runAgent(rawInput: unknown, { client, onEvent }: AgentDeps): Promise<Session> {
  const t = new Tracer(client, onEvent);
  const parsed = AgentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const input = parsed.data;
  const unknownMarkets = input.targetMarkets.filter((c) => !MARKETS.some((m) => m.code === c));
  if (unknownMarkets.length) throw new Error(`Unsupported market codes: ${unknownMarkets.join(", ")}`);
  t.log("INPUT_VALIDATION", `"${input.title}": ${input.comps.length} comps, ${input.targetMarkets.length} candidate markets, budget $${input.constraints.budgetUsd.toLocaleString("en-US")}`);

  let comps: ResolvedComp[];
  try {
    comps = await Promise.all(input.comps.map((c) => resolveComp(client, c)));
  } catch (err) {
    t.log("ENTITY_RESOLUTION", `Could not look up the comps in Qloo (${(err as Error).message.slice(0, 160)}). No strategy produced.`);
    return failedSession(input, [], t);
  }
  const usable = comps.filter((c) => c.entityId);
  t.log("ENTITY_RESOLUTION", comps.map((c) => `${c.input.name} → ${c.status}${c.name ? ` (${c.name}${c.year ? `, ${c.year}` : ""})` : ""}`).join("; "));
  if (usable.length === 0) {
    t.log("FINAL_REPORT", "No comparable title could be resolved in Qloo; cannot research markets. Try different comps.");
    return failedSession(input, comps, t);
  }

  const markets = input.targetMarkets.filter((c) => !input.constraints.excludedMarkets.includes(c));
  let context: ResearchContext;
  try {
    context = await buildContext(client, usable.map((c) => c.entityId!));
  } catch (err) {
    t.log("RESEARCH_PLANNING", `Qloo research unavailable (${(err as Error).message.slice(0, 160)}). No strategy produced; retry later or open the cached showcase.`);
    return failedSession(input, comps, t);
  }
  const refsOk = context.references.filter((r) => r.globalIds.length).length;
  t.log("RESEARCH_PLANNING", `Comps' global taste neighbourhood: ${context.global.ids.length} titles. Reference genre baselines: ${refsOk}/${REFERENCE_SETS.length}. Plan: comps + baselines conditioned on each of ${markets.length} markets (${input.targetMarkets.length - markets.length} skipped as excluded).`);
  if (context.global.ids.length === 0) {
    t.log("FINAL_REPORT", "Qloo returned no related titles for these comps; market research is impossible. Try better-known comps.");
    return failedSession(input, comps, t);
  }

  const research: Record<string, MarketResearch> = {};
  await researchMarkets(client, markets, context, research, (r) => t.log("QLOO_INVESTIGATION", marketLine(r), "progress", r.code, r.callIds));
  t.log("QLOO_INVESTIGATION", summarizeResearch(markets, research));

  await verifyAndFallback(client, research, context, t);

  return finish(input, comps, context, research, t, client, []);
}

async function researchMarkets(client: QlooClient, codes: string[], ctx: ResearchContext, into: Record<string, MarketResearch>, onDone?: (r: MarketResearch) => void) {
  await Promise.all(
    codes.map(async (code) => {
      into[code] = await researchMarket(client, code, ctx);
      onDone?.(into[code]);
    }),
  );
}

function marketLine(r: MarketResearch) {
  const name = marketByCode(r.code).name;
  return r.score === null ? `${name}: insufficient — ${r.insufficientReason}` : `${name}: ${r.overlap}/100 neighbours survive, ${r.score.toFixed(2)}× reference genres`;
}

/** Thin evidence → widen comps with the comps' closest Qloo titles and retry those markets, once. */
async function verifyAndFallback(client: QlooClient, research: Record<string, MarketResearch>, ctx: ResearchContext, t: Tracer) {
  const thin = Object.values(research).filter((r) => r.score === null && !r.insufficientReason?.startsWith("query failed")).slice(0, LIMITS.maxFallbackMarkets);
  if (thin.length === 0) {
    t.log("EVIDENCE_VERIFICATION", "Every researched market has enough overlapping titles and a reference baseline.");
    return;
  }
  const widened = await substituteContext(client, ctx);
  if (!widened) {
    t.log("EVIDENCE_VERIFICATION", `${thin.map((r) => r.code).join(", ")}: insufficient evidence and no substitute comps available. Marked unsupported.`);
    return;
  }
  for (const r of thin) {
    const retry = await researchMarket(client, r.code, widened.ctx);
    research[r.code] = { ...retry, fallback: `original comps thin (${r.insufficientReason}); added ${widened.added.join(", ")}` };
  }
  t.log("EVIDENCE_VERIFICATION", `Thin evidence in ${thin.map((r) => r.code).join(", ")}; retried with Qloo's closest titles (${widened.added.join(", ")}). Now: ${thin.map((r) => `${r.code} ${research[r.code].score === null ? "still insufficient" : "supported"}`).join(", ")}.`);
}

function finish(input: AgentInput, comps: ResolvedComp[], context: ResearchContext, research: Record<string, MarketResearch>, t: Tracer, client: QlooClient, revisions: Revision[], version = 1): Session {
  const candidates = Object.values(research).map((r) => ({ ...marketByCode(r.code), score: r.score }));
  const plan = buildPlan({ candidates, constraints: input.constraints, costs: input.costs, originalLanguage: input.originalLanguage });
  t.log(version === 1 ? "STRATEGY_CONSTRUCTION" : "STRATEGY_REVISION", plan.markets.length ? `Selected ${plan.markets.map((m) => `${m.code} (${m.mode})`).join(", ")} for $${plan.totalCostUsd.toLocaleString("en-US")}` : "No market satisfies the constraints with sufficient evidence.");
  const violations = validatePlan(plan, input.constraints, input.costs, input.originalLanguage);
  t.log(version === 1 ? "CONSTRAINT_VALIDATION" : "VERIFICATION", violations.length ? `VIOLATIONS: ${violations.join("; ")}` : "Independent check passed: budget, market cap, exclusions and subtitle rule satisfied.");
  const claims = claimsFor({ input, comps, research, plan, calls: client.calls, modeReach: MODE_REACH });
  const supported = Object.values(research).filter((r) => r.score !== null).length;
  t.log("FINAL_REPORT", `${claims.length} claims: ${countBy(claims)}. ${supported}/${Object.keys(research).length} markets supported by Qloo evidence.`);
  return {
    version, input, comps, context, research, plan, violations, claims, trace: t.events, revisions,
    status: violations.length ? "failed" : supported < Object.keys(research).length || comps.some((c) => c.status !== "resolved") ? "degraded" : "complete",
  };
}

function failedSession(input: AgentInput, comps: ResolvedComp[], t: Tracer): Session {
  return { version: 1, input, comps, context: null, research: {}, plan: { markets: [], languages: [], totalCostUsd: 0, totalValue: 0, excluded: [] }, violations: [], claims: [], trace: t.events, status: "failed", revisions: [] };
}

/**
 * Distribution War Room: apply new constraints to an existing session.
 * Reuses prior research, invalidates only affected decisions, researches reserve markets when
 * the change removes something the plan relied on, then rebuilds and re-verifies.
 */
export async function replan(session: Session, patch: Partial<Constraints>, { client, onEvent }: AgentDeps): Promise<Session> {
  const t = new Tracer(client, onEvent);
  if (!session.context) throw new Error("Cannot replan a session whose research failed");
  const before = session.input.constraints;
  const after = ConstraintsSchema.parse({ ...before, ...patch });
  const input = { ...session.input, constraints: after };
  const usable = (m: { code: string; language: string }) => !after.excludedMarkets.includes(m.code) && !(m.language !== input.originalLanguage && after.excludedLanguages.includes(m.language));

  const invalidated: string[] = [];
  for (const m of session.plan.markets) {
    if (after.excludedMarkets.includes(m.code)) invalidated.push(`${m.name}: market now excluded`);
    else if (m.language !== input.originalLanguage && after.excludedLanguages.includes(m.language)) invalidated.push(`${m.name}: ${m.language} now excluded`);
    else if (after.subtitleFirst && m.mode === "dub") invalidated.push(`${m.name}: dub not allowed under subtitle-first`);
  }
  if (after.budgetUsd < session.plan.totalCostUsd) invalidated.push(`spend $${session.plan.totalCostUsd.toLocaleString("en-US")} exceeds new budget $${after.budgetUsd.toLocaleString("en-US")}`);
  if (after.maxMarkets < session.plan.markets.length) invalidated.push(`${session.plan.markets.length} markets exceed new cap of ${after.maxMarkets}`);
  // Evidence is about taste, so constraint changes never invalidate it; excluded markets keep valid but unusable evidence.
  const researched = Object.keys(session.research);
  const retainedUnusable = researched.filter((c) => !usable(marketByCode(c)));
  t.log("IMPACT_ANALYSIS", `${invalidated.length ? `Invalidated: ${invalidated.join("; ")}.` : "No current decision is invalidated."} Evidence for all ${researched.length} researched markets stays valid (taste evidence does not depend on budget or exclusions)${retainedUnusable.length ? `; ${retainedUnusable.join(", ")} retained but unusable` : ""}.`);

  const decisions: ToolDecision[] = [{ action: "reuse_evidence", reason: "constraint changes do not alter Qloo taste evidence", markets: researched.filter((c) => !retainedUnusable.includes(c)) }];
  const lost = session.plan.markets.filter((m) => !usable(m));
  const usableCandidates = researched.filter((c) => !retainedUnusable.includes(c) && session.research[c].score !== null);
  const needMore = lost.length > 0 && usableCandidates.length < after.maxMarkets + lost.length;
  const research = { ...session.research };
  let newlyResearched: string[] = [];
  if (lost.length === 0) {
    decisions.push({ action: "skip_research", reason: "no planned market was removed; the change only needs re-optimization over existing evidence" });
  } else {
    const reserves = rankReserves(session, after, lost).slice(0, LIMITS.maxReserveResearch);
    if (reserves.length === 0) decisions.push({ action: "skip_research", reason: "no unresearched reserve market is eligible under the new constraints" });
    else {
      decisions.push({ action: "research_reserve_markets", reason: `${lost.map((m) => m.name).join(", ")} lost${needMore ? " and too few eligible researched markets remain" : ""}; replacements ranked by ${reserves.map((r) => `${marketByCode(r.code).name} (${r.why})`).join(", ")}`, markets: reserves.map((r) => r.code) });
      newlyResearched = reserves.map((r) => r.code);
      await researchMarkets(client, newlyResearched, session.context, research, (r) => t.log("SELECTIVE_RESEARCH", `Reserve ${marketLine(r)}`, "progress", r.code, r.callIds));
    }
  }
  t.log("SELECTIVE_RESEARCH", decisions.slice(1).map((d) => `${d.action === "skip_research" ? "No new Qloo research" : `Researched ${d.markets!.join(", ")}`}: ${d.reason}.`).join(" "));

  const revised = finish(input, session.comps, session.context, research, t, client, session.revisions, session.version + 1);
  const changes = diffPlans(session.plan, revised.plan, { before, after, newlyResearched });
  const revision: Revision = { version: revised.version, constraints: after, invalidated, reusedMarkets: researched, newlyResearched, retainedUnusable, decisions, changes };
  return { ...revised, trace: [...session.trace, ...revised.trace], revisions: [...session.revisions, revision] };
}

/**
 * Which unresearched markets could replace what was lost. Conditional on the loss:
 * same language as a lost market first (audience and localization carry over), then languages
 * already paid for in the plan, then the film's original language (no localization cost).
 */
function rankReserves(session: Session, after: Constraints, lost: Array<{ language: string }>): Array<{ code: string; why: string }> {
  const lostLangs = new Set(lost.map((m) => m.language));
  const paidLangs = new Set(session.plan.markets.filter((m) => m.mode !== "original" && !lostLangs.has(m.language)).map((m) => m.language));
  const original = session.input.originalLanguage;
  const tier = (lang: string) => (lostLangs.has(lang) && !after.excludedLanguages.includes(lang) ? 0 : paidLangs.has(lang) ? 1 : lang === original ? 2 : 3);
  const WHY = ["same language as the lost market", "language already paid for", "original language, no localization cost", "other eligible market"];
  return MARKETS.filter((m) => !session.research[m.code] && !after.excludedMarkets.includes(m.code) && !(m.language !== original && after.excludedLanguages.includes(m.language)))
    .map((m) => ({ code: m.code, tier: tier(m.language) }))
    .sort((a, b) => a.tier - b.tier || a.code.localeCompare(b.code))
    .map((r) => ({ code: r.code, why: WHY[r.tier] }));
}

export function diffPlans(prev: Plan, next: Plan, ctx?: { before: Constraints; after: Constraints; newlyResearched: string[] }): PlanChange[] {
  const changes: PlanChange[] = [];
  const p = new Map(prev.markets.map((m) => [m.code, m]));
  const n = new Map(next.markets.map((m) => [m.code, m]));
  const tighterBudget = ctx ? ctx.after.budgetUsd < ctx.before.budgetUsd : false;
  const tighterCap = ctx ? ctx.after.maxMarkets < ctx.before.maxMarkets : false;
  const paidBefore = new Set(prev.languages.map((l) => l.language));
  for (const [code, m] of p) {
    if (n.has(code)) continue;
    const excluded = next.excluded.find((e) => e.code === code);
    if (ctx?.after.excludedMarkets.includes(code) || ctx?.after.excludedLanguages.includes(m.language)) changes.push({ text: `Dropped ${m.name} — ${excluded?.reason ?? "excluded"}`, driver: "constraint" });
    else if (tighterCap) changes.push({ text: `Dropped ${m.name} — lowest value under the tighter ${ctx!.after.maxMarkets}-market cap`, driver: "constraint" });
    else if (tighterBudget) changes.push({ text: `Dropped ${m.name} — after the budget cut, ${m.language} localization buys less value than the alternatives`, driver: "cost" });
    else changes.push({ text: `Dropped ${m.name} — outscored by a market with stronger taste evidence`, driver: "cultural-evidence" });
  }
  for (const [code, m] of n) {
    const old = p.get(code);
    const cost = m.mode === "original" ? "no localization cost" : `${m.mode} in ${m.language}`;
    if (!old) {
      const fresh = ctx?.newlyResearched.includes(code);
      // Zero marginal localization cost (original language, or a language the plan already pays for) under a tighter budget is a cost-driven pick.
      const freeRide = m.mode === "original" || paidBefore.has(m.language);
      const driver: ChangeDriver = tighterBudget && freeRide && !fresh ? "cost" : "cultural-evidence";
      const why = driver === "cost" ? (m.mode === "original" ? "no localization cost" : `${m.language} ${m.mode} already paid for`) : cost;
      changes.push({ text: `Added ${m.name} — ${m.score.toFixed(2)}× taste lift${fresh ? " (researched for this revision)" : ""}, ${why}`, driver });
    } else if (old.mode !== m.mode) {
      changes.push({ text: `${m.name}: ${old.mode} → ${m.mode}${modeReason(old.mode, m.mode, ctx?.after)}`, driver: ctx?.after.subtitleFirst && m.mode === "subtitle" ? "constraint" : "cost" });
    }
  }
  if (prev.totalCostUsd !== next.totalCostUsd) changes.push({ text: `Spend $${prev.totalCostUsd.toLocaleString("en-US")} → $${next.totalCostUsd.toLocaleString("en-US")}`, driver: "summary" });
  return changes.length ? changes : [{ text: "No change: the previous plan remains optimal under the new constraints", driver: "summary" }];
}

function modeReason(from: string, to: string, after?: Constraints) {
  if (after?.subtitleFirst && to === "subtitle") return " (subtitle-first rule)";
  if (from === "dub" && to === "subtitle") return " to fit the budget";
  if (from === "subtitle" && to === "dub") return " — budget now allows a dub";
  return "";
}

function summarizeResearch(codes: string[], research: Record<string, MarketResearch>) {
  return codes.map((c) => `${c} ${research[c].score === null ? "insufficient" : `${research[c].score!.toFixed(2)}×`}`).join(", ");
}

function countBy(claims: Claim[]) {
  const counts = new Map<string, number>();
  for (const c of claims) counts.set(c.provenance, (counts.get(c.provenance) ?? 0) + 1);
  return [...counts].map(([k, v]) => `${v} ${k}`).join(", ");
}
