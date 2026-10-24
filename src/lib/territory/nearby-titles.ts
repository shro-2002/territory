/**
 * What the titles Qloo places near the comps in one market can and cannot support.
 *
 * Controls are the same market's neighbourhoods for the reference genre sets (already fetched for the
 * score). In live data 56–93% of a market's comp neighbourhood also appears for unrelated genres there:
 * that is the market's catalogue, not something specific to the film. A title absent from the control
 * lists is distinctive only relative to those genres — never "film-specific", and never proof of demand.
 */
export const SHOWN_PER_GROUP = 5;
export const NO_LOCAL_ORIGIN = "No distinctive local-origin titles found under the tested controls.";
export const NOT_PROOF_OF_ABSENCE = "This does not show that no relevant local films or audience connections exist.";

/** Every list holds at most SHOWN_PER_GROUP titles (the browser never receives full Qloo lists); counts are exact. */
export interface NearbyTitles {
  /** Reference genre lists the titles were tested against; 0 means nothing here is called distinctive. */
  controlsTested: number;
  /** Titles near the comps here that Qloo also returns for at least one unrelated genre here. */
  genericCount: number;
  genericExamples: string[];
  /** Not returned for any tested genre here, with a Qloo-recorded production origin in this market. */
  localOrigin: string[];
  /** Not returned for any tested genre here, produced elsewhere: relevant to the comps, not local matches. */
  international: string[];
  /** Not returned for any tested genre here; Qloo origin not recorded (e.g. results cached before it was kept). */
  originUnknown: string[];
  counts: Record<DistinctiveGroup, number>;
}

type DistinctiveGroup = "localOrigin" | "international" | "originUnknown";

const emptyNearby = (controlsTested: number): NearbyTitles => ({
  controlsTested, genericCount: 0, genericExamples: [], localOrigin: [], international: [], originUnknown: [], counts: { localOrigin: 0, international: 0, originUnknown: 0 },
});
export const EMPTY_NEARBY: NearbyTitles = emptyNearby(0);

interface ClassifyInput {
  ids: string[];
  names: Record<string, string>;
  origins: Record<string, string[]>;
  controlIds: Set<string>;
  controlsTested: number;
  /** Market name as Qloo writes release_country (e.g. "Germany"). */
  country: string;
}

export function classifyNearby({ ids, names, origins, controlIds, controlsTested, country }: ClassifyInput): NearbyTitles {
  const out = emptyNearby(controlsTested);
  if (controlsTested === 0) return out;
  const name = (id: string) => names[id] ?? id;
  const put = (group: DistinctiveGroup, id: string) => {
    out.counts[group]++;
    if (out[group].length < SHOWN_PER_GROUP) out[group].push(name(id));
  };
  for (const id of ids) {
    if (controlIds.has(id)) {
      out.genericCount++;
      if (out.genericExamples.length < SHOWN_PER_GROUP) out.genericExamples.push(name(id));
      continue;
    }
    const origin = origins[id];
    // ponytail: exact country-name match; add aliases if Qloo spells a market differently (e.g. Korea).
    if (!origin?.length) put("originUnknown", id);
    else if (origin.some((o) => o.toLowerCase() === country.toLowerCase())) put("localOrigin", id);
    else put("international", id);
  }
  return out;
}

const more = (shown: string[], count: number) => `${shown.join(", ")}${count > shown.length ? ` and ${count - shown.length} more` : ""}`;

/** One sentence on local-origin titles, worded so an empty result is never read as proof of absence. */
export function localOriginSentence(n: NearbyTitles, marketName: string): string {
  if (n.controlsTested === 0) return `Not tested against genre controls in ${marketName}, so no nearby title is called distinctive.`;
  const controls = `the ${n.controlsTested} tested genre controls`;
  if (n.counts.localOrigin) return `Distinctive under ${controls} and produced in ${marketName}: ${more(n.localOrigin, n.counts.localOrigin)}.`;
  if (n.counts.originUnknown) return `No distinctive title with a verified ${marketName} production origin under ${controls}: Qloo origin was not recorded for ${n.counts.originUnknown} distinctive title(s). ${NOT_PROOF_OF_ABSENCE}`;
  return `${NO_LOCAL_ORIGIN} ${NOT_PROOF_OF_ABSENCE}`;
}

/** Distinctive titles produced elsewhere, or "" when there are none. */
export function internationalSentence(n: NearbyTitles): string {
  return n.counts.international ? `Distinctive under the tested controls but produced elsewhere (relevant to the comps, not local matches): ${more(n.international, n.counts.international)}.` : "";
}

/** Share of nearby titles that the market also returns for unrelated genres. */
export function catalogueSentence(n: NearbyTitles, marketName: string): string {
  const total = n.genericCount + n.counts.localOrigin + n.counts.international + n.counts.originUnknown;
  return `${n.genericCount} of the ${total} titles near your comps in ${marketName} also appear there for at least one of ${n.controlsTested} unrelated genres: market catalogue, not specific to your film.`;
}
