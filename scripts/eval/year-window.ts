/**
 * Is the "2018+ only" observation an API coverage limit, a parameter artifact, or sample-specific?
 * Prints release-year summaries per variant; writes aggregates to docs/experiments/year-window-<mode>.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { pickCandidate } from "../../src/lib/agent/resolve";
import { createQlooClient } from "../../src/lib/qloo/factory";
import type { Params } from "../../src/lib/qloo/types";

const client = createQlooClient({ callBudget: 60 });

async function ids(names: string[]) {
  const out: string[] = [];
  for (const n of names) {
    const r = pickCandidate({ name: n }, await client.search(n, ["urn:entity:movie"], 8));
    if (r.entityId) out.push(r.entityId);
  }
  return out.join(",");
}

async function years(params: Params) {
  try {
    const r = await client.insights({ take: 50, ...params });
    const ys = (r.results?.entities ?? []).map((e) => Number(e.properties?.release_year)).filter((y) => y > 0).sort((a, b) => a - b);
    return { n: ys.length, min: ys[0] ?? null, median: ys[ys.length >> 1] ?? null, pre2018: ys.filter((y) => y < 2018).length };
  } catch (err) {
    return { error: (err as Error).message.slice(0, 140) };
  }
}

async function main() {
  const thriller = await ids(["Prisoners", "Sicario", "Gone Girl", "Zodiac"]);
  const classics = await ids(["The Godfather", "Casablanca", "Chinatown", "Taxi Driver"]);
  const movie = { "filter.type": "urn:entity:movie" };
  const variants: Record<string, Params> = {
    "thriller global": { ...movie, "signal.interests.entities": thriller },
    "thriller US": { ...movie, "signal.interests.entities": thriller, "signal.location.query": "United States" },
    "thriller US + release_year.max=2017": { ...movie, "signal.interests.entities": thriller, "signal.location.query": "United States", "filter.release_year.max": 2017 },
    "thriller US + bias.trends=off": { ...movie, "signal.interests.entities": thriller, "signal.location.query": "United States", "bias.trends": "off" },
    "thriller US + location.weight=low": { ...movie, "signal.interests.entities": thriller, "signal.location.query": "United States", "signal.location.weight": "low" },
    "thriller New York (city)": { ...movie, "signal.interests.entities": thriller, "signal.location.query": "New York" },
    "classics global": { ...movie, "signal.interests.entities": classics },
    "classics France": { ...movie, "signal.interests.entities": classics, "signal.location.query": "France" },
    "location only France": { ...movie, "signal.location.query": "France" },
    "location only France + release_year.max=2010": { ...movie, "signal.location.query": "France", "filter.release_year.max": 2010 },
    "tv_show location only Japan": { "filter.type": "urn:entity:tv_show", "signal.location.query": "Japan" },
  };
  const results: Record<string, unknown> = {};
  for (const [label, p] of Object.entries(variants)) {
    results[label] = await years(p);
    process.stdout.write(`${label.padEnd(48)} ${JSON.stringify(results[label])}\n`);
  }
  const dir = path.join(process.cwd(), "docs", "experiments");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `year-window-${client.source}.json`), JSON.stringify({ mode: client.source, ran: new Date().toISOString(), results }, null, 2) + "\n");
  process.stdout.write(`network calls ${client.liveCallCount}\n`);
}
main();
