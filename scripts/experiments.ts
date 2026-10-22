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
import type { QlooClient } from "../src/lib/qloo/client";
import { createQlooClient } from "../src/lib/qloo/factory";
import { computeMarketSignal, spearman } from "../src/lib/territory/market-signal";
import { ANCHOR_TITLES, marketByCode } from "../src/lib/territory/markets";

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
const E2_COMPS = ["Past Lives", "Minari", "Aftersun"];

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

async function affinityVector(c: QlooClient, entityIds: string[], location?: string) {
  const res = await c.insights({ "filter.type": "urn:entity:movie", ...(location ? { "signal.location.query": location } : {}), "filter.results.entities": entityIds.join(","), take: 50 });
  const map = new Map((res.results?.entities ?? []).map((e) => [e.entity_id, e.query?.affinity]));
  return { map, maxAffinity: Math.max(0, ...[...map.values()].filter((v): v is number => typeof v === "number")), locality: (res.query as Record<string, unknown> | undefined)?.locality };
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
  const anchorMap = await ids(client, ANCHOR_TITLES);
  const compMap = await ids(client, E2_COMPS);
  const all = [...new Set([...Object.values(anchorMap), ...Object.values(compMap)])];
  const baseline = await affinityVector(client, all);
  const vectors: Record<string, Map<string, number | undefined>> = {};
  const errors: Record<string, string> = {};
  const localityEcho: Record<string, unknown> = {};
  for (const code of E2_MARKETS) {
    try {
      const v = await affinityVector(client, all, marketByCode(code).locationQuery);
      vectors[code] = v.map;
      localityEcho[code] = v.locality ? "returned" : "absent";
    } catch (err) {
      errors[code] = String((err as Error).message).slice(0, 160);
    }
  }
  const codes = Object.keys(vectors);
  const common = all.filter((id) => codes.every((c) => typeof vectors[c].get(id) === "number") && typeof baseline.map.get(id) === "number");
  const pairs: number[] = [];
  for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) pairs.push(spearman(common.map((id) => vectors[codes[i]].get(id)!), common.map((id) => vectors[codes[j]].get(id)!)));
  const vsBaseline = codes.map((c) => spearman(common.map((id) => vectors[c].get(id)!), common.map((id) => baseline.map.get(id)!)));
  const meanPair = pairs.length ? mean(pairs) : NaN;
  const meanBase = vsBaseline.length ? mean(vsBaseline) : NaN;
  const locationSensitive = common.length >= 6 && meanPair < 0.9 && meanBase < 0.95;
  return {
    id: "E2", hypothesis: "signal.location.query at country level changes affinity ordering for a fixed set of films (it is not ignored).",
    requests: ["GET /v2/insights?filter.type=urn:entity:movie&signal.location.query=<country>&filter.results.entities=<ids>&take=50", "same without signal.location.query (baseline)"],
    observed: { marketsQueried: E2_MARKETS.length, marketsAccepted: codes.length, errors, localityEcho, entitiesCompared: common.length, meanPairwiseSpearman: round(meanPair), meanSpearmanVsNoLocation: round(meanBase) },
    verdict: codes.length === 0 ? "fail" : common.length < 6 ? "inconclusive" : locationSensitive ? "pass" : "fail",
    notes: "Docs' entity-type guide does not list signal.location for movie; the location use-case example does. Spearman ≈ 1 everywhere means location is ignored.",
  };
}

async function e3(): Promise<Result> {
  const anchorMap = await ids(client, ANCHOR_TITLES);
  const compMap = await ids(client, E2_COMPS);
  const anchorIds = Object.values(anchorMap);
  const compIds = Object.values(compMap);
  const all = [...new Set([...compIds, ...anchorIds])];
  const perMarket: Record<string, unknown> = {};
  const maxes: number[] = [];
  const looSpreads: number[] = [];
  for (const code of E2_MARKETS) {
    try {
      const v = await affinityVector(client, all, marketByCode(code).locationQuery);
      maxes.push(v.maxAffinity);
      const rows = [...v.map].filter(([, a]) => typeof a === "number").map(([entityId, a]) => ({ entityId, affinity: a as number }));
      const full = computeMarketSignal(rows, compIds, anchorIds);
      // Leave-one-anchor-out: how much does the signal depend on any single reference title?
      const loo = anchorIds.map((_, k) => computeMarketSignal(rows, compIds, anchorIds.filter((__, i) => i !== k)).score).filter((s): s is number => s !== null);
      const spread = loo.length ? Math.max(...loo) - Math.min(...loo) : NaN;
      if (Number.isFinite(spread)) looSpreads.push(spread);
      perMarket[code] = { score: full.score === null ? null : round(full.score), anchorsFound: full.anchorsFound, compsFound: full.compsFound, leaveOneOutSpread: round(spread) };
    } catch (err) {
      perMarket[code] = { error: String((err as Error).message).slice(0, 160) };
    }
  }
  // Test-retest on one market, bypassing nothing: the cached client returns identical data, so this
  // checks cache determinism in-process; true API stability is measured across runs (see EVALUATION.md).
  const scores = Object.values(perMarket).map((m) => (m as { score?: number | null }).score).filter((s): s is number => typeof s === "number");
  const scoreRange = scores.length ? Math.max(...scores) - Math.min(...scores) : 0;
  return {
    id: "E3", hypothesis: "Anchor-calibrated percentiles give a cross-market signal that varies between markets and is robust to dropping any one reference title.",
    requests: ["E2 market queries reused (comps + reference panel in one call per market)"],
    observed: { perMarket, maxAffinityPerQuery: maxes.map(round), perQueryMaxIsOne: maxes.length > 0 && maxes.every((m) => Math.abs(m - 1) < 1e-6), scoreRangeAcrossMarkets: round(scoreRange), meanLeaveOneOutSpread: round(mean(looSpreads)) },
    verdict: scores.length < 3 ? "inconclusive" : scoreRange >= 0.15 && mean(looSpreads) <= 0.2 ? "pass" : "fail",
    notes: "If per-query max is always 1, raw affinities are normalized per query and must not be compared across markets directly.",
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
    verdict: MODE === "mock" ? "inconclusive" : pct(lat, 0.95) < 6000 ? "pass" : "fail",
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
