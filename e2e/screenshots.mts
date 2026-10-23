// Review screenshots of the real app state. Usage: BASE_URL=http://localhost:3001 npx tsx e2e/screenshots.mts
// Output: submission/redesign/ (gitignored). A hero · B strategy + budget · C atlas · D War Room revision.
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "submission/redesign";
const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 },
  { name: "tablet", viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: "mobile", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
] as const;

/** Full-page clip spanning from the top of one element to the bottom of another. */
async function span(page: Page, from: string, to: string, path: string) {
  const a = await page.locator(from).first().boundingBox();
  const b = await page.locator(to).first().boundingBox();
  const scrollY = await page.evaluate(() => window.scrollY);
  if (!a || !b) throw new Error(`missing ${from} or ${to}`);
  // A stitched full-page capture would paint the sticky nav mid-image; park it at the top instead.
  await page.addStyleTag({ content: "header.sticky{position:absolute!important}" });
  const top = a.y + scrollY - 24;
  await page.screenshot({ path, fullPage: true, clip: { x: 0, y: top, width: page.viewportSize()!.width, height: b.y + scrollY + b.height - top + 24 } });
}

const browser = await chromium.launch();
for (const v of VIEWPORTS) {
  const page = await (await browser.newContext({ ...v, reducedMotion: "no-preference" })).newPage();
  await page.goto(BASE);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/A-hero-${v.name}.png` });
  await page.getByRole("button", { name: "Reveal the strategy", exact: true }).click();
  await page.getByText("Independent check passed —").waitFor();
  await page.waitForTimeout(1500);
  await span(page, "section[aria-labelledby=strategy-title]", "section[aria-labelledby=budget-title]", `${OUT}/B-strategy-budget-${v.name}.png`);
  await page.getByRole("button", { name: "Germany 0.96×" }).click().catch(() => page.locator("[aria-label='Researched markets'] button").nth(1).click());
  await page.waitForTimeout(600);
  await page.locator("section[aria-labelledby=atlas-title]").screenshot({ path: `${OUT}/C-atlas-${v.name}.png` });
  await page.getByRole("button", { name: /distributor pulls out/ }).first().click();
  await page.getByText("Revision v1 → v2").waitFor();
  await page.waitForTimeout(1500);
  await span(page, "section[aria-labelledby=war-title]", '[aria-label="Strategy revision"]', `${OUT}/D-war-room-${v.name}.png`);
  await page.context().close();
}
await browser.close();
process.stdout.write("screenshots written\n");
