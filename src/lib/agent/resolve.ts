import type { QlooClient } from "../qloo/client";
import type { Entity } from "../qloo/types";

export interface CompInput {
  name: string;
  year?: number;
}

export type ResolutionStatus = "resolved" | "ambiguous" | "unresolved";

export interface ResolvedComp {
  input: CompInput;
  status: ResolutionStatus;
  entityId?: string;
  name?: string;
  type?: string;
  year?: number;
  /** Other plausible matches the agent did not pick; shown to the user. */
  alternatives: Array<{ entityId: string; name: string; type?: string; year?: number }>;
  note: string;
  callId?: string;
}

const FILM_TYPES = ["urn:entity:movie", "urn:entity:tv_show"];
const SEARCH_TAKE = 8;
const YEAR_TOLERANCE = 1;

const norm = (s: string) => s.toLowerCase().replace(/^\[mock\]\s*/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function entityYear(e: Entity): number | undefined {
  const y = e.properties?.release_year;
  return typeof y === "number" ? y : typeof y === "string" ? Number(y) || undefined : undefined;
}

/** Pure disambiguation over search candidates, separated for testing. */
export function pickCandidate(input: CompInput, candidates: Entity[]): Omit<ResolvedComp, "callId"> {
  const target = norm(input.name);
  const exact = candidates.filter((c) => norm(c.name) === target);
  const pool = exact.length > 0 ? exact : candidates.filter((c) => norm(c.name).startsWith(target));
  const summarize = (c: Entity) => ({ entityId: c.entity_id, name: c.name, type: c.subtype ?? c.types?.[0], year: entityYear(c) });

  if (pool.length === 0) {
    return { input, status: "unresolved", alternatives: candidates.slice(0, 3).map(summarize), note: "no title match in Qloo search" };
  }
  let narrowed = pool;
  if (input.year !== undefined) {
    const byYear = pool.filter((c) => {
      const y = entityYear(c);
      return y !== undefined && Math.abs(y - input.year!) <= YEAR_TOLERANCE;
    });
    if (byYear.length > 0) narrowed = byYear;
  }
  // Prefer films over series when the user did not say otherwise; comps are film comps by default.
  const films = narrowed.filter((c) => (c.subtype ?? c.types?.[0]) === "urn:entity:movie");
  if (films.length > 0) narrowed = films;

  const [pick, ...rest] = [...narrowed].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  const others = pool.filter((c) => c.entity_id !== pick.entity_id).map(summarize);
  const ambiguous = rest.length > 0;
  return {
    input,
    status: ambiguous ? "ambiguous" : "resolved",
    ...summarize(pick),
    alternatives: others,
    note: ambiguous
      ? `${narrowed.length} equally matching titles; picked the most popular. Add a release year to disambiguate.`
      : input.year !== undefined && narrowed !== pool
        ? `matched by title and year`
        : others.length > 0
          ? `matched by title; preferred film over ${others.length} other format(s)`
          : "matched by title",
  };
}

export async function resolveComp(client: QlooClient, input: CompInput): Promise<ResolvedComp> {
  const results = await client.search(input.name, FILM_TYPES, SEARCH_TAKE);
  return { ...pickCandidate(input, results), callId: client.calls.at(-1)?.id };
}
