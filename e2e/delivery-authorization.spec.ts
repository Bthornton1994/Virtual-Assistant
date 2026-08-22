import { expect, test, type Page } from "@playwright/test";

async function demoLogin(page: Page, email: string) {
  await page.goto("/demo");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("demo");
  await page.getByRole("button", { name: "Enter sample workspace" }).click();
  await page.waitForURL(/\/(app|ops)\//, { timeout: 20_000 });
}

async function signOut(page: Page) {
  const button = page.getByRole("button", { name: /sign out/i });
  if (await button.count()) {
    await button.click();
    await page.waitForURL(/\/$|\/login|\/demo/, { timeout: 20_000 }).catch(() => undefined);
  }
  await page.context().clearCookies();
}

const onPreview = Boolean(process.env.PLAYWRIGHT_BASE_URL?.includes("vercel.app"));

test.describe("delivery form authorization", () => {
  test.skip(onPreview, "Demo MemoryStore is per-instance on Preview; run this spec locally.");

  test("shows Deliver only to the assigned operator and managers", async ({ page, context }) => {
    await demoLogin(page, "manager@delegation.cloud");
    await page.goto("/ops/requests/req_inbox");
    await expect(page.getByRole("heading", { name: /triage founder inbox/i })).toBeVisible({ timeout: 20_000 });
    await page.locator('select[name="status"]').first().selectOption("in_progress");
    await page.getByRole("button", { name: /update status/i }).click();
    await expect(page.getByRole("button", { name: /submit for qa/i })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /submit for qa/i }).click();
    await expect(page.getByRole("heading", { name: /^QA$/ })).toBeVisible({ timeout: 20_000 });
    await page.locator('textarea[name="notes"]').fill("Ready to deliver.");
    await page.locator('button[name="passed"][value="true"]').click();
    await expect(page.getByRole("heading", { name: /^Deliver$/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /deliver package/i })).toBeVisible();

    await signOut(page);
    await demoLogin(page, "op@delegation.cloud");
    await page.goto("/ops/requests/req_inbox");
    await expect(page.getByRole("heading", { name: /^Deliver$/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /deliver package/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^QA$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /update status/i })).toHaveCount(0);

    await signOut(page);
    await demoLogin(page, "julian@delegation.cloud");
    await page.goto("/ops/requests/req_inbox");
    await expect(page.getByRole("heading", { name: /^Deliver$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /deliver package/i })).toHaveCount(0);

    const client = await context.newPage();
    await demoLogin(client, "founder@northline.demo");
    await client.goto("/ops/requests/req_inbox");
    await expect(client).not.toHaveURL(/\/ops\/requests\/req_inbox/);
    await client.goto("/app/requests/req_inbox");
    await expect(client.getByRole("button", { name: /deliver package/i })).toHaveCount(0);
    await client.close();
  });
});
