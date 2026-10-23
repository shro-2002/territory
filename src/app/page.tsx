import { readFile } from "node:fs/promises";
import path from "node:path";

import { TerritoryApp } from "@/components/TerritoryApp";
import type { E6Summary, ExperimentSummary } from "@/components/EvidenceLab";
import { hasLiveKey } from "@/lib/qloo/factory";
import { SHOWCASE_INPUT } from "@/lib/territory/scenarios";

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "docs", "experiments", file), "utf8")) as T;
  } catch {
    return null; // aggregates not generated yet in this checkout
  }
}

type E6Raw = {
  model: string;
  finishedAt: string;
  scenarios: Array<{ scenario: string; territory: Record<string, Record<string, unknown>>; llmOnly: Record<string, Record<string, unknown>> }>;
  differentiation: { top5JaccardAcrossScenarios: { territory: Record<string, number>; llmOnly: Record<string, number> } };
};

function summarizeE6(raw: E6Raw | null): E6Summary | null {
  if (!raw) return null;
  const valid = (x: Record<string, unknown> | undefined) => (x?.valid === undefined ? "n/a" : x.valid ? "valid" : "INVALID");
  return {
    model: raw.model,
    finishedAt: raw.finishedAt,
    differentiation: raw.differentiation.top5JaccardAcrossScenarios,
    rows: raw.scenarios.map((s) => {
      const t = [s.territory.initial, s.territory.afterRemoval, s.territory.afterBudgetCut];
      const l = [s.llmOnly.initial, s.llmOnly.afterRemoval, s.llmOnly.afterBudgetCut];
      const titles = s.llmOnly.initial.localCompTitlesVerified as { checked: number; foundInQloo: number } | undefined;
      const qlooClaims = (s.territory.initial.byProvenance as Record<string, number> | undefined)?.qloo ?? 0;
      return {
        scenario: s.scenario,
        territory: {
          outcome: s.territory.initial.status === "failed" ? "declined (no evidence)" : `${t.map(valid).join("/")} plans`,
          "Qloo-backed claims": qlooClaims,
          "untraceable claims": Number(s.territory.initial.qlooClaimsWithoutCall ?? 0),
        },
        llm: {
          outcome: s.llmOnly.initial.abstained ? "abstained" : `${l.map(valid).join("/")} plans`,
          "wrong cost totals": `${l.filter((x) => x.costArithmeticCorrect === false).length}/3`,
          "named local comps found in Qloo": titles ? `${titles.foundInQloo}/${titles.checked}` : "n/a",
          "claims with checkable source": Number(s.llmOnly.initial.claimsWithCheckableSource ?? 0),
        },
      };
    }),
  };
}

async function loadPageData(): Promise<{ summary: ExperimentSummary; source: "live" | "mock" }> {
  "use cache";
  const [experiments, e6, yearWindow] = await Promise.all([
    readJson<{ results: Array<{ id: string; verdict: string; hypothesis: string }> }>("results-live.json"),
    readJson<E6Raw>("e6-live.json"),
    readJson<{ results: ExperimentSummary["yearWindow"] }>("year-window-live.json"),
  ]);
  const summary: ExperimentSummary = {
    // E6 runs in its own harness; reflect it here instead of the harness placeholder.
    experiments: experiments?.results.map(({ id, verdict, hypothesis }) => ({ id, verdict: id === "E6" && e6 ? "run (below)" : verdict, hypothesis })) ?? null,
    e6: summarizeE6(e6),
    yearWindow: yearWindow?.results ?? null,
  };
  return { summary, source: hasLiveKey() ? "live" : "mock" };
}

export default async function Page() {
  const { summary, source } = await loadPageData();
  return <TerritoryApp initialInput={SHOWCASE_INPUT} summary={summary} source={source} />;
}
