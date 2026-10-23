// Captures submission screenshots from the running dev server (live key, cached). Output: submission/ (gitignored).
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000");
await page.screenshot({ path: "submission/1-landing.png" });
await page.getByRole("button", { name: "Run research", exact: true }).click();
await page.getByRole("heading", { name: "Release plan" }).waitFor();
await page.screenshot({ path: "submission/2-atlas-evidence.png" });
await page.locator("#reality-shock").scrollIntoViewIfNeeded();
await page.screenshot({ path: "submission/3-reality-shock.png" });
await page.getByRole("button", { name: /buyer pulled out/ }).click();
await page.getByText("Revision v1 → v2").waitFor();
await page.getByText("Revision v1 → v2").scrollIntoViewIfNeeded();
await page.screenshot({ path: "submission/4-revision.png" });
await page.getByRole("button", { name: /Financier cut/ }).click();
await page.getByText("Revision v2 → v3").waitFor();
await page.getByText("Revision v2 → v3").scrollIntoViewIfNeeded();
await page.screenshot({ path: "submission/5-budget-cut.png" });
await page.getByRole("heading", { name: "What Qloo actually contributed" }).scrollIntoViewIfNeeded();
await page.screenshot({ path: "submission/6-evidence-lab.png" });
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://localhost:3000");
await page.screenshot({ path: "submission/7-mobile.png", fullPage: false });
await browser.close();
process.stdout.write("screenshots written\n");
