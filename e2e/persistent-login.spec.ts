import { expect, test } from "@playwright/test";

const email = process.env.E2E_CLIENT_EMAIL || "client.admin@northline-test.delegation.cloud";
const password = process.env.E2E_PASSWORD;
if (!password) throw new Error("E2E_PASSWORD is required");
const harbor = process.env.E2E_OTHER_CLIENT_EMAIL || "client.admin@harbor-test.delegation.cloud";

test.describe("persistent preview identities", () => {
  test("client admin signs in through production /login, not /demo", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/app\//, { timeout: 20_000 });
    await page.reload();
    await expect(page).toHaveURL(/\/app\//);
    await expect(page.getByText(/Northline Consulting Test|What is in motion/i).first()).toBeVisible();
  });

  test("harbor admin cannot see northline request titles after login", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(harbor);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/app\//, { timeout: 20_000 });
    await page.goto("/app/requests");
    await expect(page.getByText(/Harbor confidential plant/i).first()).toBeVisible();
    await expect(page.getByText(/Conference follow-up/i)).toHaveCount(0);
    await expect(page.getByText(/Northline Consulting Test/i)).toHaveCount(0);
  });
});
