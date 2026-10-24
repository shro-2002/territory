export interface Market {
  code: string;
  /** ISO 3166 numeric id, used to draw the market on the atlas. */
  iso: string;
  /** Passed to signal.location.query; must resolve to a Qloo locality. */
  locationQuery: string;
  name: string;
  language: string;
}

// Primary release language per market. Multilingual markets are simplified to one
// language; this is a modelling assumption surfaced in the report.
export const MARKETS: Market[] = [
  { code: "US", iso: "840", locationQuery: "United States", name: "United States", language: "English" },
  { code: "GB", iso: "826", locationQuery: "United Kingdom", name: "United Kingdom", language: "English" },
  { code: "CA", iso: "124", locationQuery: "Canada", name: "Canada", language: "English" },
  { code: "AU", iso: "036", locationQuery: "Australia", name: "Australia", language: "English" },
  { code: "FR", iso: "250", locationQuery: "France", name: "France", language: "French" },
  { code: "DE", iso: "276", locationQuery: "Germany", name: "Germany", language: "German" },
  { code: "ES", iso: "724", locationQuery: "Spain", name: "Spain", language: "Spanish" },
  { code: "MX", iso: "484", locationQuery: "Mexico", name: "Mexico", language: "Spanish" },
  { code: "AR", iso: "032", locationQuery: "Argentina", name: "Argentina", language: "Spanish" },
  { code: "IT", iso: "380", locationQuery: "Italy", name: "Italy", language: "Italian" },
  { code: "BR", iso: "076", locationQuery: "Brazil", name: "Brazil", language: "Portuguese" },
  { code: "JP", iso: "392", locationQuery: "Japan", name: "Japan", language: "Japanese" },
  { code: "KR", iso: "410", locationQuery: "South Korea", name: "South Korea", language: "Korean" },
  { code: "IN", iso: "356", locationQuery: "India", name: "India", language: "Hindi" },
  { code: "PL", iso: "616", locationQuery: "Poland", name: "Poland", language: "Polish" },
  { code: "SE", iso: "752", locationQuery: "Sweden", name: "Sweden", language: "Swedish" },
  { code: "AT", iso: "040", locationQuery: "Austria", name: "Austria", language: "German" },
  { code: "PT", iso: "620", locationQuery: "Portugal", name: "Portugal", language: "Portuguese" },
  { code: "CO", iso: "170", locationQuery: "Colombia", name: "Colombia", language: "Spanish" },
  { code: "NL", iso: "528", locationQuery: "Netherlands", name: "Netherlands", language: "Dutch" },
  { code: "TR", iso: "792", locationQuery: "Turkey", name: "Turkey", language: "Turkish" },
  { code: "ID", iso: "360", locationQuery: "Indonesia", name: "Indonesia", language: "Indonesian" },
];

export function marketByCode(code: string): Market {
  const m = MARKETS.find((x) => x.code === code);
  if (!m) throw new Error(`Unknown market code: ${code}`);
  return m;
}

/**
 * Reference genre comp sets used as each market's portability baseline.
 * Chosen to span tone and audience; blockbusters are excluded because their neighbourhood
 * overlapped 0 in every market in live testing (no information as a baseline).
 */
export const REFERENCE_SETS: Array<{ id: string; titles: string[] }> = [
  { id: "horror", titles: ["Hereditary", "Get Out", "The Witch", "Midsommar"] },
  { id: "comedy", titles: ["Bridesmaids", "Superbad", "The Hangover", "Step Brothers"] },
  { id: "animation", titles: ["Coco", "Moana", "Zootopia", "Encanto"] },
  { id: "action", titles: ["John Wick", "Mad Max: Fury Road", "The Raid", "Baby Driver"] },
];

/**
 * Unrelated-film controls for the claim check, in a fixed order fixed before any claim-check result was seen.
 * Rule: use the first FILM_CONTROLS_USED sets that share no resolved comp with the brief. No other test
 * (no overlap threshold, no result-dependent choice), so controls can't be picked to produce a desired answer.
 * Known limit: a brief in the same genre as a control set gets a stricter test (more titles called generic, never fewer).
 * Titles and years match the evaluation scenarios so cached Qloo evidence is reused.
 */
export const FILM_CONTROL_SETS: Array<{ id: string; comps: Array<{ name: string; year: number }> }> = [
  { id: "crime-thriller", comps: [{ name: "Hell or High Water", year: 2016 }, { name: "Wind River", year: 2017 }, { name: "Sicario", year: 2015 }, { name: "Prisoners", year: 2013 }] },
  { id: "spanish-coming-of-age", comps: [{ name: "Roma", year: 2018 }, { name: "Alcarràs", year: 2022 }, { name: "Summer 1993", year: 2017 }, { name: "Y Tu Mamá También", year: 2001 }] },
  { id: "arthouse-drama", comps: [{ name: "Past Lives", year: 2023 }, { name: "Minari", year: 2020 }, { name: "Aftersun", year: 2022 }, { name: "Drive My Car", year: 2021 }] },
];
export const FILM_CONTROLS_USED = 2;

export const filmControlComps = (id: string) => FILM_CONTROL_SETS.find((s) => s.id === id)!.comps;
