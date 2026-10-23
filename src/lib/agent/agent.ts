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

export interface Revision {
  version: number;
  constraints: Constraints;
  invalidated: string[];
  reusedMarkets: string[];
  newlyResearched: string[];
  changes: string[];
}

export const LIMITS = { maxQlooCalls: 160, maxReserveResearch: 3, maxFallbackMarkets: 4 } as const;

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
  await researchMarkets(client, markets, context, research);
  t.log("QLOO_INVESTIGATION", summarizeResearch(markets, research));

  await verifyAndFallback(client, research, context, t);

  return finish(input, comps, context, research, t, client, []);
}

async function researchMarkets(client: QlooClient, codes: string[], ctx: ResearchContext, into: Record<string, MarketResearch>) {
  await Promise.all(
    codes.map(async (code) => {
      into[code] = await researchMarket(client, code, ctx);
    }),
  );
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
    const reserves = session.context ? reserveMarkets(session, after) : [];
    if (session.context) await researchMarkets(client, reserves, session.context, research);
    newlyResearched.push(...reserves);
    t.log("SELECTIVE_RESEARCH", reserves.length ? `${lostSlots} planned market(s) lost; researched reserves ${reserves.join(", ")} (languages already in plan first).` : "No unresearched reserve markets remain.");
  } else {
    t.log("SELECTIVE_RESEARCH", "No planned market was removed; no new Qloo research needed.");
  }

  if (!session.context) throw new Error("Cannot replan a session whose research failed");
  const revised = finish(input, session.comps, session.context, research, t, client, session.revisions, session.version + 1);
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
  return codes.map((c) => `${c} ${research[c].score === null ? "insufficient" : `${research[c].score!.toFixed(2)}×`}`).join(", ");
}

function countBy(claims: Claim[]) {
  const counts = new Map<string, number>();
  for (const c of claims) counts.set(c.provenance, (counts.get(c.provenance) ?? 0) + 1);
  return [...counts].map(([k, v]) => `${v} ${k}`).join(", ");
}
