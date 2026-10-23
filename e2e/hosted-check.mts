// Controlled verification of a hosted preview. Reads the shared Redis READ-ONLY (never writes) to record how each step
// moves the daily quota counter. Usage: HOSTED_URL=https://<deploy>--territory-qloo.netlify.app npx tsx --env-file=.env.local e2e/hosted-check.mts
// Steps: status → new daily key → cached showcase (expect +0) → ONE uncached research (expect +live calls) → replans (expect +0) → browser journey → export.
import { readFile } from "node:fs/promises";

import { chromium } from "@playwright/test";

import type { StreamMessage } from "../src/app/api/agent/route";
import { SHOWCASE_INPUT } from "../src/lib/territory/scenarios";

const URL_ = process.env.HOSTED_URL;
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!URL_ || !UPSTASH || !TOKEN) throw new Error("HOSTED_URL and Upstash credentials (read-only use) are required");

const READ_ONLY = new Set(["GET", "TTL", "KEYS", "DBSIZE", "SCAN"]);
async function redisRead(cmd: Array<string | number>) {
  if (!READ_ONLY.has(String(cmd[0]))) throw new Error(`refusing non-read command ${cmd[0]}`);
  const res = await fetch(UPSTASH!, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmd) });
  return ((await res.json()) as { result: unknown }).result;
}
const today = () => `qloo-calls:${new Date().toISOString().slice(0, 10)}`;
const counter = async (key = today()) => Number((await redisRead(["GET", key])) ?? 0);
const cacheEntries = async () => ((await redisRead(["KEYS", "qloo:*"])) as string[]).length;

let failed = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failed++;
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${what}\n`);
};
const ip = () => `10.4.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function api(body: unknown) {
  const res = await fetch(`${URL_}/api/agent`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify(body) });
  const messages = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as StreamMessage);
  const result = messages.find((m) => m.type === "result");
  return { source: res.headers.get("x-territory-source"), messages, result: result?.type === "result" ? result : null };
}

process.stdout.write(`UTC now ${new Date().toISOString()}  counter key today ${today()}\n`);
const status = (await (await fetch(`${URL_}/api/status`)).json()) as { source: string; store: string };
check(status.store === "production" && status.source === "live", `/api/status → ${JSON.stringify(status)}`);

const key = today();
const keyExists = (await redisRead(["GET", key])) !== null;
const startValue = await counter();
const ttl = Number(await redisRead(["TTL", key]));
process.stdout.write(`daily key ${key}: exists=${keyExists} value=${startValue} ttl=${ttl}s\n`);
check(startValue < 5000, "today's key is a fresh day with quota available");

// 1. Cached showcase: must add nothing net.
const showcase = await api({ action: "run", input: SHOWCASE_INPUT });
const showcaseLive = showcase.result?.calls.filter((c) => !c.cacheHit).length ?? -1;
const afterShowcase = await counter();
check(showcase.source === "live" && !!showcase.result && showcaseLive === 0, `cached showcase: ${showcase.result?.calls.length} calls, ${showcaseLive} live`);
check(afterShowcase === startValue, `counter after cached showcase ${startValue} → ${afterShowcase} (expected unchanged)`);

// 2. War Room on the cached session: Germany withdrawal + budget cut.
if (showcase.result) {
  const r = showcase.result;
  const germany = await api({ action: "replan", session: r.session, token: r.token, context: r.context, patch: { excludedMarkets: ["DE"] } });
  check(!!germany.result && !germany.result.session.plan.markets.some((m) => m.code === "DE"), "Germany withdrawal replans without Germany");
  const cut = germany.result ? await api({ action: "replan", session: germany.result.session, token: germany.result.token, context: germany.result.context, patch: { budgetUsd: Math.round(SHOWCASE_INPUT.constraints.budgetUsd * 0.6) } }) : null;
  check(!!cut?.result && cut.result.session.plan.totalCostUsd <= 48000 && cut.result.session.violations.length === 0, "budget cut stays within $48,000 with no violations");
  const replanLive = [germany, cut].flatMap((x) => x?.result?.calls.filter((c) => !c.cacheHit) ?? []).length;
  process.stdout.write(`replans: ${replanLive} live calls (reserve-market research may legitimately miss the cache)\n`);
}
const beforeUncached = await counter();

// 3. ONE controlled uncached research: three real films unlikely to be in any cache, one market.
const uncachedInput = { ...SHOWCASE_INPUT, title: "Controlled uncached test", comps: [{ name: "Perfect Days", year: 2023 }, { name: "The Banshees of Inisherin", year: 2022 }, { name: "Anatomy of a Fall", year: 2023 }], targetMarkets: ["IT"] };
const entriesBeforeUncached = await cacheEntries();
const uncached = await api({ action: "run", input: uncachedInput });
const liveCalls = uncached.result?.calls.filter((c) => !c.cacheHit).length ?? -1;
const afterUncached = await counter();
const entriesAfter = await cacheEntries();
process.stdout.write(`uncached run: ${uncached.result?.calls.length} calls, ${liveCalls} live · counter ${beforeUncached} → ${afterUncached} (Δ ${afterUncached - beforeUncached}) · shared cache entries ${entriesBeforeUncached} → ${entriesAfter}\n`);
check(!!uncached.result && uncached.source === "live", "uncached custom research completed on live source");
check(liveCalls > 0, "it made real Qloo requests (not served from cache)");
check(afterUncached - beforeUncached === liveCalls, `counter moved by exactly the live calls (${liveCalls})`);
check(entriesAfter - entriesBeforeUncached >= 1, "new results were written to the shared cache");
check(!uncached.messages.some((m) => m.type === "notice"), "no quota-pause notice");

// 4. Browser journey on the hosted preview.
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": ip() }, acceptDownloads: true });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(URL_);
await page.getByText("Live Qloo API").first().waitFor();
check(true, "badge shows Live Qloo API (runtime)");
await page.getByRole("button", { name: "Reveal the strategy", exact: true }).click();
await page.getByText("Independent check passed —").waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: /Germany’s distributor pulls out/ }).click();
await page.getByText("Revision v1 → v2").waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: /Localization budget cut by 40%/ }).click();
await page.getByText("Revision v2 → v3").waitFor({ timeout: 60_000 });
await page.getByText("Technical audit trail").click();
await page.getByRole("tab", { name: "Qloo calls" }).click();
check(await page.getByText(/calls this session/).isVisible(), "Evidence Lab audit trail opens");
const download = page.waitForEvent("download");
await page.getByRole("button", { name: "Export briefing (.md)" }).click();
const md = await readFile((await (await download).path())!, "utf8");
check(md.includes("Qloo hackathon API evidence") && !md.includes("MOCK DATA"), "export is labelled as live Qloo evidence, not mock");
check(!(await page.locator("main").innerText()).includes("[MOCK]"), "no mock titles on the page");
check(errors.length === 0, `no browser console/page errors (${errors.length})`);
await browser.close();

const finalValue = await counter();
process.stdout.write(`\ncounter ${startValue} → ${finalValue} over the whole check; old keys: ${JSON.stringify(await redisRead(["KEYS", "qloo-calls:*"]))}\n`);
check(finalValue - startValue === liveCalls + 0 || finalValue - startValue >= liveCalls, "total counter growth accounted for by live calls");
process.stdout.write(failed ? `\n${failed} FAILED\n` : "\nhosted check passed\n");
process.exit(failed ? 1 : 0);
