import type { QlooClient } from "../qloo/client";
import { QlooError } from "../qloo/types";
import { computeMarketSignal, MarketSignal, MIN_REFERENCE_BASELINES, NEIGHBOURHOOD_SIZE, portability } from "../territory/market-signal";
import { checkClaims, ClaimCheck, MarketEvidence, screenMarket } from "../territory/claim-check";
import { FILM_CONTROL_SETS, FILM_CONTROLS_USED, marketByCode, REFERENCE_SETS } from "../territory/markets";
import { classifyNearby, EMPTY_NEARBY, NearbyTitles } from "../territory/nearby-titles";
import { resolveComp } from "./resolve";

const PAGE_SIZE = 50;
const PAGES = NEIGHBOURHOOD_SIZE / PAGE_SIZE;
const SUBSTITUTE_COMPS = 3;
/**
 * Live finding (2026-10-23): location-conditioned movie results only contain titles released
 * 2018 or later. Global neighbourhoods are filtered to the same window so overlap is like-for-like.
 */
export const RELEASE_YEAR_FLOOR = 2018;

export interface Neighbourhood {
  ids: string[];
  names: Record<string, string>;
  /** Qloo release_country per title; absent for results cached before it was kept. */
  origins: Record<string, string[]>;
  callIds: string[];
}

export interface ResearchContext {
  compIds: string[];
  global: Neighbourhood;
  references: Array<{ id: string; ids: string[]; globalIds: string[] }>;
  /** Unrelated-film controls chosen by the fixed rule in markets.ts; absent or empty when they could not be resolved. */
  filmControls?: Array<{ id: string; ids: string[] }>;
  /** Server-only claim-check evidence per researched market (encrypted with the context, never sent in clear). */
  evidence?: Record<string, MarketEvidence>;
  /** Set when evidence was too large to keep in the session; affected markets then report insufficient evidence. */
  evidenceDropped?: boolean;
}

export interface MarketResearch {
  code: string;
  callIds: string[];
  compIds: string[];
  /** Titles Qloo returned near the comps in this market (top-K). */
  titlesFound: number;
  /** Nearby titles split by what the same-market genre controls can support. */
  nearby: NearbyTitles;
  /** Why associations here could not be qualified; absent when they could. A research gap, not a rejection. */
  evidenceGap?: string;
  fallback?: string;
  /** Server-only, moved into the context by the agent before the session leaves it. */
  evidence?: MarketEvidence;
  /** What the Qloo evidence permits Territory to claim about local comparables here. */
  claimCheck?: ClaimCheck;
}

/** Top-K movies Qloo associates with the seed titles, optionally conditioned on a location. */
export async function neighbourhood(client: QlooClient, seedIds: string[], locationQuery?: string): Promise<Neighbourhood> {
  const ids: string[] = [];
  const names: Record<string, string> = {};
  const origins: Record<string, string[]> = {};
  const callIds: string[] = [];
  for (let page = 1; page <= PAGES; page++) {
    const { data: res, callId } = await client.insightsTraced({
      "filter.type": "urn:entity:movie",
      "signal.interests.entities": seedIds.join(","),
      ...(locationQuery ? { "signal.location.query": locationQuery } : {}),
      "filter.release_year.min": RELEASE_YEAR_FLOOR,
      take: PAGE_SIZE,
      page,
    });
    callIds.push(callId);
    const entities = res.results?.entities ?? [];
    for (const e of entities) {
      ids.push(e.entity_id);
      names[e.entity_id] = e.name;
      const country = e.properties?.release_country;
      if (typeof country === "string") origins[e.entity_id] = [country];
      else if (Array.isArray(country)) origins[e.entity_id] = country.filter((c): c is string => typeof c === "string");
    }
    if (entities.length < PAGE_SIZE) break;
  }
  return { ids, names, origins, callIds };
}

export async function buildContext(client: QlooClient, compIds: string[]): Promise<ResearchContext> {
  const global = await neighbourhood(client, compIds);
  const references = await Promise.all(
    REFERENCE_SETS.map(async (set) => {
      const resolved = await Promise.all(set.titles.map((name) => resolveComp(client, { name })));
      const ids = resolved.filter((r) => r.entityId).map((r) => r.entityId!);
      const g = ids.length ? await neighbourhood(client, ids) : { ids: [] };
      return { id: set.id, ids, globalIds: g.ids };
    }),
  );
  return { compIds, global, references, filmControls: await selectFilmControls(client, compIds) };
}

/**
 * The first FILM_CONTROLS_USED sets, in their fixed order, that share no resolved comp with the brief.
 * Resolution failures (e.g. quota) leave fewer controls; the claim check then reports insufficient evidence.
 */
async function selectFilmControls(client: QlooClient, compIds: string[]): Promise<Array<{ id: string; ids: string[] }>> {
  const chosen: Array<{ id: string; ids: string[] }> = [];
  try {
    for (const set of FILM_CONTROL_SETS) {
      if (chosen.length >= FILM_CONTROLS_USED) break;
      const resolved = await Promise.all(set.comps.map((c) => resolveComp(client, c)));
      const ids = resolved.filter((r) => r.entityId).map((r) => r.entityId!);
      if (ids.length && !ids.some((id) => compIds.includes(id))) chosen.push({ id: set.id, ids });
    }
  } catch {
    // Degrade: keep the controls resolved so far.
  }
  return chosen;
}

interface MarketNeighbourhoods {
  local: Neighbourhood;
  controls: Array<{ id: string; ids: string[]; globalIds: string[] }>;
  controlCallIds: string[];
  callIds: string[];
}

async function marketNeighbourhoods(client: QlooClient, code: string, ctx: ResearchContext): Promise<MarketNeighbourhoods> {
  const loc = marketByCode(code).locationQuery;
  const local = await neighbourhood(client, ctx.compIds, loc);
  const controls: MarketNeighbourhoods["controls"] = [];
  const controlCallIds: string[] = [];
  for (const ref of ctx.references.filter((r) => r.ids.length && r.globalIds.length)) {
    const n = await neighbourhood(client, ref.ids, loc);
    controlCallIds.push(...n.callIds);
    controls.push({ id: ref.id, ids: n.ids.slice(0, NEIGHBOURHOOD_SIZE), globalIds: ref.globalIds });
  }
  return { local, controls, controlCallIds, callIds: [...local.callIds, ...controlCallIds] };
}

/** Same market's neighbourhoods for the unrelated-film controls. A failure here degrades the claim check, not the market. */
async function filmNeighbourhoods(client: QlooClient, code: string, ctx: ResearchContext) {
  const loc = marketByCode(code).locationQuery;
  const sets = ctx.filmControls ?? [];
  if (!sets.length) return { ids: new Set<string>(), tested: [], callIds: [], gap: "no unrelated-film control set could be resolved" };
  const ids = new Set<string>();
  const tested: string[] = [];
  const callIds: string[] = [];
  try {
    for (const set of sets) {
      const n = await neighbourhood(client, set.ids, loc);
      callIds.push(...n.callIds);
      n.ids.slice(0, NEIGHBOURHOOD_SIZE).forEach((id) => ids.add(id));
      tested.push(set.id);
    }
    return { ids, tested, callIds };
  } catch (err) {
    // A partial set of film controls would silently weaken the test, so any failure counts as none tested.
    return { ids: new Set<string>(), tested: [], callIds, gap: err instanceof QlooError ? err.message : String(err) };
  }
}

/** Qloo associations near the comps in one market, qualified against the same market's genre controls. */
export async function researchMarket(client: QlooClient, code: string, ctx: ResearchContext): Promise<MarketResearch> {
  const market = marketByCode(code);
  try {
    const { local, controls, controlCallIds, callIds } = await marketNeighbourhoods(client, code, ctx);
    const ids = local.ids.slice(0, NEIGHBOURHOOD_SIZE).filter((id) => !ctx.compIds.includes(id));
    const base = { code, compIds: ctx.compIds, callIds, titlesFound: ids.length };
    if (ids.length === 0) return { ...base, nearby: EMPTY_NEARBY, evidenceGap: "Qloo returned no titles near the comps here" };
    if (controls.length < MIN_REFERENCE_BASELINES) return { ...base, nearby: EMPTY_NEARBY, evidenceGap: `only ${controls.length} genre control(s) available (need ${MIN_REFERENCE_BASELINES}), so associations cannot be qualified` };
    const controlIds = new Set(controls.flatMap((c) => c.ids));
    const film = await filmNeighbourhoods(client, code, ctx);
    const evidence = screenMarket({
      ids, names: local.names, origins: local.origins, country: market.name, genreControlIds: controlIds, genreControls: controls.length,
      filmControlIds: film.ids, filmControls: film.tested, calls: { local: local.callIds, genre: controlCallIds, film: film.callIds }, filmGap: film.gap,
    });
    return {
      ...base, callIds: [...callIds, ...film.callIds], evidence,
      nearby: classifyNearby({ ids, names: local.names, origins: local.origins, controlIds, controlsTested: controls.length, country: market.name }),
    };
  } catch (err) {
    const reason = err instanceof QlooError ? `${err.code}: ${err.message}` : String(err);
    return { code, compIds: ctx.compIds, callIds: [], titlesFound: 0, nearby: EMPTY_NEARBY, evidenceGap: `query failed (${reason})` };
  }
}

/**
 * RETIRED taste-portability signal, kept only so the evaluation scripts can reproduce the audit that
 * invalidated it. Never called by the agent, planner or UI (tests/retired-score.test.ts guards this).
 */
/** Server-side session step: move per-market evidence into the context and attach one claim decision per market. */
export function attachClaimChecks(context: ResearchContext, research: Record<string, MarketResearch>): { context: ResearchContext; research: Record<string, MarketResearch> } {
  const fresh = Object.fromEntries(Object.values(research).filter((r) => r.evidence).map((r) => [r.code, r.evidence!]));
  const kept = Object.fromEntries(Object.entries({ ...(context.evidence ?? {}), ...fresh }).filter(([code]) => research[code] && !research[code].evidenceGap));
  const lost = (code: string) => (context.evidenceDropped && !kept[code] ? "claim-check evidence was too large to keep in the session; re-run the research to check claims again" : undefined);
  const checked = Object.fromEntries(Object.entries(research).map(([code, r]) => [code, { ...r, evidence: undefined, claimCheck: checkClaims(kept, code, r.evidenceGap ?? lost(code)) }]));
  return { context: { ...context, evidence: kept }, research: checked };
}

export async function retiredPortabilitySignal(client: QlooClient, code: string, ctx: ResearchContext): Promise<MarketSignal> {
  const { local, controls } = await marketNeighbourhoods(client, code, ctx);
  return computeMarketSignal(ctx.global.ids, local.ids, controls.map((c) => portability(c.globalIds, c.ids).portability));
}

/** Thin market evidence → widen the comp set with the comps' closest Qloo titles and retry that market once. */
export async function substituteContext(client: QlooClient, ctx: ResearchContext): Promise<{ ctx: ResearchContext; added: string[] } | null> {
  const substitutes = ctx.global.ids.filter((id) => !ctx.compIds.includes(id)).slice(0, SUBSTITUTE_COMPS);
  if (substitutes.length === 0) return null;
  const compIds = [...ctx.compIds, ...substitutes];
  return { ctx: { ...ctx, compIds, global: await neighbourhood(client, compIds) }, added: substitutes.map((id) => ctx.global.names[id] ?? id) };
}
