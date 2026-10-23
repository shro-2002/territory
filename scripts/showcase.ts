/**
 * End-to-end vertical slice: research -> plan -> "remove Germany" -> "cut budget 40%".
 *   npm run showcase            (live if QLOO_API_KEY set, else MOCK)
 * Full session JSON goes to .private/ (contains Qloo-derived data; never commit).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { AgentInput, LIMITS, replan, runAgent, Session } from "../src/lib/agent/agent";
import { createQlooClient, PRIVATE_DIR } from "../src/lib/qloo/factory";

export const SHOWCASE_INPUT: AgentInput = {
  title: "The Year of Small Rooms (working title)",
  synopsis: "A Korean-American translator returns to Busan to clear her late mother's apartment and finds the letters her mother never sent.",
  genre: "intimate drama",
  originalLanguage: "English",
  comps: [{ name: "Past Lives", year: 2023 }, { name: "Minari", year: 2020 }, { name: "Aftersun", year: 2022 }, { name: "Drive My Car", year: 2021 }],
  targetMarkets: ["US", "GB", "FR", "DE", "ES", "MX", "KR", "JP", "BR"],
  // Illustrative per-language costs entered by the user; Territory does not claim market prices.
  costs: {
    French: { subtitleUsd: 3500, dubUsd: 32000 }, German: { subtitleUsd: 3500, dubUsd: 32000 }, Spanish: { subtitleUsd: 3000, dubUsd: 26000 },
    Korean: { subtitleUsd: 4000, dubUsd: 30000 }, Japanese: { subtitleUsd: 4500, dubUsd: 36000 }, Portuguese: { subtitleUsd: 3000, dubUsd: 24000 },
    Italian: { subtitleUsd: 3200, dubUsd: 28000 }, Polish: { subtitleUsd: 2500, dubUsd: 20000 }, Swedish: { subtitleUsd: 2800, dubUsd: 22000 },
  },
  constraints: { budgetUsd: 80000, maxMarkets: 5, excludedMarkets: [], excludedLanguages: [], subtitleFirst: false },
};

function print(label: string, s: Session) {
  const out = process.stdout;
  out.write(`\n== ${label} (v${s.version}, ${s.status}) ==\n`);
  for (const m of s.plan.markets) out.write(`  ${m.code.padEnd(3)} ${m.mode.padEnd(9)} signal ${m.score.toFixed(2)}\n`);
  out.write(`  spend $${s.plan.totalCostUsd.toLocaleString("en-US")} of $${s.input.constraints.budgetUsd.toLocaleString("en-US")}; violations: ${s.violations.length}\n`);
  const rev = s.revisions.at(-1);
  if (rev && rev.version === s.version) out.write(`  invalidated: ${rev.invalidated.join("; ") || "none"}\n  new research: ${rev.newlyResearched.join(", ") || "none"}\n  changes: ${rev.changes.join("; ")}\n`);
}

async function main() {
  const client = createQlooClient({ forceMock: process.argv.includes("--mock"), callBudget: LIMITS.maxQlooCalls });
  process.stdout.write(client.source === "mock" ? "MOCK DATA — not Qloo evidence\n" : "LIVE Qloo hackathon API\n");
  const s1 = await runAgent(SHOWCASE_INPUT, { client });
  print("Initial strategy", s1);
  // Remove the strongest localized market the plan relies on (Germany if planned), so the replan is non-trivial.
  const lost = s1.plan.markets.find((m) => m.code === "DE") ?? s1.plan.markets.find((m) => m.mode !== "original");
  const s2 = lost ? await replan(s1, { excludedMarkets: [lost.code] }, { client }) : s1;
  print(`${lost?.name ?? "nothing"} removed`, s2);
  const s3 = await replan(s2, { budgetUsd: Math.round(s2.input.constraints.budgetUsd * 0.6) }, { client });
  print("Budget cut 40%", s3);
  process.stdout.write(`\nQloo network calls: ${client.liveCallCount}, cache hits: ${client.calls.filter((c) => c.cacheHit).length}\n`);
  await mkdir(PRIVATE_DIR, { recursive: true });
  await writeFile(path.join(PRIVATE_DIR, `showcase-${client.source}.json`), JSON.stringify({ sessions: [s1, s2, s3], calls: client.calls }, null, 2));
}

main().catch((err) => {
  process.stderr.write(`showcase failed: ${(err as Error).message}\n`);
  process.exit(1);
});
