import { createHash } from "node:crypto";

/**
 * MOCK Qloo backend implementing the documented request contract.
 * Every number it returns is synthetic and every entity name carries a "[MOCK]" prefix,
 * so mock output can never be mistaken for live Qloo evidence.
 * Contract behaviours copied from docs.qloo.com (hackathon developer guide):
 *   - missing X-Api-Key -> 401; POST -> error; unknown path -> 404
 *   - missing filter.type -> 400; unsupported type -> 403
 *   - signal.location.query that resolves to nothing -> 400
 *   - unknown params are ignored silently (may yield empty entities)
 */

export const MOCK_PREFIX = "[MOCK] ";

const SUPPORTED_TYPES = new Set(["artist", "book", "brand", "destination", "movie", "person", "place", "podcast", "tv_show", "video_game"].map((t) => `urn:entity:${t}`).concat("urn:heatmap"));

const KNOWN_LOCALITIES = ["austria", "portugal", "colombia", "netherlands", "united states", "united kingdom", "france", "germany", "spain", "italy", "brazil", "mexico", "argentina", "japan", "south korea", "india", "nigeria", "australia", "canada", "sweden", "poland", "turkey", "indonesia", "philippines"];

const MOCK_CATALOG = [
  "Past Lives", "Minari", "Aftersun", "Parasite", "Drive My Car", "Portrait of a Lady on Fire", "Roma", "The Worst Person in the World",
  "Shoplifters", "Burning", "Moonlight", "Lady Bird", "Call Me by Your Name", "Amélie", "Pan's Labyrinth", "City of God",
  "Spirited Away", "Oldboy", "The Lunchbox", "Wadjda", "A Separation", "Y Tu Mamá También", "Toni Erdmann", "Cold War",
  "Titanic", "Inception", "The Dark Knight", "Avatar", "The Godfather", "Interstellar", "La La Land", "Life Is Beautiful",
  "Crouching Tiger, Hidden Dragon", "3 Idiots", "Coco", "The Intouchables", "Your Name",
  // Reference genre sets (src/lib/territory/markets.ts) so mock runs can build baselines.
  "Hereditary", "Get Out", "The Witch", "Midsommar", "Bridesmaids", "Superbad", "The Hangover", "Step Brothers",
  "Moana", "Zootopia", "Encanto", "John Wick", "Mad Max: Fury Road", "The Raid", "Baby Driver",
  // Unrelated-film control sets (FILM_CONTROL_SETS) not already listed.
  "Hell or High Water", "Wind River", "Sicario", "Prisoners", "Alcarràs", "Summer 1993",
];

function hash01(...parts: string[]): number {
  const h = createHash("sha256").update(parts.join("|")).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

function mockId(name: string) {
  return `mock-${createHash("sha1").update(name.toLowerCase()).digest("hex").slice(0, 12)}`;
}

function entity(name: string, type: string, affinity?: number) {
  return {
    entity_id: mockId(name),
    name: `${MOCK_PREFIX}${name}`,
    types: [type],
    subtype: type,
    popularity: Number(hash01("pop", name).toFixed(4)),
    properties: { release_year: 1995 + Math.floor(hash01("year", name) * 30) },
    ...(affinity === undefined ? {} : { query: { affinity: Number(affinity.toFixed(4)) } }),
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export interface MockOptions {
  /** Simulate N leading 429s before success, to exercise backoff. */
  rateLimitFirst?: number;
  /** Treat location as ignored by the API (E2 negative control). */
  ignoreLocation?: boolean;
  latencyMs?: number;
}

export function createMockFetch(options: MockOptions = {}): typeof fetch {
  let remaining429 = options.rateLimitFirst ?? 0;
  return async (input, init) => {
    if (options.latencyMs) await new Promise((r) => setTimeout(r, options.latencyMs));
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    if ((init?.method ?? "GET") !== "GET") return json(405, { error: "No path matching request parameters" });
    if (!headers.get("x-api-key")) return json(401, { error: "Unauthorized" });
    if (remaining429 > 0) {
      remaining429 -= 1;
      return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
    }
    const p = url.searchParams;
    if (url.pathname === "/search") return handleSearch(p);
    if (url.pathname === "/v2/insights") return handleInsights(p, options);
    return json(404, { error: "Not found" });
  };
}

function handleSearch(p: URLSearchParams) {
  const q = (p.get("query") ?? "").toLowerCase().trim();
  const types = (p.get("types") ?? "urn:entity:movie").split(",");
  const take = Number(p.get("take") ?? 5);
  const hits = MOCK_CATALOG.filter((n) => q && (n.toLowerCase().includes(q) || q.includes(n.toLowerCase())));
  // Simulate an ambiguous title: a same-named TV remake exists for every film match.
  const results = hits.flatMap((n) => [entity(n, types[0]), ...(types.includes("urn:entity:tv_show") ? [entity(`${n} (TV series)`, "urn:entity:tv_show")] : [])]);
  return json(200, { results: results.slice(0, take) });
}

const LIST_LENGTH = 150;

/** Global neighbourhood for a seed: deterministic synthetic titles plus catalogue titles. */
function neighbourhoodNames(seed: string): string[] {
  return Array.from({ length: LIST_LENGTH }, (_, i) => `Related ${createHash("sha1").update(`${seed}|${i}`).digest("hex").slice(0, 6)}`);
}

/**
 * Location conditioning, modelled on live behaviour: a market keeps a seed- and market-dependent
 * share of the global neighbourhood and fills the rest with market-specific titles.
 */
function localizedNames(seed: string, loc: string): string[] {
  const global = neighbourhoodNames(seed);
  const keep = 0.05 + 0.3 * hash01("keep", seed, loc);
  return global.map((n, i) => (hash01("slot", seed, loc, String(i)) < keep ? n : `${n} · ${loc}`));
}

function handleInsights(p: URLSearchParams, options: MockOptions) {
  const type = p.get("filter.type");
  if (!type) return json(400, { error: "filter.type is required" });
  if (!SUPPORTED_TYPES.has(type)) return json(400, { errors: [{ message: `The value ${type} is not supported for filter.type` }] });
  const loc = p.get("signal.location.query")?.toLowerCase();
  if (loc !== undefined && !KNOWN_LOCALITIES.includes(loc)) return json(400, { error: `No locality found for '${loc}'` });
  const hasSignal = [...p.keys()].some((k) => k.startsWith("signal.") || (k.startsWith("filter.") && k !== "filter.type"));
  if (!hasSignal) return json(400, { errors: [{ message: "at least one valid signal or filter is required" }] });

  const take = Math.min(Number(p.get("take") ?? 20), 50);
  const page = Number(p.get("page") ?? 1);
  const locKey = options.ignoreLocation ? undefined : loc;
  const requested = p.get("filter.results.entities")?.split(",").filter(Boolean);
  const seed = p.get("signal.interests.entities") ?? p.get("signal.interests.tags") ?? "";

  let names: string[];
  if (requested) names = requested.map((id) => MOCK_CATALOG.find((n) => mockId(n) === id)).filter((n): n is string => Boolean(n));
  else if (seed) names = locKey ? localizedNames(seed, locKey) : neighbourhoodNames(seed);
  else names = neighbourhoodNames(`location:${locKey ?? "global"}`);

  // Affinity decreases with rank and is normalized within this result set, as the docs describe.
  const entities = names.slice((page - 1) * take, page * take).map((n, i) => entity(n, type, 0.99 - 0.002 * ((page - 1) * take + i)));
  return json(200, { success: true, results: { entities }, query: loc ? { localities: { signal: { name: `${MOCK_PREFIX}${loc}` } } } : {} });
}

export function mockEntityId(name: string) {
  return mockId(name);
}
