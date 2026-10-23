// Runtime measurements of the hero globe plus accessibility probes. Usage: BASE_URL=http://localhost:3000 npx tsx e2e/perf-a11y.mts
// Run against `next start` (production build) for meaningful numbers.
import { chromium, type BrowserContextOptions, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const log = (s: string) => process.stdout.write(`${s}\n`);

// Counts rAF callbacks and long tasks from the first script on the page.
const PROBE = `
  window.__raf = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { window.__raf++; cb(t); });
  window.__long = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ type: "longtask", buffered: true });
  window.__lcp = 0;
  new PerformanceObserver((l) => { const e = l.getEntries().at(-1); if (e) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
`;

// Passed as a string: tsx's keepNames would otherwise inject a __name helper the page lacks.
async function framesPerSecond(page: Page, ms = 3000): Promise<number> {
  return page.evaluate(`new Promise((resolve) => { let n = 0; const start = performance.now(); const tick = () => { n++; if (performance.now() - start < ${ms}) requestAnimationFrame(tick); else resolve((n * 1000) / (performance.now() - start)); }; requestAnimationFrame(tick); })`);
}

async function measure(name: string, opts: BrowserContextOptions, cpuThrottle: number) {
  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.addInitScript(PROBE);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("section#top canvas").waitFor({ state: "attached", timeout: 30_000 });
  const canvasAt = Date.now() - t0;
  const three = await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => r.name.includes("/_next/static/chunks/")).map((r) => r as PerformanceResourceTiming).sort((a, b) => b.transferSize - a.transferSize)[0]);
  await page.waitForTimeout(1500);
  const fps = await framesPerSecond(page);
  const longTasks = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  const lcp = await page.evaluate(() => (window as unknown as { __lcp: number }).__lcp);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
  await page.waitForTimeout(1000);
  const offscreenRaf = (await page.evaluate(() => (window as unknown as { __raf: number }).__raf)) - before;
  log(`${name} (CPU ×${cpuThrottle}): canvas attached ${canvasAt} ms · LCP ${Math.round(lcp)} ms · globe ${fps.toFixed(0)} fps · long tasks ${longTasks.length} (max ${Math.round(Math.max(0, ...longTasks))} ms) · largest chunk ${Math.round((three?.transferSize ?? 0) / 1024)} KB · rAF callbacks/s while scrolled away ${offscreenRaf}`);
  await browser.close();
}

async function fallbacks() {
  const noGl = await chromium.launch({ args: ["--disable-webgl", "--disable-3d-apis"] });
  const page = await noGl.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.waitForTimeout(3000);
  log(`WebGL disabled: canvas=${await page.locator("section#top canvas").count()} · poster visible=${await page.locator("section#top [aria-hidden] div.rounded-full").first().isVisible()} · page errors=${errors.length} · CTA works=${await page.getByRole("button", { name: "Reveal the strategy" }).isEnabled()}`);
  await noGl.close();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const rm = await ctx.newPage();
  await rm.addInitScript(PROBE);
  await rm.goto(BASE);
  await rm.waitForTimeout(2500);
  const a = await rm.evaluate(() => (window as unknown as { __raf: number }).__raf);
  await rm.waitForTimeout(1000);
  const b = await rm.evaluate(() => (window as unknown as { __raf: number }).__raf);
  log(`Reduced motion: rAF callbacks/s on hero ${b - a} · globe drawn=${await rm.locator("section#top canvas").count()}`);
  await ctx.close();

  // Keyboard: reach the CTA, run, select a market on the map with Enter, open and Escape the brief dialog.
  const kb = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await kb.goto(BASE);
  let reachedCta = false;
  for (let i = 0; i < 12 && !reachedCta; i++) {
    await kb.keyboard.press("Tab");
    reachedCta = (await kb.evaluate(() => document.activeElement?.textContent)) === "Reveal the strategy";
  }
  await kb.keyboard.press("Enter");
  await kb.getByText("Independent check passed —").waitFor();
  const path = kb.locator('svg path[role="button"]').nth(2);
  const name = await path.getAttribute("aria-label");
  await path.focus();
  await kb.keyboard.press("Enter");
  const inspector = await kb.getByRole("complementary", { name: /inspector$/ }).getAttribute("aria-label");
  await kb.getByRole("button", { name: "Edit film brief" }).first().click();
  const opened = await kb.getByRole("dialog").isVisible();
  await kb.keyboard.press("Escape");
  await kb.waitForTimeout(300);
  log(`Keyboard: CTA reached by Tab=${reachedCta} · map Enter on "${name}" → ${inspector} · dialog opened=${opened}, Escape closed=${!(await kb.getByRole("dialog").isVisible())}`);
  const unlabeled = await kb.evaluate(() => [...document.querySelectorAll("button, a[href], [role=button]")].filter((el) => !(el.getAttribute("aria-label") || el.textContent?.trim())).length);
  const images = await kb.evaluate(() => [...document.querySelectorAll("[role=img]")].filter((el) => !el.getAttribute("aria-label")).length);
  log(`Labels: unlabelled interactive elements ${unlabeled} · role=img without label ${images}`);
  await browser.close();
}

await measure("desktop 1440×900", { viewport: { width: 1440, height: 900 } }, 1);
await measure("mobile 390×844", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, 4);
await fallbacks();
