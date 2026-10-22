import { z } from "zod";

import type { QlooClient } from "../qloo/client";
import { QlooError } from "../qloo/types";
import { computeMarketSignal, MarketSignal } from "../territory/market-signal";
import { ANCHOR_TITLES, MARKETS, marketByCode } from "../territory/markets";
import { buildPlan, Constraints, ConstraintsSchema, LanguageCostSchema, MODE_REACH, Plan, validatePlan } from "../territory/planner";
import { Claim, claimsFor } from "./claims";
import { resolveComp, ResolvedComp } from "./resolve";

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
}

export interface MarketResearch extends MarketSignal {
  code: string;
  callId?: string;
  /** Comps used for this market; differs from the run's comps after a fallback. */
  compIds: string[];
  fallback?: string;
}

export interface Session {
  version: number;
  input: AgentInput;
  comps: ResolvedComp[];
  anchors: ResolvedComp[];
  research: Record<string, MarketResearch>;
  plan: Plan;
  violations: string[];
  claims: Claim[];
  trace: TraceEvent[];
  status: "complete" | "degraded" | "failed";
  revisions: Revision[];
}

export interface Revision {
  version: number;
  constraints: Constraints;
  invalidated: string[];
  reusedMarkets: string[];
  newlyResearched: string[];
  changes: string[];
}

export const LIMITS = { maxQlooCalls: 80, maxReserveResearch: 3, maxFallbackMarkets: 4 } as const;
const INSIGHTS_TAKE = 50;
const SUBSTITUTE_COMPS = 3;

class Tracer {
  readonly events: TraceEvent[] = [];
  constructor(private readonly client: QlooClient, private readonly onEvent?: (e: TraceEvent) => void) {}
  private mark = 0;
  log(state: AgentState, message: string) {
    const callIds = this.client.calls.slice(this.mark).map((c) => c.id);
    this.mark = this.client.calls.length;
    const e = { state, message, at: Date.now(), ...(callIds.length ? { callIds } : {}) };
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

  const comps = await Promise.all(input.comps.map((c) => resolveComp(client, c)));
  const usable = comps.filter((c) => c.entityId);
  t.log("ENTITY_RESOLUTION", comps.map((c) => `${c.input.name} → ${c.status}${c.name ? ` (${c.name}${c.year ? `, ${c.year}` : ""})` : ""}`).join("; "));
  if (usable.length === 0) {
    t.log("FINAL_REPORT", "No comparable title could be resolved in Qloo; cannot research markets. Try different comps.");
    return failedSession(input, comps, t);
  }

  const anchors = await Promise.all(ANCHOR_TITLES.map((name) => resolveComp(client, { name })));
  const anchorIds = anchors.filter((a) => a.status !== "unresolved").map((a) => a.entityId!);
  const markets = input.targetMarkets.filter((c) => !input.constraints.excludedMarkets.includes(c));
  t.log("RESEARCH_PLANNING", `Reference panel: ${anchorIds.length}/${ANCHOR_TITLES.length} titles resolved. Plan: 1 location-conditioned query per market for ${markets.length} markets (${input.targetMarkets.length - markets.length} skipped as excluded).`);

  const research: Record<string, MarketResearch> = {};
  const compIds = usable.map((c) => c.entityId!);
  await researchMarkets(client, markets, compIds, anchorIds, research);
  t.log("QLOO_INVESTIGATION", summarizeResearch(markets, research));

  await verifyAndFallback(client, research, compIds, anchorIds, t);

  return finish(input, comps, anchors, research, t, client, []);
}

async function researchMarkets(client: QlooClient, codes: string[], compIds: string[], anchorIds: string[], into: Record<string, MarketResearch>) {
  await Promise.all(
    codes.map(async (code) => {
      into[code] = await researchMarket(client, code, compIds, anchorIds);
    }),
  );
}

async function researchMarket(client: QlooClient, code: string, compIds: string[], anchorIds: string[]): Promise<MarketResearch> {
  const market = marketByCode(code);
  try {
    const res = await client.insights({
      "filter.type": "urn:entity:movie",
      "signal.location.query": market.locationQuery,
      "filter.results.entities": [...new Set([...compIds, ...anchorIds])].join(","),
      take: INSIGHTS_TAKE,
    });
    const rows = (res.results?.entities ?? []).filter((e) => typeof e.query?.affinity === "number").map((e) => ({ entityId: e.entity_id, affinity: e.query!.affinity! }));
    return { code, callId: client.calls.at(-1)?.id, compIds, ...computeMarketSignal(rows, compIds, anchorIds) };
  } catch (err) {
    const reason = err instanceof QlooError ? `${err.code}: ${err.message}` : String(err);
    return { code, callId: client.calls.at(-1)?.id, compIds, score: null, compsFound: 0, compsRequested: compIds.length, anchorsFound: 0, perComp: [], insufficientReason: `query failed (${reason})` };
  }
}

/** Thin evidence → switch to Qloo-suggested substitute comps for that market, once. */
async function verifyAndFallback(client: QlooClient, research: Record<string, MarketResearch>, compIds: string[], anchorIds: string[], t: Tracer) {
  const thin = Object.values(research).filter((r) => r.score === null && !r.insufficientReason?.startsWith("query failed")).slice(0, LIMITS.maxFallbackMarkets);
  if (thin.length === 0) {
    t.log("EVIDENCE_VERIFICATION", "All researched markets returned enough comps and reference titles.");
    return;
  }
  const related = await client.insights({ "filter.type": "urn:entity:movie", "signal.interests.entities": compIds.join(","), take: SUBSTITUTE_COMPS + compIds.length + anchorIds.length });
  const substitutes = (related.results?.entities ?? []).map((e) => e.entity_id).filter((id) => !compIds.includes(id) && !anchorIds.includes(id)).slice(0, SUBSTITUTE_COMPS);
  if (substitutes.length === 0) {
    t.log("EVIDENCE_VERIFICATION", `${thin.map((r) => r.code).join(", ")}: insufficient evidence and Qloo suggested no substitute comps. Marked unsupported.`);
    return;
  }
  for (const r of thin) {
    const retry = await researchMarket(client, r.code, [...compIds, ...substitutes], anchorIds);
    research[r.code] = { ...retry, fallback: `original comps thin (${r.insufficientReason}); added ${substitutes.length} Qloo-related titles` };
  }
  t.log("EVIDENCE_VERIFICATION", `Thin evidence in ${thin.map((r) => r.code).join(", ")}; retried with ${substitutes.length} substitute comps from Qloo. Now: ${thin.map((r) => `${r.code} ${research[r.code].score === null ? "still insufficient" : "supported"}`).join(", ")}.`);
}

function finish(input: AgentInput, comps: ResolvedComp[], anchors: ResolvedComp[], research: Record<string, MarketResearch>, t: Tracer, client: QlooClient, revisions: Revision[], version = 1): Session {
  const candidates = Object.values(research).map((r) => ({ ...marketByCode(r.code), score: r.score }));
  const plan = buildPlan({ candidates, constraints: input.constraints, costs: input.costs, originalLanguage: input.originalLanguage });
  t.log(version === 1 ? "STRATEGY_CONSTRUCTION" : "STRATEGY_REVISION", plan.markets.length ? `Selected ${plan.markets.map((m) => `${m.code} (${m.mode})`).join(", ")} for $${plan.totalCostUsd.toLocaleString("en-US")}` : "No market satisfies the constraints with sufficient evidence.");
  const violations = validatePlan(plan, input.constraints, input.costs, input.originalLanguage);
  t.log(version === 1 ? "CONSTRAINT_VALIDATION" : "VERIFICATION", violations.length ? `VIOLATIONS: ${violations.join("; ")}` : "Independent check passed: budget, market cap, exclusions and subtitle rule satisfied.");
  const claims = claimsFor({ input, comps, research, plan, calls: client.calls, modeReach: MODE_REACH });
  const supported = Object.values(research).filter((r) => r.score !== null).length;
  t.log("FINAL_REPORT", `${claims.length} claims: ${countBy(claims)}. ${supported}/${Object.keys(research).length} markets supported by Qloo evidence.`);
  return {
    version, input, comps, anchors, research, plan, violations, claims, trace: t.events, revisions,
    status: violations.length ? "failed" : supported < Object.keys(research).length || comps.some((c) => c.status !== "resolved") ? "degraded" : "complete",
  };
}

function failedSession(input: AgentInput, comps: ResolvedComp[], t: Tracer): Session {
  return { version: 1, input, comps, anchors: [], research: {}, plan: { markets: [], languages: [], totalCostUsd: 0, totalValue: 0, excluded: [] }, violations: [], claims: [], trace: t.events, status: "failed", revisions: [] };
}

/**
 * Distribution War Room: apply new constraints to an existing session.
 * Reuses prior research, invalidates only affected decisions, researches reserve markets when
 * the change removes something the plan relied on, then rebuilds and re-verifies.
 */
export async function replan(session: Session, patch: Partial<Constraints>, { client, onEvent }: AgentDeps): Promise<Session> {
  const t = new Tracer(client, onEvent);
  const before = session.input.constraints;
  const after = ConstraintsSchema.parse({ ...before, ...patch });
  const input = { ...session.input, constraints: after };

  const invalidated: string[] = [];
  for (const m of session.plan.markets) {
    if (after.excludedMarkets.includes(m.code)) invalidated.push(`${m.code}: market now excluded`);
    if (m.language !== input.originalLanguage && after.excludedLanguages.includes(m.language)) invalidated.push(`${m.code}: ${m.language} now excluded`);
    if (after.subtitleFirst && m.mode === "dub") invalidated.push(`${m.code}: dub not allowed under subtitle-first`);
  }
  if (after.budgetUsd < session.plan.totalCostUsd) invalidated.push(`budget $${after.budgetUsd.toLocaleString("en-US")} below current spend $${session.plan.totalCostUsd.toLocaleString("en-US")}`);
  if (after.maxMarkets < session.plan.markets.length) invalidated.push(`market cap ${after.maxMarkets} below current ${session.plan.markets.length}`);
  t.log("IMPACT_ANALYSIS", invalidated.length ? `Invalidated: ${invalidated.join("; ")}. Kept research for ${Object.keys(session.research).length} markets.` : "No current decision is invalidated; re-optimizing under the new constraints only.");

  const research = { ...session.research };
  const lostSlots = session.plan.markets.filter((m) => after.excludedMarkets.includes(m.code) || (m.language !== input.originalLanguage && after.excludedLanguages.includes(m.language))).length;
  const newlyResearched: string[] = [];
  if (lostSlots > 0) {
    const reserves = reserveMarkets(session, after);
    const compIds = session.comps.filter((c) => c.entityId).map((c) => c.entityId!);
    const anchorIds = session.anchors.filter((a) => a.entityId).map((a) => a.entityId!);
    await researchMarkets(client, reserves, compIds, anchorIds, research);
    newlyResearched.push(...reserves);
    t.log("SELECTIVE_RESEARCH", reserves.length ? `${lostSlots} planned market(s) lost; researched reserves ${reserves.join(", ")} (languages already in plan first).` : "No unresearched reserve markets remain.");
  } else {
    t.log("SELECTIVE_RESEARCH", "No planned market was removed; no new Qloo research needed.");
  }

  const revised = finish(input, session.comps, session.anchors, research, t, client, session.revisions, session.version + 1);
  const changes = diffPlans(session.plan, revised.plan);
  const revision: Revision = { version: revised.version, constraints: after, invalidated, reusedMarkets: Object.keys(session.research), newlyResearched, changes };
  return { ...revised, trace: [...session.trace, ...revised.trace], revisions: [...session.revisions, revision] };
}

function reserveMarkets(session: Session, after: Constraints): string[] {
  const plannedLangs = new Set(session.plan.markets.map((m) => m.language));
  return MARKETS.filter((m) => !session.research[m.code] && !after.excludedMarkets.includes(m.code) && !after.excludedLanguages.includes(m.language))
    .sort((a, b) => Number(plannedLangs.has(b.language)) - Number(plannedLangs.has(a.language)) || a.code.localeCompare(b.code))
    .slice(0, LIMITS.maxReserveResearch)
    .map((m) => m.code);
}

export function diffPlans(prev: Plan, next: Plan): string[] {
  const changes: string[] = [];
  const p = new Map(prev.markets.map((m) => [m.code, m]));
  const n = new Map(next.markets.map((m) => [m.code, m]));
  for (const [code, m] of p) if (!n.has(code)) changes.push(`Dropped ${m.name}`);
  for (const [code, m] of n) {
    const old = p.get(code);
    if (!old) changes.push(`Added ${m.name} (${m.mode})`);
    else if (old.mode !== m.mode) changes.push(`${m.name}: ${old.mode} → ${m.mode}`);
  }
  if (prev.totalCostUsd !== next.totalCostUsd) changes.push(`Spend $${prev.totalCostUsd.toLocaleString("en-US")} → $${next.totalCostUsd.toLocaleString("en-US")}`);
  return changes.length ? changes : ["No change: the previous plan remains optimal under the new constraints"];
}

function summarizeResearch(codes: string[], research: Record<string, MarketResearch>) {
  return codes.map((c) => `${c} ${research[c].score === null ? "insufficient" : research[c].score!.toFixed(2)}`).join(", ");
}

function countBy(claims: Claim[]) {
  const counts = new Map<string, number>();
  for (const c of claims) counts.set(c.provenance, (counts.get(c.provenance) ?? 0) + 1);
  return [...counts].map(([k, v]) => `${v} ${k}`).join(", ");
}
