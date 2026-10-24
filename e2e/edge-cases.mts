// Edge cases through the real brief dialog. Spends a small amount of live Qloo quota when run against a live server.
// Usage: BASE_URL=http://localhost:3001 npx tsx e2e/edge-cases.mts
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function brief(page: Page, comps: Array<[string, string]>, markets: string[]) {
  await page.goto(BASE);
  await page.getByRole("button", { name: "Use your own film" }).click();
  const dialog = page.getByRole("dialog");
  while ((await dialog.getByRole("button", { name: /^Remove comp/ }).count()) > comps.length) await dialog.getByRole("button", { name: /^Remove comp/ }).last().click();
  for (const [i, [name, year]] of comps.entries()) {
    await dialog.getByLabel(`Comp ${i + 1} title`).fill(name);
    await dialog.getByLabel(`Comp ${i + 1} year`).fill(year);
  }
  const pressed = dialog.getByRole("button", { pressed: true });
  while (await pressed.count()) await pressed.first().click();
  for (const m of markets) await dialog.getByRole("button", { name: new RegExp(`^${m}(, priority \\d+)?$`) }).click();
  await dialog.getByRole("button", { name: "Run live research" }).click();
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 1. Cold start: no comp exists in Qloo → explicit failure, no fabricated plan.
await brief(page, [["The Quiet Orchard of Vell", "2024"], ["Hollowmere Tides", "2023"], ["Nine Lanterns for Ostra", "2025"]], ["South Korea", "Japan"]);
await page.getByText(/Research failed for this brief|Research could not run/).first().waitFor({ timeout: 90_000 });
const cold = await page.locator("main").innerText();
process.stdout.write(`cold start: failure shown=${cold.includes("Research failed")} · strategy rendered=${cold.includes("Plan for ")} · audit reason=${/could be resolved|no related titles/i.test(await page.locator("#evidence ~ div").innerText())}\n`);
await page.screenshot({ path: "submission/redesign/edge-cold-start.png", fullPage: false });

// 2. Ambiguous title (Oldboy 2003 vs 2013) with one market → resolution status is surfaced in evidence.
await brief(page, [["Oldboy", ""], ["Parasite", "2019"], ["Burning", "2018"]], ["South Korea"]);
await page.getByText(/Independent check passed —|Research failed for this brief/).first().waitFor({ timeout: 120_000 });
await page.getByText("Evidence and comparable-title logic").click();
const comps = await page.getByText("Your comparable titles, as Qloo resolved them").locator("..").innerText();
process.stdout.write(`ambiguous: ${comps.replace(/\s+/g, " ")}\n`);
const strategy = await page.locator("main").innerText();
process.stdout.write(`ambiguous plan headline: ${(await page.locator("#strategy-title").count()) ? await page.locator("#strategy-title").innerText() : "none"} · uncertainty mentions KR=${/South Korea/.test(strategy)}\n`);
await page.screenshot({ path: "submission/redesign/edge-ambiguous.png", fullPage: false });

await browser.close();
