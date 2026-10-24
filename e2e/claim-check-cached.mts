// Claim-checker acceptance on REAL cached Qloo evidence (private cache, callBudget 0: any cache miss throws, no network).
// Usage: npx tsx e2e/claim-check-cached.mts   (needs .private/qloo-cache; not run in CI)
import { existsSync } from "node:fs";
import path from "node:path";

import { runAgent } from "../src/lib/agent/agent";
import { QlooClient } from "../src/lib/qloo/client";
import { decrypt, encryptContext, MAX_CONTEXT_CHARS } from "../src/lib/server/seal";
import { FileCache, PRIVATE_DIR } from "../src/lib/qloo/factory";
import { SHOWCASE_INPUT } from "../src/lib/territory/scenarios";

const dir = path.join(PRIVATE_DIR, "qloo-cache");
if (!existsSync(dir)) throw new Error("private Qloo cache not found; this check only runs where cached evidence exists");
const client = new QlooClient({ apiKey: "cache-only", source: "live", cache: new FileCache(dir), callBudget: 0 });

let failed = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failed++;
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${what}\n`);
};

const s = await runAgent(SHOWCASE_INPUT, { client });
const calls = new Map(client.calls.map((c) => [c.id, c]));
for (const code of ["DE", "JP", "MX"]) {
  const r = s.research[code];
  const c = r.claimCheck!;
  const f = c.funnel;
  process.stdout.write(`\n${code} [${c.status}] ${f ? `${f.titles} → ${f.afterGenre} (genre ×${f.genreControls}) → ${f.afterFilm} (film: ${f.filmControls.join(", ")}) → ${f.afterCrossMarket} (vs ${f.marketsCompared.length} markets)` : "no funnel"}\n  ${c.decision}\n  Next: ${c.action}\n  failed stronger check: ${c.failedStronger.count} (e.g. ${c.failedStronger.names.join(", ")})\n  provenance: local ${c.provenance.local.join(",")} · genre ${c.provenance.genreControls.length} calls · film ${c.provenance.filmControls.join(",")} · cross-market ${c.provenance.crossMarket.length} calls\n`);
  const all = [...c.provenance.local, ...c.provenance.genreControls, ...c.provenance.filmControls, ...c.provenance.crossMarket];
  check(all.length > 0 && all.every((id) => calls.get(id)?.status === 200), `${code}: every cited call id is a recorded, successful Qloo request`);
  check(c.provenance.filmControls.every((id) => String(calls.get(id)?.params["signal.location.query"]) === r.code.replace("DE", "Germany").replace("JP", "Japan").replace("MX", "Mexico")), `${code}: film-control calls are conditioned on this market`);
}
const jp = s.research.JP.claimCheck!;
const JP4 = ["Even If This Love Disappears from the World Tonight", "Call Me Chihiro", "The Tunnel to Summer, the Exit of Goodbyes", "My Beautiful Man: Eternal"];
check(jp.status === "verify" && jp.candidateCount === 4 && JP4.every((t) => jp.candidates.some((x) => x.name === t)), "JP: the four surviving titles are the verification candidates");
check(jp.candidates.every((x) => x.origin === "unknown" && x.format === "unverified") && /candidates to verify, not proven local matches/.test(jp.decision) && !/established in Japan:/.test(jp.decision), "JP: candidates presented as unverified, never as proven local matches");
check(!jp.candidates.some((x) => x.name === "The Asadas") && jp.failedStronger.names.includes("The Asadas"), "JP (adversarial): The Asadas passed the genre-only filter but fails the stronger checker");
const de = s.research.DE.claimCheck!;
check(/No local comparable is established in Germany/.test(de.decision) && de.candidates.every((x) => x.origin !== "local"), "DE: no unsupported local-cinema claim");
check(de.candidates.every((x) => x.format === "unverified") && /format-unverified/.test(de.decision) && /release format/.test(de.action), "DE: surviving title is format-unverified and routed to human review (generic rule, no title-specific exclusion)");
check(["Corsage", "The Survivor"].every((t) => !de.candidates.some((x) => x.name === t)), "DE: Germany-only titles that unrelated films also return are not candidates");
const mx = s.research.MX.claimCheck!;
check(mx.candidates.every((x) => x.origin === "unknown") && /production origin not recorded for \d+ \(unverified, neither local nor foreign\)/i.test(mx.decision), "MX: missing production origins stay explicitly unverified");
check(!/United States|American|produced elsewhere/.test(mx.decision), "MX: no origin inferred from outside Qloo's record");
check(s.claims.filter((cl) => cl.text.includes("Claim check —")).length === Object.values(s.research).filter((r) => !r.evidenceGap).length, "one claim-check decision in the ledger per qualified market");
const blob = encryptContext(s.context!);
check(blob.length <= MAX_CONTEXT_CHARS && Object.keys(decrypt<{ evidence: object }>(blob)!.evidence).length === 9, `encrypted context ${blob.length} chars (limit ${MAX_CONTEXT_CHARS}) keeps all 9 markets' evidence`);
check(client.calls.every((c) => c.cacheHit), `0 network calls (${client.calls.length} cached)`);
process.stdout.write(failed ? `\n${failed} FAILED\n` : "\nclaim check passed on cached evidence\n");
process.exit(failed ? 1 : 0);
