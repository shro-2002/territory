// Regression on REAL cached Qloo evidence (private cache, callBudget 0: any cache miss throws, no network).
// Usage: npx tsx e2e/local-comps-check.mts   (needs .private/qloo-cache; not run in CI)
import { existsSync } from "node:fs";
import path from "node:path";

import { buildContext, researchMarket } from "../src/lib/agent/research";
import { resolveComp } from "../src/lib/agent/resolve";
import { QlooClient } from "../src/lib/qloo/client";
import { FileCache, PRIVATE_DIR } from "../src/lib/qloo/factory";
import { marketByCode } from "../src/lib/territory/markets";
import { localOriginSentence, NO_LOCAL_ORIGIN } from "../src/lib/territory/nearby-titles";
import { SHOWCASE_INPUT } from "../src/lib/territory/scenarios";

const dir = path.join(PRIVATE_DIR, "qloo-cache");
if (!existsSync(dir)) throw new Error("private Qloo cache not found; this check only runs where cached evidence exists");
const client = new QlooClient({ apiKey: "cache-only", source: "live", cache: new FileCache(dir), callBudget: 0 });

let failed = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failed++;
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${what}\n`);
};

const comps = await Promise.all(SHOWCASE_INPUT.comps.map((c) => resolveComp(client, c)));
const ctx = await buildContext(client, comps.filter((c) => c.entityId).map((c) => c.entityId!));
for (const code of ["DE", "MX", "JP"]) {
  const r = await researchMarket(client, code, ctx);
  const n = r.nearby;
  process.stdout.write(`\n${code}: catalogue ${n.genericCount}/100 (e.g. ${n.genericExamples.join(", ")}); distinctive local ${n.counts.localOrigin}, international ${n.counts.international}, origin unknown ${n.counts.originUnknown}\n  ${localOriginSentence(n, marketByCode(code).name)}\n`);
  check(n.controlsTested === 4, `${code}: tested against all 4 reference genres`);
  check(n.genericCount >= 50, `${code}: most nearby titles are flagged as catalogue (${n.genericCount}/100)`);
  if (code !== "JP") check(n.counts.localOrigin === 0, `${code}: no qualifying local-origin comparables`);
  check(!localOriginSentence(n, code).includes(NO_LOCAL_ORIGIN) || n.counts.originUnknown === 0, `${code}: never says "none found" while origin is unrecorded`);
}
const germany = await researchMarket(client, "DE", ctx);
const formerlyShown = ["Little Women", "House of Gucci"];
const stillDistinctive = formerlyShown.filter((t) => [...germany.nearby.localOrigin, ...germany.nearby.international, ...germany.nearby.originUnknown].includes(t));
check(stillDistinctive.length === 0, `DE: titles the old panel showed as local comps (${formerlyShown.join(", ")}) are not presented as distinctive`);
check(client.calls.every((c) => c.cacheHit), `0 network calls (${client.calls.length} cached)`);
process.stdout.write(failed ? `\n${failed} FAILED\n` : "\nlocal comps check passed\n");
process.exit(failed ? 1 : 0);
