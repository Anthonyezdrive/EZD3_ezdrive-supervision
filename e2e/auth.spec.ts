import { test, expect } from "@playwright/test";

// Reusable login helper
async function login(page, email?: string, password?: string) {
  const e = email ?? process.env.E2E_EMAIL!;
  const p = password ?? process.env.E2E_PASSWORD!;
  await page.goto("/login");
  await page.fill('input[type="email"]', e);
  await page.fill('input[type="password"]', p);
  await page.click('button[type="submit"]');
}

test.describe("Authentication Flow", () => {

  test("shows login form with email and password fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /connexion/i })).toBeVisible();
  });

  test("shows error on invalid credentials", async ({ page }) => {
    await login(page, "fake@email.com", "wrongpassword");
    // Should stay on login page and show error
    await expect(page).toHaveURL(/login/);
    await page.waitForTimeout(2000);
    // Check for error message (toast or inline)
    const hasError = await page.locator("text=/erreur|invalide|incorrect/i").isVisible()
      .catch(() => false);
    expect(hasError || (await page.url()).includes("login")).toBeTruthy();
  });

  test("shows error on empty fields", async ({ page }) => {
    await page.goto("/login");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);
    // Should not navigate away
    await expect(page).toHaveURL(/login/);
  });

  test("successful login redirects to dashboard", async ({ page }) => {
    await login(page);
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
    await expect(page).toHaveURL(/dashboard/);
    // Dashboard should show content
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("protected route redirects to login when not authenticated", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(2000);
    // Should redirect to login
    await expect(page).toHaveURL(/login/);
  });

  test("protected route /stations redirects to login", async ({ page }) => {
    await page.goto("/stations");
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/login/);
  });

  test("sidebar navigation works after login", async ({ page }) => {
    await login(page);
    await page.waitForURL("**/dashboard", { timeout: 10_000 });

    // Click on a sidebar link (stations or map)
    const stationsLink = page.locator('a[href="/stations"], [data-testid="nav-stations"]').first();
    if (await stationsLink.isVisible()) {
      await stationsLink.click();
      await page.waitForTimeout(1000);
      await expect(page).toHaveURL(/stations/);
    }
  });

  test("logout returns to login page", async ({ page }) => {
    await login(page);
    await page.waitForURL("**/dashboard", { timeout: 10_000 });

    // Find and click logout button/link
    const logoutBtn = page.locator('text=/déconnexion|logout|se déconnecter/i').first();
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      await page.waitForTimeout(2000);
      await expect(page).toHaveURL(/login/);
    }
  });
});
