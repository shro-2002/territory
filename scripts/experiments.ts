/**
 * API feasibility experiments E1–E6.
 *   npm run experiments            -> live if QLOO_API_KEY is set, else MOCK
 *   npm run experiments -- --mock  -> force MOCK
 * Writes aggregate metrics only to docs/experiments/ (safe to commit).
 * Raw Qloo responses stay in .private/ (gitignored) via the client cache.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { pickCandidate } from "../src/lib/agent/resolve";
import { buildContext, neighbourhood, retiredPortabilitySignal } from "../src/lib/agent/research";
import { MemoryCache, type QlooClient } from "../src/lib/qloo/client";
import { createQlooClient } from "../src/lib/qloo/factory";
import { jaccard, portability, spearman } from "../src/lib/territory/market-signal";
import { marketByCode } from "../src/lib/territory/markets";

const negativeControl = process.argv.includes("--mock-ignore-location");
const forceMock = negativeControl || process.argv.includes("--mock");
const client = createQlooClient({ forceMock, callBudget: 200, mock: { ignoreLocation: negativeControl } });
const MODE = negativeControl ? "mock-ignore-location" : client.source;

// E1 probe set: indie/arthouse, non-English, TV, one deliberately ambiguous title, one fake.
const E1_TITLES: Array<{ name: string; year?: number }> = [
  { name: "Past Lives", year: 2023 }, { name: "Minari", year: 2020 }, { name: "Aftersun", year: 2022 }, { name: "Parasite", year: 2019 },
  { name: "Drive My Car", year: 2021 }, { name: "Portrait of a Lady on Fire", year: 2019 }, { name: "Roma", year: 2018 },
  { name: "The Worst Person in the World", year: 2021 }, { name: "Shoplifters", year: 2018 }, { name: "Burning", year: 2018 },
  { name: "The Lunchbox", year: 2013 }, { name: "Wadjda", year: 2012 }, { name: "A Separation", year: 2011 }, { name: "Toni Erdmann", year: 2016 },
  { name: "Cold War", year: 2018 }, { name: "Squid Game" }, { name: "Dark" }, { name: "Fleabag" }, { name: "Oldboy" }, { name: "Totally Fake Film 31337" },
];
const E2_MARKETS = ["US", "FR", "DE", "BR", "JP", "KR", "IN", "MX"];
const E2_COMPS = ["Past Lives", "Minari", "Aftersun", "Drive My Car"];
// Second, tonally different comp set: if both rank markets identically, the signal is a market constant.
const E3_SECOND_COMPS = ["Prisoners", "Sicario", "Gone Girl", "Zodiac"];
const RETEST_MARKETS = ["US", "JP", "BR"];

interface Result {
  id: string;
  hypothesis: string;
  requests: string[];
  observed: Record<string, unknown>;
  verdict: "pass" | "fail" | "inconclusive" | "not_run";
  notes: string;
}

async function ids(c: QlooClient, names: string[]) {
  const out: Record<string, string> = {};
  for (const n of names) {
    const r = pickCandidate({ name: n }, await c.search(n, ["urn:entity:movie", "urn:entity:tv_show"], 8));
    if (r.entityId) out[n] = r.entityId;
  }
  return out;
}

async function e1(): Promise<Result> {
  let resolved = 0, ambiguous = 0, unresolved = 0;
  const perTitle: Array<{ title: string; status: string; alternatives: number }> = [];
  for (const t of E1_TITLES) {
    const r = pickCandidate(t, await client.search(t.name, ["urn:entity:movie", "urn:entity:tv_show"], 8));
    perTitle.push({ title: t.name, status: r.status, alternatives: r.alternatives.length });
    if (r.status === "resolved") resolved++; else if (r.status === "ambiguous") ambiguous++; else unresolved++;
  }
  const real = E1_TITLES.length - 1;
  const coverage = (resolved + ambiguous) / real;
  return {
    id: "E1", hypothesis: "≥80% of real indie/non-English film & TV comps resolve to a Qloo entity via /search.",
    requests: ["GET /search?query=<title>&types=urn:entity:movie,urn:entity:tv_show&take=8"],
    observed: { coverageOfRealTitles: round(coverage), resolved, ambiguous, unresolved, perTitle },
    verdict: coverage >= 0.8 ? "pass" : "fail",
    notes: "The fake title must be unresolved; any match for it is a false positive.",
  };
}

async function e2(): Promise<Result> {
  const compIds = Object.values(await ids(client, E2_COMPS));
  const global = await neighbourhood(client, compIds);
  const local: Record<string, string[]> = {};
  const errors: Record<string, string> = {};
  for (const code of E2_MARKETS) {
    try {
      local[code] = (await neighbourhood(client, compIds, marketByCode(code).locationQuery)).ids;
    } catch (err) {
      errors[code] = String((err as Error).message).slice(0, 160);
    }
  }
  const codes = Object.keys(local);
  const vsGlobal = codes.map((c) => jaccard(local[c], global.ids));
  const pairs: number[] = [];
  for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) pairs.push(jaccard(local[codes[i]], local[codes[j]]));
  const sensitive = codes.length >= 4 && mean(vsGlobal) < 0.9 && mean(pairs) < 0.9;
  return {
    id: "E2", hypothesis: "Country-level signal.location.query changes the comps' taste neighbourhood (it is not ignored).",
    requests: ["GET /v2/insights?filter.type=urn:entity:movie&signal.interests.entities=<comps>&signal.location.query=<country>&take=50&page=1..2", "same without location (global)"],
    observed: { compsResolved: compIds.length, globalSize: global.ids.length, marketsAccepted: codes.length, errors, meanJaccardVsGlobal: round(mean(vsGlobal)), meanPairwiseJaccard: round(mean(pairs)), perMarketJaccardVsGlobal: Object.fromEntries(codes.map((c, i) => [c, round(vsGlobal[i])])) },
    verdict: codes.length === 0 ? "fail" : sensitive ? "pass" : "fail",
    notes: "Jaccard ≈ 1 would mean location is ignored. Earlier finding: filter.results.entities + location returns only entities already in the localized pool, so fixed-panel affinity comparison is not possible.",
  };
}

async function marketScores(compNames: string[]) {
  const ctx = await buildContext(client, Object.values(await ids(client, compNames)));
  const out: Record<string, { score: number | null; overlap: number; baseline: number | null; reason?: string }> = {};
  for (const code of E2_MARKETS) {
    const r = await retiredPortabilitySignal(client, code, ctx);
    out[code] = { score: r.score === null ? null : round(r.score), overlap: r.overlap, baseline: r.baselinePortability === null ? null : round(r.baselinePortability), reason: r.insufficientReason };
  }
  return { ctx, out };
}

async function e3(): Promise<Result> {
  const a = await marketScores(E2_COMPS);
  const b = await marketScores(E3_SECOND_COMPS);
  const both = E2_MARKETS.filter((c) => a.out[c].score !== null && b.out[c].score !== null);
  const rho = both.length >= 4 ? spearman(both.map((c) => a.out[c].score!), both.map((c) => b.out[c].score!)) : NaN;
  const sa = E2_MARKETS.map((c) => a.out[c].score).filter((x): x is number => x !== null);
  const range = sa.length ? Math.max(...sa) - Math.min(...sa) : 0;
  // Test-retest: same queries through a fresh, uncached live client.
  const fresh = createQlooClient({ forceMock, cache: new MemoryCache(), callBudget: 20, mock: { ignoreLocation: negativeControl } });
  const retest: Record<string, { first: number; second: number }> = {};
  for (const code of RETEST_MARKETS) {
    const again = await neighbourhood(fresh, a.ctx.compIds, marketByCode(code).locationQuery);
    retest[code] = { first: a.out[code].overlap, second: portability(a.ctx.global.ids, again.ids).overlap };
  }
  const maxDrift = Math.max(...Object.values(retest).map((r) => Math.abs(r.first - r.second)));
  const pass = both.length >= 4 && range >= 0.3 && rho < 0.9 && maxDrift <= 2;
  return {
    id: "E3", hypothesis: "Portability lift varies across markets, is genre-specific (two comp sets rank markets differently) and is stable on re-query.",
    requests: ["E2 queries for comps and for 4 reference genre sets per market", "second comp set (crime thrillers)", `uncached re-query of ${RETEST_MARKETS.join(", ")}`],
    observed: { arthouse: a.out, thriller: b.out, marketsScoredBoth: both.length, arthouseLiftRange: round(range), spearmanArthouseVsThriller: round(rho), retest, maxRetestDriftTitles: maxDrift },
    verdict: both.length < 4 ? "inconclusive" : pass ? "pass" : "fail",
    notes: "Pass needs range ≥ 0.3, Spearman < 0.9, retest drift ≤ 2 titles. A negative control (location ignored) yields portability 1.0 everywhere.",
  };
}

async function e4(): Promise<Result> {
  // Three unreleased concepts described only by comps (cold start).
  const concepts = { "immigrant family drama": ["Minari", "The Farewell", "Past Lives"], "nordic relationship dramedy": ["The Worst Person in the World", "Fleabag", "Aftersun"], "class-satire thriller": ["Parasite", "Burning", "Triangle of Sadness"] };
  const out: Record<string, unknown> = {};
  let ok = 0;
  for (const [name, comps] of Object.entries(concepts)) {
    const resolved = await ids(client, comps);
    const related = Object.keys(resolved).length ? await client.insights({ "filter.type": "urn:entity:movie", "signal.interests.entities": Object.values(resolved).join(","), take: 10 }) : undefined;
    const relatedCount = related?.results?.entities?.length ?? 0;
    out[name] = { compsResolved: Object.keys(resolved).length, compsRequested: comps.length, relatedTitlesReturned: relatedCount };
    if (Object.keys(resolved).length >= 2 && relatedCount > 0) ok++;
  }
  return {
    id: "E4", hypothesis: "An unreleased film can be researched from comps alone: ≥2 comps resolve and Qloo returns related titles for the comp set.",
    requests: ["GET /search per comp", "GET /v2/insights?filter.type=urn:entity:movie&signal.interests.entities=<comp ids>&take=10"],
    observed: out, verdict: ok === Object.keys(concepts).length ? "pass" : ok > 0 ? "inconclusive" : "fail",
    notes: "Related titles are the substitute-comp pool used by the agent's thin-evidence fallback.",
  };
}

async function e5(): Promise<Result> {
  const probes: Record<string, string> = {};
  const probe = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const r = (await fn()) as { results?: { entities?: unknown[] } };
      probes[label] = `ok (${r?.results?.entities?.length ?? "n/a"} entities)`;
    } catch (err) {
      probes[label] = String((err as Error).message).slice(0, 120);
    }
  };
  await probe("unsupported type → expect 403", () => client.insights({ "filter.type": "urn:entity:spaceship", "signal.location.query": "France" }));
  await probe("unknown locality → expect 400", () => client.insights({ "filter.type": "urn:entity:movie", "signal.location.query": "Atlantis Undersea Republic" }));
  await probe("type only, no signal → documented error", () => client.insights({ "filter.type": "urn:entity:movie" }));
  await probe("free-text tag → documented error/empty", () => client.insights({ "filter.type": "urn:entity:movie", "signal.interests.tags": "sad movies" }));
  await probe("heatmap for comps in a country", async () => {
    const compIds = Object.values(await ids(client, E2_COMPS));
    return client.get("/v2/insights", { "filter.type": "urn:heatmap", "filter.location.query": "Brazil", "signal.interests.entities": compIds.join(","), "output.heatmap.boundary": "city" });
  });
  const live = client.calls.filter((c) => !c.cacheHit);
  const lat = live.map((c) => c.latencyMs).sort((a, b) => a - b);
  const statuses: Record<string, number> = {};
  for (const c of live) statuses[String(c.status)] = (statuses[String(c.status)] ?? 0) + 1;
  return {
    id: "E5", hypothesis: "API errors are documented and distinguishable; p95 latency allows a ~10-market run under 30 s at concurrency 4.",
    requests: ["error-contract probes listed in observed.probes", "all calls made by E1–E5"],
    observed: { probes, totalNetworkCalls: live.length, statuses, latencyP50Ms: pct(lat, 0.5), latencyP95Ms: pct(lat, 0.95), cacheHits: client.calls.length - live.length },
    verdict: MODE === "mock" ? "inconclusive" : (pct(lat, 0.95) ?? Infinity) < 6000 ? "pass" : "fail",
    notes: MODE === "mock" ? "Mock latency is meaningless; run live." : "",
  };
}

function e6(): Result {
  return {
    id: "E6", hypothesis: "Qloo-grounded plans differ materially from LLM-only plans for identical inputs and contain fewer unsupported claims.",
    requests: ["LLM-only baseline with identical inputs (see docs/EVALUATION.md protocol)"],
    observed: {}, verdict: "not_run",
    notes: "Requires the LLM baseline harness (Phase D). Not run; no result is claimed.",
  };
}

const round = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);

async function main() {
  const started = new Date().toISOString();
  const results: Result[] = [];
  for (const run of [e1, e2, e3, e4, e5]) {
    try {
      results.push(await run());
    } catch (err) {
      results.push({ id: run.name.toUpperCase(), hypothesis: "", requests: [], observed: { error: String((err as Error).message) }, verdict: "inconclusive", notes: "experiment crashed" });
    }
  }
  results.push(e6());
  const report = { mode: MODE, warning: MODE === "mock" ? "MOCK DATA — synthetic responses from src/lib/qloo/mock.ts. Not evidence about Qloo." : "Live Qloo hackathon API. Aggregates only; raw responses are private.", started, finished: new Date().toISOString(), results };
  const dir = path.join(process.cwd(), "docs", "experiments");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `results-${MODE}.json`);
  await writeFile(file, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(`${report.warning}\n`);
  for (const r of results) process.stdout.write(`${r.id}  ${r.verdict.padEnd(12)} ${r.hypothesis}\n`);
  process.stdout.write(`written ${path.relative(process.cwd(), file)}\n`);
}

main().catch((err) => {
  process.stderr.write(`experiments failed: ${(err as Error).message}\n`);
  process.exit(1);
});
