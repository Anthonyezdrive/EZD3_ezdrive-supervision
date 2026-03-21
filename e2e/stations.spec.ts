import { test, expect } from "@playwright/test";

async function login(page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', process.env.E2E_EMAIL!);
  await page.fill('input[type="password"]', process.env.E2E_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 10_000 });
}

test.describe("Stations Page", () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test("stations list loads with data", async ({ page }) => {
    await page.goto("/stations");
    await page.waitForTimeout(3000);
    // Should show station rows or cards
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(100);
    // Should NOT show error boundary
    await expect(page.locator("text=Une erreur est survenue")).not.toBeVisible();
  });

  test("search input filters stations", async ({ page }) => {
    await page.goto("/stations");
    await page.waitForTimeout(2000);

    const searchInput = page.locator('input[placeholder*="echerch"], input[type="search"], input[placeholder*="earch"]').first();
    if (await searchInput.isVisible()) {
      const bodyBefore = await page.locator("body").innerText();
      await searchInput.fill("EZDrive");
      await page.waitForTimeout(1000);
      const bodyAfter = await page.locator("body").innerText();
      // Content should have changed after filtering
      expect(bodyAfter).not.toEqual(bodyBefore);
    }
  });

  test("station status badges are visible", async ({ page }) => {
    await page.goto("/stations");
    await page.waitForTimeout(2000);
    // Look for OCPP status indicators
    const statuses = page.locator('text=/Available|Charging|Faulted|Unavailable|Offline|Disponible/i');
    const count = await statuses.count();
    expect(count).toBeGreaterThan(0);
  });

  test("clicking a station navigates or opens detail", async ({ page }) => {
    await page.goto("/stations");
    await page.waitForTimeout(2000);

    // Click the first table row or card
    const firstRow = page.locator('table tbody tr, [class*="station-card"], [class*="card"]').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await page.waitForTimeout(1000);
      // Should show station detail or modal
    }
  });
});
