import type { AgentInput } from "../agent/agent";
import { filmControlComps } from "./markets";

/** Illustrative per-language costs a user would enter; Territory does not claim market prices. */
export const DEFAULT_COSTS: AgentInput["costs"] = {
  English: { subtitleUsd: 3000, dubUsd: 28000 },
  French: { subtitleUsd: 3500, dubUsd: 32000 }, German: { subtitleUsd: 3500, dubUsd: 32000 }, Spanish: { subtitleUsd: 3000, dubUsd: 26000 },
  Korean: { subtitleUsd: 4000, dubUsd: 30000 }, Japanese: { subtitleUsd: 4500, dubUsd: 36000 }, Portuguese: { subtitleUsd: 3000, dubUsd: 24000 },
  Italian: { subtitleUsd: 3200, dubUsd: 28000 }, Polish: { subtitleUsd: 2500, dubUsd: 20000 }, Swedish: { subtitleUsd: 2800, dubUsd: 22000 },
  Hindi: { subtitleUsd: 2500, dubUsd: 18000 }, Dutch: { subtitleUsd: 2500, dubUsd: 20000 }, Turkish: { subtitleUsd: 2500, dubUsd: 18000 }, Indonesian: { subtitleUsd: 2500, dubUsd: 16000 },
};

export const SHOWCASE_INPUT: AgentInput = {
  title: "The Year of Small Rooms (working title)",
  synopsis: "A Korean-American translator returns to Busan to clear her late mother's apartment and finds the letters her mother never sent.",
  genre: "intimate drama",
  originalLanguage: "English",
  comps: filmControlComps("arthouse-drama"),
  targetMarkets: ["US", "GB", "FR", "DE", "ES", "MX", "KR", "JP", "BR"],
  costs: DEFAULT_COSTS,
  constraints: { budgetUsd: 80000, maxMarkets: 5, excludedMarkets: [], excludedLanguages: [], subtitleFirst: false },
};


const BASE_MARKETS = ["US", "GB", "FR", "DE", "ES", "MX", "KR", "JP", "BR"];
const BASE_CONSTRAINTS = { budgetUsd: 80000, maxMarkets: 5, excludedMarkets: [], excludedLanguages: [], subtitleFirst: false };

/** E6 evaluation scenarios: identical structure, different taste profiles, plus a cold-start case. */
export const EVAL_SCENARIOS: Array<{ id: string; input: AgentInput }> = [
  { id: "arthouse-drama", input: SHOWCASE_INPUT },
  {
    id: "crime-thriller",
    input: {
      title: "Dry County (working title)", synopsis: "A small-town deputy in drought-stricken Texas uncovers a water-rights conspiracy that reaches her own family.",
      genre: "neo-western crime thriller", originalLanguage: "English",
      comps: filmControlComps("crime-thriller"),
      targetMarkets: BASE_MARKETS, costs: DEFAULT_COSTS, constraints: BASE_CONSTRAINTS,
    },
  },
  {
    id: "spanish-coming-of-age",
    input: {
      title: "Verano Largo (working title)", synopsis: "Two cousins spend their last summer in a Galician fishing village before one emigrates.",
      genre: "Spanish-language coming-of-age drama", originalLanguage: "Spanish",
      comps: filmControlComps("spanish-coming-of-age"),
      targetMarkets: BASE_MARKETS, costs: DEFAULT_COSTS, constraints: BASE_CONSTRAINTS,
    },
  },
  {
    id: "cold-start-unknown-comps",
    input: {
      title: "Salt Ledger (working title)", synopsis: "A bookkeeper on a remote island keeps a second set of accounts for the dead.",
      genre: "folk drama", originalLanguage: "English",
      comps: [{ name: "The Quiet Orchard of Vell", year: 2024 }, { name: "Hollowmere Tides", year: 2023 }, { name: "Nine Lanterns for Ostra", year: 2025 }],
      targetMarkets: BASE_MARKETS, costs: DEFAULT_COSTS, constraints: BASE_CONSTRAINTS,
    },
  },
];
