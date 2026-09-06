import { expect, test, type Page } from "@playwright/test";

const managerEmail = process.env.E2E_MANAGER_EMAIL || "ops.manager@delegation-test.cloud";
const password = process.env.E2E_PASSWORD;
const runId = process.env.QA_TWL_RUN_ID;

if (!password) throw new Error("E2E_PASSWORD is required for the PR67 live QA walkthrough");
if (!runId) throw new Error("QA_TWL_RUN_ID is required for the PR67 live QA walkthrough");

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(managerEmail);
  await page.locator('input[name="password"]').fill(password!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/ops\//, { timeout: 30_000 });
}

test.describe("PR67 durable prepare-only public PR evidence", () => {
  test.setTimeout(180_000);

  test("walks the seeded QA run through staff UI and issues a passing receipt", async ({ page }, testInfo) => {
    await login(page);
    await page.goto(`/ops/execution/runs/${runId}`);

    await expect(page.getByRole("heading", { name: "Prepare-only public PR proof" })).toBeVisible();
    await expect(page.getByText("planned", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("merge_performed=false · mutatesRepository=false · deploy unauthorized")).toBeVisible();

    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByText("running", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Assign worker" }).click();
    await expect(page.getByText("SF-TWL prepare-only shadow", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("no", { exact: true }).first()).toBeVisible();

    await page.locator('input[name="owner"]').fill("octocat");
    await page.locator('input[name="repo"]').fill("Hello-World");
    await page.locator('input[name="pullNumber"]').fill("1");
    await page.getByRole("button", { name: "Attach public PR evidence" }).click();

    await expect(page.getByRole("link", { name: "octocat/Hello-World#1" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("ready for human review", { exact: true })).toBeVisible();
    await expect(page.getByText(/sha256:/).first()).toBeVisible();

    await page.getByRole("button", { name: "Freeze and submit for verification" }).click();
    await expect(page.getByRole("heading", { name: "Issue Outcome Receipt" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("awaiting verification", { exact: true }).first()).toBeVisible();

    await page.locator('input[name="definitionOfDoneMet"]').check();
    await page.locator('textarea[name="summary"]').fill(
      "PR67 live QA proof passed: durable prepare-only public PR evidence was verified through the staff UI.",
    );
    await page.locator('textarea[name="verificationNotes"]').fill(
      "Verified assignment observation and hashed anonymous public GitHub PR source. Merge and deploy remained unauthorized.",
    );
    await page.locator('textarea[name="actionsTaken"]').fill(
      "Started durable QA run\nAssigned shadow worker\nAttached public PR evidence\nSubmitted for independent verification",
    );
    await page.locator('input[name="qaScore"]').fill("100");
    await page.getByRole("button", { name: "Pass and issue receipt" }).click();

    await expect(page.getByText("verified", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("passed", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Definition of done").last()).toBeVisible();
    await expect(page.getByText("Met", { exact: true })).toBeVisible();
    await expect(page.getByText("merge_performed=false · mutatesRepository=false · deploy unauthorized")).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath("pr67-live-qa-proof.png"), fullPage: true });
  });
});
