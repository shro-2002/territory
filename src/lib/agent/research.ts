import type { QlooClient } from "../qloo/client";
import { QlooError } from "../qloo/types";
import { computeMarketSignal, MarketSignal, MIN_REFERENCE_BASELINES, NEIGHBOURHOOD_SIZE, portability } from "../territory/market-signal";
import { marketByCode, REFERENCE_SETS } from "../territory/markets";
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
}

/** Top-K movies Qloo associates with the seed titles, optionally conditioned on a location. */
export async function neighbourhood(client: QlooClient, seedIds: string[], locationQuery?: string): Promise<Neighbourhood> {
  const ids: string[] = [];
  const names: Record<string, string> = {};
  const origins: Record<string, string[]> = {};
  const callIds: string[] = [];
  for (let page = 1; page <= PAGES; page++) {
    const res = await client.insights({
      "filter.type": "urn:entity:movie",
      "signal.interests.entities": seedIds.join(","),
      ...(locationQuery ? { "signal.location.query": locationQuery } : {}),
      "filter.release_year.min": RELEASE_YEAR_FLOOR,
      take: PAGE_SIZE,
      page,
    });
    const last = client.calls.at(-1)?.id;
    if (last) callIds.push(last);
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
  return { compIds, global, references };
}

interface MarketNeighbourhoods {
  local: Neighbourhood;
  controls: Array<{ id: string; ids: string[]; globalIds: string[] }>;
  callIds: string[];
}

async function marketNeighbourhoods(client: QlooClient, code: string, ctx: ResearchContext): Promise<MarketNeighbourhoods> {
  const loc = marketByCode(code).locationQuery;
  const local = await neighbourhood(client, ctx.compIds, loc);
  const controls: MarketNeighbourhoods["controls"] = [];
  const callIds = [...local.callIds];
  for (const ref of ctx.references.filter((r) => r.ids.length && r.globalIds.length)) {
    const n = await neighbourhood(client, ref.ids, loc);
    callIds.push(...n.callIds);
    controls.push({ id: ref.id, ids: n.ids.slice(0, NEIGHBOURHOOD_SIZE), globalIds: ref.globalIds });
  }
  return { local, controls, callIds };
}

/** Qloo associations near the comps in one market, qualified against the same market's genre controls. */
export async function researchMarket(client: QlooClient, code: string, ctx: ResearchContext): Promise<MarketResearch> {
  const market = marketByCode(code);
  try {
    const { local, controls, callIds } = await marketNeighbourhoods(client, code, ctx);
    const ids = local.ids.slice(0, NEIGHBOURHOOD_SIZE).filter((id) => !ctx.compIds.includes(id));
    const base = { code, compIds: ctx.compIds, callIds, titlesFound: ids.length };
    if (ids.length === 0) return { ...base, nearby: EMPTY_NEARBY, evidenceGap: "Qloo returned no titles near the comps here" };
    if (controls.length < MIN_REFERENCE_BASELINES) return { ...base, nearby: EMPTY_NEARBY, evidenceGap: `only ${controls.length} genre control(s) available (need ${MIN_REFERENCE_BASELINES}), so associations cannot be qualified` };
    const controlIds = new Set(controls.flatMap((c) => c.ids));
    return { ...base, nearby: classifyNearby({ ids, names: local.names, origins: local.origins, controlIds, controlsTested: controls.length, country: market.name }) };
  } catch (err) {
    const reason = err instanceof QlooError ? `${err.code}: ${err.message}` : String(err);
    return { code, compIds: ctx.compIds, callIds: [], titlesFound: 0, nearby: EMPTY_NEARBY, evidenceGap: `query failed (${reason})` };
  }
}

/**
 * RETIRED taste-portability signal, kept only so the evaluation scripts can reproduce the audit that
 * invalidated it. Never called by the agent, planner or UI (tests/retired-score.test.ts guards this).
 */
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
