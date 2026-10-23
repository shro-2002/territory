// Proves, against the REAL Upstash but an ISOLATED namespace, that an exhausted daily counter rejects live reservations,
// makes no Qloo request, and leaves the counter where it was. Production keys are never read or written.
// Usage: node/tsx --env-file=.env.local; server started with TERRITORY_REDIS_NAMESPACE=<ns> and a DUMMY QLOO_API_KEY
// (so even a guard failure could not spend real quota).  BASE_URL=http://localhost:3302 NS=verify-exhaust npx tsx --env-file=.env.local e2e/exhausted-quota-check.mts
import { SHOWCASE_INPUT } from "../src/lib/territory/scenarios";

const BASE = process.env.BASE_URL!;
const NS = process.env.NS!;
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;
if (!BASE || !/^verify-[a-z0-9-]{3,30}$/.test(NS ?? "")) throw new Error("BASE_URL and NS=verify-<name> are required");

const redis = async (cmd: Array<string | number>) => {
  if (cmd.length > 1 && !String(cmd[1]).startsWith(`${NS}:`)) throw new Error(`refusing to touch non-namespaced key ${cmd[1]}`);
  return ((await (await fetch(UPSTASH, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmd) })).json()) as { result: unknown }).result;
};
const day = new Date().toISOString().slice(0, 10);
const key = `${NS}:qloo-calls:${day}`;
let failed = 0;
const check = (ok: boolean, what: string) => { if (!ok) failed++; process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${what}\n`); };

const status = (await (await fetch(`${BASE}/api/status`)).json()) as { store: string };
check(status.store === "namespace", `server uses an isolated namespace store (${status.store})`);

await redis(["SET", key, 5000]);
const post = async (input: unknown) => {
  const res = await fetch(`${BASE}/api/agent`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.3.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ action: "run", input }) });
  return (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as { type: string; message?: string; calls?: Array<{ cacheHit: boolean; status: unknown }>; event?: { message: string } });
};
// Unique, uncached comps: any attempt to reach Qloo would show up as a non-cache call record.
const brief = { ...SHOWCASE_INPUT, comps: ["Quasar", "Nimbus", "Zephyr"].map((n) => ({ name: `${n} ${Math.random().toString(36).slice(2, 8)}` })), targetMarkets: ["FR"] };

const messages = await post(brief);
const notice = messages.find((m) => m.type === "notice");
const guard = messages.some((m) => /quota guard/.test(m.event?.message ?? ""));
const networkCalls = messages.flatMap((m) => m.calls ?? []).filter((c) => !c.cacheHit);
check(!!notice && /paused/.test(notice.message ?? ""), "run tells the user live research is paused");
check(guard, "uncached lookup is refused by the quota guard (callBudget 0)");
check(networkCalls.length === 0, `no Qloo network request was attempted (${networkCalls.length})`);
check(Number(await redis(["GET", key])) === 5000, "counter is exactly 5000 after the rejected run (not permanently increased)");

const burst = await Promise.all(Array.from({ length: 8 }, () => post(brief)));
check(burst.every((m) => m.some((x) => x.type === "notice")), "8 concurrent runs are all rejected");
check(Number(await redis(["GET", key])) === 5000, "counter is still exactly 5000 after the burst");

await redis(["DEL", key]);
for (const k of (await redis(["KEYS", `${NS}:*`])) as string[]) await redis(["DEL", k]);
check(((await redis(["KEYS", `${NS}:*`])) as string[]).length === 0, "namespace cleaned up");
process.stdout.write(failed ? `\n${failed} FAILED\n` : "\nexhausted-quota behaviour confirmed\n");
process.exit(failed ? 1 : 0);
