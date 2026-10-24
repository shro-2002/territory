/**
 * Cultural claim check: what the Qloo evidence lets Territory say about local comparables in one market.
 *
 * A title near the comps becomes a candidate only if no tested control returned it in that market (unrelated genres,
 * then unrelated films) and none of the other researched markets lists it near the comps. Safeguards, in the copy too:
 * - surviving every control is not proof the title is specific to the film;
 * - appearing in a control is not proof it is commercially irrelevant;
 * - "not seen elsewhere" means only within the researched markets' top-K lists;
 * - a missing production origin is unknown, never local or foreign (nothing is inferred from names or language);
 * - Qloo's movie subtype also covers event screenings and records no release format, so every candidate is
 *   format-unverified until a human checks it.
 * Nothing here predicts demand, box office or audience preference.
 */
import { NEIGHBOURHOOD_SIZE } from "./market-signal";
import { marketByCode } from "./markets";
import { NOT_PROOF_OF_ABSENCE, SHOWN_PER_GROUP } from "./nearby-titles";

export type OriginStatus = "local" | "elsewhere" | "unknown";

/** Title near the comps that no control in its own market returned. Not proven film-specific. */
export interface Survivor {
  id: string;
  name: string;
  origin: OriginStatus;
  originCountries: string[];
}

export interface Sample {
  count: number;
  names: string[];
}

/** Server-only evidence for one market; travels encrypted in the session context, never to the browser. */
export interface MarketEvidence {
  /** Top-K titles near the comps here (comps removed), for the cross-market check. */
  ids: string[];
  genreControls: number;
  filmControls: string[];
  /** Also returned for at least one unrelated genre here. */
  genreGeneric: number;
  /** Passed the genre controls, but an unrelated-film control here also returned it. */
  filmGeneric: Sample;
  /** Qloo records this market as origin, but a control here also returned it. */
  localOriginGeneric: Sample;
  survivors: Survivor[];
  calls: { local: string[]; genre: string[]; film: string[] };
  /** Why unrelated-film controls could not run here. */
  filmGap?: string;
}

export interface ScreenInput {
  ids: string[];
  names: Record<string, string>;
  origins: Record<string, string[]>;
  /** Market name as Qloo writes release_country (e.g. "Germany"). */
  country: string;
  genreControlIds: Set<string>;
  genreControls: number;
  filmControlIds: Set<string>;
  filmControls: string[];
  calls: MarketEvidence["calls"];
  filmGap?: string;
}

const emptySample = (): Sample => ({ count: 0, names: [] });
const addTo = (s: Sample, name: string) => {
  s.count++;
  if (s.names.length < SHOWN_PER_GROUP) s.names.push(name);
};

export function originOf(countries: string[] | undefined, country: string): OriginStatus {
  // ponytail: exact country-name match; add aliases if Qloo spells a market differently (e.g. Korea).
  if (!countries?.length) return "unknown";
  return countries.some((c) => c.toLowerCase() === country.toLowerCase()) ? "local" : "elsewhere";
}

/** Within-market stages: unrelated-genre controls first, then unrelated-film controls. */
export function screenMarket(i: ScreenInput): MarketEvidence {
  const filmGeneric = emptySample();
  const localOriginGeneric = emptySample();
  const survivors: Survivor[] = [];
  let genreGeneric = 0;
  for (const id of i.ids) {
    const name = i.names[id] ?? id;
    const origin = originOf(i.origins[id], i.country);
    const inGenre = i.genreControlIds.has(id);
    const inFilm = i.filmControlIds.has(id);
    if ((inGenre || inFilm) && origin === "local") addTo(localOriginGeneric, name);
    if (inGenre) genreGeneric++;
    else if (inFilm) addTo(filmGeneric, name);
    else survivors.push({ id, name, origin, originCountries: i.origins[id] ?? [] });
  }
  return {
    ids: i.ids, genreControls: i.genreControls, filmControls: i.filmControls, genreGeneric, filmGeneric, localOriginGeneric, survivors, calls: i.calls,
    ...(i.filmGap ? { filmGap: i.filmGap } : {}),
  };
}

export type ClaimStatus = "verify" | "none" | "insufficient";

export interface Candidate {
  name: string;
  origin: OriginStatus;
  originCountries: string[];
  format: "unverified";
}

/** One decision per market, with the counts and Qloo call ids behind it. Lists hold at most SHOWN_PER_GROUP titles. */
export interface ClaimCheck {
  status: ClaimStatus;
  decision: string;
  action: string;
  funnel: { titles: number; afterGenre: number; genreControls: number; afterFilm: number; filmControls: string[]; afterCrossMarket: number; marketsCompared: string[] } | null;
  candidates: Candidate[];
  candidateCount: number;
  /** Passed the genre-only filter, failed an unrelated-film control or the cross-market check. */
  failedStronger: Sample;
  localOriginGeneric: Sample;
  provenance: { local: string[]; genreControls: string[]; filmControls: string[]; crossMarket: string[] };
}

const list = (names: string[], count: number) => `${names.join(", ")}${count > names.length ? ` and ${count - names.length} more` : ""}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function localOriginNote(s: Sample, market: string) {
  return s.count ? ` ${plural(s.count, "title")} with a Qloo-recorded ${market} production origin (${list(s.names, s.count)}) also ${s.count === 1 ? "appears" : "appear"} for an unrelated genre or film here, so none is a film-specific local comparable.` : "";
}

function insufficient(market: string, reason: string, e?: MarketEvidence): ClaimCheck {
  return {
    status: "insufficient",
    decision: `No claim decision for ${market}: ${reason}. No local comparable is put forward.`,
    action: `Make no local-comparable claim for ${market} until the missing controls can be run, or use other evidence (festival selections, local distributors' slates).`,
    funnel: null, candidates: [], candidateCount: 0, failedStronger: emptySample(), localOriginGeneric: e?.localOriginGeneric ?? emptySample(),
    provenance: { local: e?.calls.local ?? [], genreControls: e?.calls.genre ?? [], filmControls: e?.calls.film ?? [], crossMarket: [] },
  };
}

/** Decide what can be claimed about local comparables in `code`, using every researched market's evidence. */
export function checkClaims(all: Record<string, MarketEvidence>, code: string, gap?: string): ClaimCheck {
  const market = marketByCode(code).name;
  const e = all[code];
  if (gap || !e) return insufficient(market, gap ?? "no Qloo evidence was gathered here", e);
  if (!e.filmControls.length) return insufficient(market, `no unrelated-film control could be run (${e.filmGap ?? "unavailable"}); ${plural(e.survivors.length, "title")} passed only the genre controls`, e);

  const others = Object.entries(all).filter(([c, o]) => c !== code && o.ids.length);
  const elsewhere = new Set(others.flatMap(([, o]) => o.ids));
  const failedStronger: Sample = { count: e.filmGeneric.count, names: [...e.filmGeneric.names] };
  const kept: Survivor[] = [];
  for (const s of e.survivors) {
    if (elsewhere.has(s.id)) addTo(failedStronger, s.name);
    else kept.push(s);
  }
  const funnel = {
    titles: e.ids.length, afterGenre: e.ids.length - e.genreGeneric, genreControls: e.genreControls, afterFilm: e.survivors.length,
    filmControls: e.filmControls, afterCrossMarket: kept.length, marketsCompared: others.map(([c]) => c),
  };
  const candidates = kept.slice(0, SHOWN_PER_GROUP).map(({ name, origin, originCountries }) => ({ name, origin, originCountries, format: "unverified" as const }));
  const provenance = { local: e.calls.local, genreControls: e.calls.genre, filmControls: e.calls.film, crossMarket: others.flatMap(([, o]) => o.calls.local) };
  const tested = `${e.genreControls} unrelated-genre and ${e.filmControls.length} unrelated-film controls`;
  const one = kept.length === 1;
  const crossNote = others.length ? `${one ? "appears" : "appear"} in none of the other ${others.length} researched markets' top-${NEIGHBOURHOOD_SIZE} lists` : `${one ? "was" : "were"} not cross-checked (no other researched market)`;
  const base = { funnel, candidates, candidateCount: kept.length, failedStronger, localOriginGeneric: e.localOriginGeneric, provenance };

  if (!kept.length) {
    return {
      ...base, status: "none",
      decision: `No defensible local comparable is established in ${market}: none of the ${e.ids.length} titles near your comps survived the ${tested} and the cross-market check.${localOriginNote(e.localOriginGeneric, market)} ${NOT_PROOF_OF_ABSENCE}`,
      action: `Make no local taste-match claim for this film in ${market}; look for local comparables through other evidence (festival selections, local distributors' recent slates).`,
    };
  }
  const by = (o: OriginStatus) => kept.filter((s) => s.origin === o).length;
  const origin = [
    by("local") && `${by("local")} with a Qloo-recorded ${market} origin`,
    by("unknown") && `production origin not recorded for ${by("unknown")} (unverified, neither local nor foreign)`,
    by("elsewhere") && `${by("elsewhere")} recorded as produced elsewhere (not local-origin matches)`,
  ].filter(Boolean).join("; ");
  const names = list(kept.slice(0, SHOWN_PER_GROUP).map((s) => s.name), kept.length);
  return {
    ...base, status: "verify",
    decision: `No local comparable is established in ${market} yet. ${plural(kept.length, "title")} near your comps survived the ${tested} and ${crossNote}: ${names}. ${one ? "It is a candidate" : "They are candidates"} to verify, not ${one ? "a proven local match or film-specific link" : "proven local matches or film-specific links"}. ${origin[0].toUpperCase()}${origin.slice(1)}; release format is not recorded for any (format-unverified).${localOriginNote(e.localOriginGeneric, market)}`,
    action: `Human review before citing any as a comparable: confirm production origin, release format (feature film, not an event screening or other format) and story fit for ${names}.`,
  };
}
