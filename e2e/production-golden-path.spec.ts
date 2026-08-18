import { expect, test, type Page } from "@playwright/test";

const clientEmail = process.env.E2E_CLIENT_EMAIL;
const clientPassword = process.env.E2E_CLIENT_PASSWORD;
const managerEmail = process.env.E2E_MANAGER_EMAIL;
const managerPassword = process.env.E2E_MANAGER_PASSWORD;
const operatorEmail = process.env.E2E_OPERATOR_EMAIL;
const operatorPassword = process.env.E2E_OPERATOR_PASSWORD;
const otherClientEmail = process.env.E2E_OTHER_CLIENT_EMAIL;
const otherClientPassword = process.env.E2E_OTHER_CLIENT_PASSWORD;

const configured = Boolean(
  process.env.E2E_RUN_UI === "1" &&
    clientEmail &&
    clientPassword &&
    managerEmail &&
    managerPassword &&
    operatorEmail &&
    operatorPassword,
);

test.describe("production multi-role golden path", () => {
  test.skip(!configured, "Requires E2E_* production identities against Preview Supabase.");

  test("moves one request through the persistent lifecycle", async ({ page, context }) => {
    const title = `Golden path ${Date.now()}`;

    await login(page, clientEmail!, clientPassword!);
    await page.goto("/app/requests/new");
    await page.getByLabel(/title|what|outcome/i).first().fill(title);
    const objective = page.getByLabel(/objective/i);
    if (await objective.count()) await objective.fill("Every conference lead has an owner and a next step.");
    const description = page.getByLabel(/description|what/i).last();
    if (await description.count()) {
      await description.fill(
        "Inspect CRM. Identify unassigned conference leads. Draft follow-up emails. Do not send until approved.",
      );
    }
    const deliverable = page.getByLabel(/deliverable/i);
    if (await deliverable.count()) await deliverable.fill("Owner list plus drafted follow-ups");
    const external = page.getByLabel(/external/i);
    if (await external.count()) await external.check();
    await page.getByRole("button", { name: /delegate|create|submit/i }).first().click();
    await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]+/i, { timeout: 30_000 });
    const requestUrl = page.url();
    const requestId = requestUrl.split("/").pop()!;

    await page.reload();
    await expect(page.getByText(title)).toBeVisible();

    if (await page.getByLabel(/answer/i).count()) {
      await page.getByLabel(/answer/i).first().fill("Use HubSpot. Public notes only. Do not send.");
      await page.getByRole("button", { name: /answer|save/i }).first().click();
    }

    await page.goto("/app/approvals");
    await page.reload();
    const approve = page.getByRole("button", { name: /approve/i }).first();
    await expect(approve).toBeVisible({ timeout: 20_000 });
    await approve.click();

    await logout(page);
    await login(page, managerEmail!, managerPassword!);
    await page.goto(`/ops/requests/${requestId}`);
    await expect(page.getByText(title)).toBeVisible();
    const assign = page.locator("select[name=operatorId], select[name=operator]");
    if (await assign.count()) {
      const options = assign.locator("option");
      const value = await options.nth(1).getAttribute("value");
      if (value) await assign.selectOption(value);
      await page.getByRole("button", { name: /assign/i }).first().click();
    }

    await logout(page);
    await login(page, operatorEmail!, operatorPassword!);
    await page.goto(`/ops/requests/${requestId}`);
    await expect(page.getByText(title)).toBeVisible();
    for (const status of ["in_progress", "qa"]) {
      const control = page.locator(`button[value="${status}"], option[value="${status}"]`).first();
      if (await control.count()) {
        await page.locator("select[name=status]").selectOption(status).catch(async () => {
          await page.getByRole("button", { name: new RegExp(status.replaceAll("_", " "), "i") }).first().click();
        });
      }
    }

    await page.goto("/ops/qa");
    if (await page.getByRole("button", { name: /approve/i }).count()) {
      await page.getByRole("button", { name: /approve/i }).first().click();
    }

    await logout(page);
    await login(page, clientEmail!, clientPassword!);
    await page.goto("/app/approvals");
    if (await page.getByRole("button", { name: /approve/i }).count()) {
      await page.getByRole("button", { name: /approve/i }).first().click();
    }

    await logout(page);
    await login(page, operatorEmail!, operatorPassword!);
    await page.goto(`/ops/requests/${requestId}`);
    const summary = page.getByLabel(/summary/i);
    if (await summary.count()) {
      await summary.fill("Prepared owner list and drafts. Nothing was sent.");
      await page.getByRole("button", { name: /deliver/i }).first().click();
    }

    await logout(page);
    await login(page, clientEmail!, clientPassword!);
    await page.goto(`/app/requests/${requestId}`);
    await expect(page.getByText(title)).toBeVisible();
    if (await page.getByRole("button", { name: /accept/i }).count()) {
      await page.getByRole("button", { name: /accept/i }).first().click();
    }
    if (await page.getByRole("button", { name: /playbook/i }).count()) {
      await page.getByRole("button", { name: /playbook/i }).first().click();
    }

    await page.reload();
    await expect(page.getByText(title)).toBeVisible();

    if (otherClientEmail && otherClientPassword) {
      const other = await context.newPage();
      await login(other, otherClientEmail, otherClientPassword);
      await other.goto(`/app/requests/${requestId}`);
      await expect(other.getByText(title)).toHaveCount(0);
      await other.close();
    }
  });
});

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(app|ops)\//);
}

async function logout(page: Page) {
  const button = page.getByRole("button", { name: /log out|sign out/i });
  if (await button.count()) await button.click();
  else await page.goto("/");
}
