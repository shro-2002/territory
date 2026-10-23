import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const money = (s: string) => Number(s.replace(/[^\d]/g, ""));

async function figure(page: Page, label: string) {
  return money(await page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("+ dd").innerText());
}

test("judge journey: brief edit, strategy, budget maths, atlas, Germany withdrawal, budget cut, comparison, evidence, export", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Find the world your film belongs to.");
  await expect(page.getByText("Mock data — not Qloo evidence")).toBeAttached();

  // Film brief editing: change the budget through the dialog and run with it.
  await page.getByRole("button", { name: "Use your own film" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Localization budget (USD)").fill("90000");
  await dialog.getByRole("button", { name: "Run live research" }).click();
  await expect(dialog).toBeHidden();

  // Research completion.
  await expect(page.getByRole("heading", { name: /^Investigate .* first\.$/ })).toBeVisible();
  await expect(page.getByText("Independent check passed —")).toBeVisible();
  await expect(page.getByText("What remains uncertain", { exact: true })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/strong fit|weak fit|promising fit/i);

  // Budget calculations: available = planned + remaining, and funded languages sum to planned.
  const [available, planned, remaining] = [await figure(page, "Available"), await figure(page, "Planned spend"), await figure(page, "Remaining")];
  expect(available).toBe(90000);
  expect(planned + remaining).toBe(available);
  const funded = await page.locator("section[aria-labelledby=budget-title] ul li p.display").allInnerTexts();
  expect(funded.map(money).reduce((a, b) => a + b, 0)).toBe(planned);

  // Market selection: from a card and from the map's keyboard-operable country.
  await page.getByRole("button", { name: "Inspect on the atlas" }).first().click();
  await expect(page.getByRole("complementary", { name: /inspector$/ })).toBeVisible();
  const country = page.locator('svg path[role="button"]').first();
  const countryName = ((await country.getAttribute("aria-label")) ?? "").split(":")[0];
  await country.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: `${countryName} inspector` })).toBeVisible();

  // Germany withdrawal.
  await page.getByRole("button", { name: /Germany’s distributor pulls out/ }).click();
  await expect(page.getByText("Revision v1 → v2")).toBeVisible();
  await expect(page.getByText("Dropped Germany — market excluded")).toBeVisible();
  await expect(page.locator('[aria-label="Strategy revision"] li', { hasText: "Germany" }).first()).toContainText("Removed");

  // Budget cut: exactly 40% off the current budget.
  await page.getByRole("button", { name: /Localization budget cut by 40%/ }).click();
  await expect(page.getByText("Revision v2 → v3")).toBeVisible();
  await expect(page.locator('[aria-label="Strategy revision"]')).toContainText(`of ${usd(54000)} planned`);

  // Strategy comparison against the original.
  await page.getByRole("button", { name: "vs original v1" }).click();
  await expect(page.getByText("Revision v1 → v3")).toBeVisible();

  // Evidence Lab: all three levels open and show their content.
  await page.getByText("Evidence and comparable-title logic").click();
  await expect(page.getByText("Your comparable titles, as Qloo resolved them")).toBeVisible();
  await page.getByText("Technical audit trail").click();
  await page.getByRole("tab", { name: "Qloo calls" }).click();
  await expect(page.getByText(/calls this session/)).toBeVisible();

  // Export: the briefing is the v3 plan, with the cut budget and mock labelling.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export briefing (.md)" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^territory-.*-v3\.md$/);
  const md = await readFile((await file.path())!, "utf8");
  expect(md).toContain("MOCK DATA — not Qloo evidence");
  expect(md).toContain(`budget ${usd(54000)}`);
  expect(md).toContain("excluded markets Germany");
});

test("brief dialog closes with Escape and does not start research", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use your own film" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Reveal the strategy" })).toBeEnabled();
});
