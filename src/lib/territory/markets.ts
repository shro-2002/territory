export interface Market {
  code: string;
  /** Passed to signal.location.query; must resolve to a Qloo locality. */
  locationQuery: string;
  name: string;
  language: string;
}

// Primary release language per market. Multilingual markets are simplified to one
// language; this is a modelling assumption surfaced in the report.
export const MARKETS: Market[] = [
  { code: "US", locationQuery: "United States", name: "United States", language: "English" },
  { code: "GB", locationQuery: "United Kingdom", name: "United Kingdom", language: "English" },
  { code: "CA", locationQuery: "Canada", name: "Canada", language: "English" },
  { code: "AU", locationQuery: "Australia", name: "Australia", language: "English" },
  { code: "FR", locationQuery: "France", name: "France", language: "French" },
  { code: "DE", locationQuery: "Germany", name: "Germany", language: "German" },
  { code: "ES", locationQuery: "Spain", name: "Spain", language: "Spanish" },
  { code: "MX", locationQuery: "Mexico", name: "Mexico", language: "Spanish" },
  { code: "AR", locationQuery: "Argentina", name: "Argentina", language: "Spanish" },
  { code: "IT", locationQuery: "Italy", name: "Italy", language: "Italian" },
  { code: "BR", locationQuery: "Brazil", name: "Brazil", language: "Portuguese" },
  { code: "JP", locationQuery: "Japan", name: "Japan", language: "Japanese" },
  { code: "KR", locationQuery: "South Korea", name: "South Korea", language: "Korean" },
  { code: "IN", locationQuery: "India", name: "India", language: "Hindi" },
  { code: "PL", locationQuery: "Poland", name: "Poland", language: "Polish" },
  { code: "SE", locationQuery: "Sweden", name: "Sweden", language: "Swedish" },
  { code: "TR", locationQuery: "Turkey", name: "Turkey", language: "Turkish" },
  { code: "ID", locationQuery: "Indonesia", name: "Indonesia", language: "Indonesian" },
];

export function marketByCode(code: string): Market {
  const m = MARKETS.find((x) => x.code === code);
  if (!m) throw new Error(`Unknown market code: ${code}`);
  return m;
}

/**
 * Reference panel for anchor calibration: globally distributed, widely known films from
 * several origins, so the panel is not dominated by one country's catalogue.
 */
export const ANCHOR_TITLES = [
  "Titanic", "Inception", "The Dark Knight", "Avatar", "The Godfather", "Interstellar", "La La Land", "Spirited Away",
  "Parasite", "Amélie", "Life Is Beautiful", "Crouching Tiger, Hidden Dragon", "3 Idiots", "Coco", "The Intouchables", "Your Name",
];
