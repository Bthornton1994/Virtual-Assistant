import { expect, test } from "@playwright/test";

test.describe("AI App Release Rescue offer", () => {
  test("landing states price, limitations, and inactive checkout", async ({ page }) => {
    await page.goto("/ai-app-release-rescue");
    await expect(page.getByRole("heading", { name: /ready to ship/i })).toBeVisible();
    await expect(page.getByText("$299").first()).toBeVisible();
    await expect(page.getByText("$1,250").first()).toBeVisible();
    await expect(page.getByText(/not a penetration test/i).first()).toBeVisible();
    await expect(page.getByText(/Payment is not collected on this page/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Request the \$299 review/i }).first()).toBeVisible();
  });

  test("intake rejects a pasted token and never echoes it", async ({ page }) => {
    await page.goto("/ai-app-release-rescue/intake");
    await page.locator('input[name="contactName"]').fill("Ada Khoury");
    await page.locator('input[name="workEmail"]').fill("ada@harbor.example");
    await page.locator('input[name="repositoryUrl"]').fill("https://github.com/example/harbor-ledger");
    await page.locator('select[name="appType"]').selectOption("next_js_web_app");
    await page.locator('textarea[name="criticalWorkflow"]').fill("Staff sign-in through creating an inventory receipt");
    await page.locator('select[name="accessGrantMethod"]').selectOption("github_collaborator_read_only");
    await page.locator('textarea[name="evidenceNotes"]').fill("use ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    for (const name of [
      "acknowledgedNotPenTest",
      "acknowledgedNotCompliance",
      "acknowledgedNoGuarantee",
      "acknowledgedSingleScope",
      "acknowledgedPointInTime",
      "acknowledgedNoSecretsSubmitted",
    ]) {
      await page.locator(`input[name="${name}"]`).check();
    }
    await page.getByRole("button", { name: /Submit demo request/i }).click();
    await expect(page.getByText(/credential or token/i)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    await expect(page).toHaveURL(/\/intake/);
  });

  test("valid intake records a demo engagement without payment", async ({ page }) => {
    await page.goto("/ai-app-release-rescue/intake");
    await page.locator('input[name="contactName"]').fill("Ada Khoury");
    await page.locator('input[name="workEmail"]').fill("ada@harbor.example");
    await page.locator('input[name="repositoryUrl"]').fill("https://github.com/example/harbor-ledger");
    await page.locator('select[name="appType"]').selectOption("next_js_web_app");
    await page.locator('textarea[name="criticalWorkflow"]').fill("Staff sign-in through creating an inventory receipt");
    await page.locator('select[name="accessGrantMethod"]').selectOption("github_collaborator_read_only");
    for (const name of [
      "acknowledgedNotPenTest",
      "acknowledgedNotCompliance",
      "acknowledgedNoGuarantee",
      "acknowledgedSingleScope",
      "acknowledgedPointInTime",
      "acknowledgedNoSecretsSubmitted",
    ]) {
      await page.locator(`input[name="${name}"]`).check();
    }
    await page.getByRole("button", { name: /Submit demo request/i }).click();
    await expect(page).toHaveURL(/\/ai-app-release-rescue\/demo\/rescue_/);
    await expect(page.getByRole("heading", { name: /Nothing was billed/i })).toBeVisible();
    await expect(page.getByText("Payment not collected")).toBeVisible();
    await expect(page.getByText("Access token absent")).toBeVisible();
    await expect(page.getByText("https://github.com/example/harbor-ledger")).toBeVisible();
  });

  test("sample report is customer-safe and includes limitations", async ({ page }) => {
    await page.goto("/ai-app-release-rescue/demo/report");
    await expect(page.getByText(/Synthetic sample/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Important limitations/i })).toBeVisible();
    await expect(page.getByText("AUTH-001").first()).toBeVisible();
    await expect(page.getByText(/ready with caveats/i).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("exec_demo_internal");
    await expect(page.locator("body")).not.toContainText("org_demo_internal");
    await page.getByRole("link", { name: /Structured JSON/i }).click();
    await expect(page.locator("pre code")).toContainText("schema_version");
    await expect(page.locator("pre code")).not.toContainText("executor_id");
  });
});
