// Live consistency check: drives the UI against a running server and asserts that what the page shows
// is exactly what the agent's session says. Usage: BASE_URL=http://localhost:3001 npx tsx e2e/live-check.mts
import { chromium, type Page } from "@playwright/test";

import type { Session } from "../src/lib/agent/agent";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${what}\n`);
  if (!ok) failures.push(what);
};

/** Buffers /api/agent responses (route.fetch) so the test can read the session the UI received. */
let pending: ((v: { session: Session; calls: Array<{ cacheHit: boolean }> }) => void) | null = null;
function nextSession(): Promise<{ session: Session; calls: Array<{ cacheHit: boolean }> }> {
  return new Promise((resolve) => (pending = resolve));
}

async function text(page: Page, selector: string) {
  return (await page.locator(selector).first().innerText()).replace(/\s+/g, " ");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route("**/api/agent", async (route) => {
  const response = await route.fetch();
  const body = await response.text();
  const result = body.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.type === "result");
  if (result) pending?.({ session: result.session, calls: result.calls });
  await route.fulfill({ response, body });
});
await page.goto(BASE);
const source = ((await page.locator("header").first().textContent()) ?? "").includes("Live Qloo API") ? "live" : "mock";
process.stdout.write(`source: ${source}\n`);

const first = nextSession();
await page.getByRole("button", { name: "Reveal the strategy", exact: true }).click();
const { session: v1, calls } = await first;
await page.getByText("Independent check passed —").waitFor();
process.stdout.write(`v1: ${v1.plan.markets.map((m) => `${m.code}/${m.mode}`).join(", ")} · ${calls.length} calls (${calls.filter((c) => !c.cacheHit).length} live)\n`);

const heading = await text(page, "#strategy-title");
check(v1.plan.markets.every((m) => heading.includes(m.name)), "strategy headline names every planned market");
const cards = page.locator("#strategy ~ ol > li");
check((await cards.count()) === v1.plan.markets.length, "one card per planned market");
for (const [i, m] of v1.plan.markets.entries()) {
  const card = (await cards.nth(i).innerText()).replace(/\s+/g, " ");
  check(card.includes(m.name) && card.includes(m.score.toFixed(2)), `card ${i + 1} shows ${m.name} with its ${m.score.toFixed(2)}× ratio in planner order`);
}
const budget = await text(page, "section[aria-labelledby=budget-title]");
const c = v1.input.constraints;
check(budget.includes(usd(c.budgetUsd)) && budget.includes(usd(v1.plan.totalCostUsd)) && budget.includes(usd(c.budgetUsd - v1.plan.totalCostUsd)), "budget figures equal constraint budget, planned and remaining");
for (const l of v1.plan.languages) check(budget.includes(l.language) && budget.includes(usd(l.costUsd)), `language action ${l.language} ${l.mode} ${usd(l.costUsd)}`);
const body = await page.locator("main").innerText();
check(source === "mock" || !body.includes("[MOCK]"), "no mock titles on a live page");
check(source === "mock" || v1.claims.every((cl) => cl.source !== "mock"), "no mock-sourced claims in a live session");
check(!/strong fit|weak fit|promising fit/i.test(body), "no strong/weak/promising market grades");
check(!/probabilit|will succeed|guarantee/i.test(body), "no success-probability language");

const shock = v1.plan.markets.find((m) => m.code === "DE") ?? v1.plan.markets.find((m) => m.mode !== "original") ?? v1.plan.markets[0];
const second = nextSession();
await page.getByRole("button", { name: new RegExp(`${shock.name}’s distributor pulls out`) }).click();
const { session: v2 } = await second;
await page.getByText("Revision v1 → v2").waitFor();
const compare = await text(page, '[aria-label="Strategy revision"]');
check(!v2.plan.markets.some((m) => m.code === shock.code), `${shock.name} absent from revised plan`);
check(v2.plan.markets.every((m) => compare.includes(m.name)), "revised column lists every v2 market");
check(compare.includes(usd(v2.plan.totalCostUsd)), "revised spend matches planner");
const rev = v2.revisions.at(-1)!;
check(rev.changes.every((ch) => compare.includes(ch.text)), "every planner change reason is shown verbatim");

const third = nextSession();
await page.getByRole("button", { name: /Localization budget cut by 40%/ }).click();
const { session: v3 } = await third;
await page.getByText("Revision v2 → v3").waitFor();
check(v3.input.constraints.budgetUsd === Math.round(v2.input.constraints.budgetUsd * 0.6), "budget cut is exactly 40%");
check(v3.plan.totalCostUsd <= v3.input.constraints.budgetUsd && v3.violations.length === 0, "v3 within budget, no violations");
check((await text(page, '[aria-label="Strategy revision"]')).includes(usd(v3.plan.totalCostUsd)), "v3 spend shown");

await browser.close();
process.stdout.write(failures.length ? `\n${failures.length} FAILED\n` : "\nall checks passed\n");
process.exit(failures.length ? 1 : 0);
