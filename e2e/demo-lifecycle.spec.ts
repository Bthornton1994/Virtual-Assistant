import { expect, test } from "@playwright/test";

test.describe("isolated demo lifecycle", () => {
  test("demo client can open the conference request after password login", async ({ page }) => {
    await page.goto("/demo");
    await page.locator('input[name="email"]').fill("founder@northline.demo");
    await page.locator('input[name="password"]').fill("demo");
    await page.getByRole("button", { name: "Enter sample workspace" }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByRole("heading", { name: /What is in motion/i })).toBeVisible();
    await page.goto("/app/requests");
    await expect(page.getByText(/conference/i).first()).toBeVisible();
  });

  test("demo cookie never signs in at production /login", async ({ page }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: /Elena/i }).click();
    await expect(page).toHaveURL(/\/app\//);
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /Welcome back/i })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
