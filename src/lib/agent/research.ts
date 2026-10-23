import type { QlooClient } from "../qloo/client";
import { QlooError } from "../qloo/types";
import { computeMarketSignal, MarketSignal, NEIGHBOURHOOD_SIZE, portability } from "../territory/market-signal";
import { marketByCode, REFERENCE_SETS } from "../territory/markets";
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
  callIds: string[];
}

export interface ResearchContext {
  compIds: string[];
  global: Neighbourhood;
  references: Array<{ id: string; ids: string[]; globalIds: string[] }>;
}

export interface MarketResearch extends MarketSignal {
  code: string;
  callIds: string[];
  compIds: string[];
  localNeighbours: string[];
  referencePortabilities: Record<string, number>;
  fallback?: string;
}

/** Top-K movies Qloo associates with the seed titles, optionally conditioned on a location. */
export async function neighbourhood(client: QlooClient, seedIds: string[], locationQuery?: string): Promise<Neighbourhood> {
  const ids: string[] = [];
  const names: Record<string, string> = {};
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
    }
    if (entities.length < PAGE_SIZE) break;
  }
  return { ids, names, callIds };
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

export async function researchMarket(client: QlooClient, code: string, ctx: ResearchContext): Promise<MarketResearch> {
  const market = marketByCode(code);
  try {
    const local = await neighbourhood(client, ctx.compIds, market.locationQuery);
    const referencePortabilities: Record<string, number> = {};
    const refCalls: string[] = [];
    for (const ref of ctx.references.filter((r) => r.ids.length && r.globalIds.length)) {
      const n = await neighbourhood(client, ref.ids, market.locationQuery);
      refCalls.push(...n.callIds);
      referencePortabilities[ref.id] = portability(ref.globalIds, n.ids).portability;
    }
    const signal = computeMarketSignal(ctx.global.ids, local.ids, Object.values(referencePortabilities));
    return {
      code, compIds: ctx.compIds, callIds: [...local.callIds, ...refCalls], referencePortabilities, ...signal,
      localNeighbours: signal.localNeighbourIds.slice(0, 5).map((id) => local.names[id] ?? id),
    };
  } catch (err) {
    const reason = err instanceof QlooError ? `${err.code}: ${err.message}` : String(err);
    return { code, compIds: ctx.compIds, callIds: [], referencePortabilities: {}, localNeighbours: [], localNeighbourIds: [], score: null, overlap: 0, portability: 0, baselinePortability: null, insufficientReason: `query failed (${reason})` };
  }
}

/** Thin market evidence → widen the comp set with the comps' closest Qloo titles and retry that market once. */
export async function substituteContext(client: QlooClient, ctx: ResearchContext): Promise<{ ctx: ResearchContext; added: string[] } | null> {
  const substitutes = ctx.global.ids.filter((id) => !ctx.compIds.includes(id)).slice(0, SUBSTITUTE_COMPS);
  if (substitutes.length === 0) return null;
  const compIds = [...ctx.compIds, ...substitutes];
  return { ctx: { ...ctx, compIds, global: await neighbourhood(client, compIds) }, added: substitutes.map((id) => ctx.global.names[id] ?? id) };
}
