// Drives the full app journey against a server started with TERRITORY_CSP=report-only|enforce and reports every CSP violation.
// Usage: BASE_URL=http://localhost:3303 npx tsx e2e/csp-check.mts   (mock server: no Qloo quota involved)
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3303";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, extraHTTPHeaders: { "x-forwarded-for": `10.2.${Math.floor(Math.random() * 250)}.1` } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  (window as unknown as { __csp: string[] }).__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} blocked=${e.blockedURI || "inline"} ${e.disposition} at ${e.sourceFile.split("/").pop()}:${e.lineNumber}:${e.columnNumber} sample=${e.sample}`));
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
const res = await page.goto(BASE);
const headers = res!.headers();
process.stdout.write(`headers: xfo=${headers["x-frame-options"]} referrer=${headers["referrer-policy"]} csp=${headers["content-security-policy"] ? "enforced" : headers["content-security-policy-report-only"] ? "report-only" : "none"}\n`);
await page.waitForTimeout(2500);
const canvas = await page.locator("section#top canvas").count();
await page.getByRole("button", { name: "Reveal the strategy", exact: true }).click(); // streaming NDJSON over fetch
await page.getByText("Independent check passed —").waitFor();
await page.getByRole("button", { name: /distributor pulls out/ }).first().click();
await page.getByText("Revision v1 → v2").waitFor();
await page.getByText("Technical audit trail").click();
await page.getByRole("button", { name: "Edit film brief" }).first().click(); // native <dialog>
await page.keyboard.press("Escape");
const download = page.waitForEvent("download");
await page.getByRole("button", { name: "Export briefing (.md)" }).click(); // blob: download
const file = await download;
const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
const unique = [...new Set(violations)];
process.stdout.write(`globe canvas present: ${canvas === 1} · export file: ${file.suggestedFilename()} · page/console errors: ${errors.length}\n`);
process.stdout.write(`CSP violations: ${violations.length} (${unique.length} distinct)\n${unique.map((v) => `  - ${v}`).join("\n")}\n`);
if (errors.length) process.stdout.write(`errors:\n${errors.map((e) => `  - ${e}`).join("\n")}\n`);
await browser.close();
process.exit(violations.length || errors.length || !canvas ? 1 : 0);
