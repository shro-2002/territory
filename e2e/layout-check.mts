// Layout sweep across real device widths and browser-zoom equivalents (a 1440px screen at 125% zoom is a 1152px viewport).
// Run against a MOCK server: layout only, no Qloo evidence is judged here.
// Usage: BASE_URL=http://localhost:3301 npx tsx e2e/layout-check.mts   (OUT=submission/polish to keep screenshots)
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3301";
const OUT = process.env.OUT ?? "submission/polish";
const SHOT = new Set([1152, 960, 820, 390]);
// width, label
const SIZES: Array<[number, number, string]> = [
  [1920, 1080, "1920 desktop 100%"], [1536, 864, "1920 screen at 125%"], [1440, 900, "1440 laptop 100%"],
  [1280, 800, "1440 laptop 113% / 1920 at 150%"], [1152, 720, "1440 laptop 125%"], [1097, 617, "1920 screen at 175%"],
  [960, 600, "1440 laptop 150% / 1920 at 200%"], [820, 1180, "iPad Air portrait"], [768, 1024, "iPad portrait"],
  [1024, 768, "iPad landscape"], [390, 844, "iPhone 15"], [360, 740, "small Android"],
];
let failed = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failed++;
  process.stdout.write(`  ${ok ? "ok  " : "FAIL"} ${what}\n`);
};

const browser = await chromium.launch();
for (const [i, [width, height, label]] of SIZES.entries()) {
  const mobile = width < 600;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, extraHTTPHeaders: { "x-forwarded-for": `10.9.0.${i + 1}` } });
  const page = await ctx.newPage();
  process.stdout.write(`${width}×${height} ${label}\n`);
  await page.goto(BASE);
  await page.waitForTimeout(1800);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check((await overflow()) <= 0, "hero: no horizontal overflow");
  const cta = await page.getByRole("button", { name: "Reveal the strategy" }).boundingBox();
  check(!!cta && cta.y + cta.height <= height, "hero: primary button visible without scrolling");
  const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
  check(!!h1 && h1.x >= 0 && h1.x + h1.width <= width, "hero: headline inside viewport");
  if (SHOT.has(width)) await page.screenshot({ path: `${OUT}/hero-${width}.png` });

  await page.getByRole("button", { name: "Reveal the strategy" }).click();
  await page.getByText("Independent check passed —").waitFor();
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await page.waitForTimeout(1200);
  check((await overflow()) <= 0, "strategy: no horizontal overflow");

  const link = page.locator('a[href="#budget"]').last();
  await page.locator("#strategy").evaluate((el) => el.scrollIntoView());
  const linkBox = await link.boundingBox();
  check(!!linkBox && linkBox.y > 0 && linkBox.y + linkBox.height < height + 400, "strategy: budget link is within the first screens of the section");

  const firstBody = page.locator("#strategy ~ ol > li").first().locator("div[id]").first();
  const bodyVisible = await firstBody.isVisible();
  if (width < 768) {
    check(!bodyVisible, "mobile: card details collapsed by default");
    const strategyHeight = await page.locator("#strategy ~ ol").evaluate((el) => el.getBoundingClientRect().height);
    check(strategyHeight < 1500, `mobile: five-market list stays compact (${Math.round(strategyHeight)}px)`);
    const toggle = page.locator("#strategy ~ ol > li").first().getByRole("button", { name: /^(Why |Hide details)/ });
    const tb = await toggle.boundingBox();
    check(!!tb && tb.height >= 44, "mobile: toggle is at least 44px tall");
    await toggle.click();
    check(await firstBody.isVisible(), "mobile: details open on toggle");
  } else {
    check(bodyVisible, "desktop/tablet: card details visible without toggling");
  }
  const wide = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1 && !el.closest("svg, [aria-hidden=true], .tilt, canvas, .overflow-x-auto, .overflow-auto"); }).length);
  check(wide === 0, `no content element extends past the viewport (${wide})`);
  const navLinks = await page.locator('nav[aria-label="Sections"]').isVisible();
  check(width >= 768 ? navLinks : true, "section nav shown where it fits");

  await page.getByRole("button", { name: /distributor pulls out/ }).first().click();
  await page.getByText("Revision v1 → v2").waitFor();
  await page.waitForTimeout(1200);
  check((await overflow()) <= 0, "war room: no horizontal overflow");
  check(await page.getByText("Currently displayed").isVisible(), "war room: displayed revision is labelled");
  check(await page.locator('button[aria-current="true"]').count() <= 1, "war room: at most one scenario marked as showing");
  if (SHOT.has(width)) {
    await page.locator('[aria-label="Strategy revision"]').first().screenshot({ path: `${OUT}/revision-${width}.png` });
    await page.locator("#strategy").evaluate((el) => el.scrollIntoView());
    await page.screenshot({ path: `${OUT}/strategy-${width}.png` });
  }
  await ctx.close();
}
await browser.close();
process.stdout.write(failed ? `\n${failed} FAILED\n` : "\nlayout sweep passed\n");
process.exit(failed ? 1 : 0);
