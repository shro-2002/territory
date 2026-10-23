import { expect, test } from "@playwright/test";

test("judge journey: research, inspect, remove a market, cut budget, export", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("unreleased film");
  await expect(page.getByText("Mock data — not Qloo evidence")).toBeVisible();

  await page.getByRole("button", { name: "Run research", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Release plan" })).toBeVisible();
  await expect(page.getByText("✓ Independent check passed")).toBeVisible();

  const remove = page.getByRole("button", { name: /^Remove .* and replan$/ }).first();
  const removedName = ((await remove.getAttribute("aria-label")) ?? "").replace(/^Remove (.*) and replan$/, "$1");
  await remove.click();
  await expect(page.getByText("Revision v1 → v2")).toBeVisible();
  await expect(page.getByText(`${removedName} — market excluded`)).toBeVisible();

  await page.getByRole("button", { name: /Cut budget 40%/ }).click();
  await expect(page.getByText("Revision v2 → v3")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export briefing (.md)" }).click();
  expect((await download).suggestedFilename()).toMatch(/^territory-.*-v3\.md$/);
});
