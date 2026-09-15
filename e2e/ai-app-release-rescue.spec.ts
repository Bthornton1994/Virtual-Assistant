import { expect, test } from "@playwright/test";

// A fabricated token, used to prove the intake boundary refuses one and never
// hands it back to the page. It is not a real credential.
const FAKE_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

const ATTESTATIONS = [
  "authorizedToGrantRepositoryAccess",
  "ownsOrIsAuthorisedByOwnerOfTheCode",
  "accessGrantedIsReadOnly",
  "noProductionCredentialsProvided",
  "noEndUserPersonalDataProvided",
  "understandsNotPenetrationTest",
  "understandsNotComplianceCertification",
  "understandsNoSecurityGuarantee",
  "understandsFindingsRequireCustomerAction",
];

async function fillValidIntake(page: import("@playwright/test").Page) {
  await page.locator('input[name="contactName"]').fill("Ada Khoury");
  await page.locator('input[name="workEmail"]').fill("ada@harbor.example");
  await page.locator('input[name="repositoryUrl"]').fill("https://github.com/example/harbor-ledger");
  await page.locator('select[name="appType"]').selectOption("next_js_web_app");
  await page
    .locator('textarea[name="criticalWorkflow"]')
    .fill("Staff sign in and then create an inventory receipt end to end.");
  await page.locator('input[name="criticalWorkflowEntryPoint"]').fill("/receipts/new");
  await page.locator('select[name="accessGrantMethod"]').selectOption("customer_added_readonly_collaborator");
  await page.locator('select[name="accessWindowDays"]').selectOption("14");
  await page.locator('select[name="retentionPolicy"]').selectOption("minimum_7_day");
  for (const name of ATTESTATIONS) {
    await page.locator(`input[name="${name}"]`).check();
  }
}

test.describe("AI App Release Rescue offer", () => {
  test("landing states price, limitations, and inactive checkout", async ({ page }) => {
    await page.goto("/ai-app-release-rescue");
    await expect(page.getByText("$299").first()).toBeVisible();
    await expect(page.getByText("$1,250").first()).toBeVisible();
    await expect(page.getByText(/not a penetration test/i).first()).toBeVisible();
    await expect(page.getByText(/Payment is not collected on this page/i).first()).toBeVisible();
  });

  test("the intake form offers no field that could carry a credential", async ({ page }) => {
    await page.goto("/ai-app-release-rescue/intake");
    const names = await page.locator("form [name]").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("name") ?? ""),
    );

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(/token|password|secret|api[_-]?key|private[_-]?key|pat$/i);
    }
  });

  test("intake rejects a pasted token and never echoes it back", async ({ page }) => {
    await page.goto("/ai-app-release-rescue/intake");
    await fillValidIntake(page);
    await page.locator('textarea[name="evidenceNotes"]').fill(`clone it with ${FAKE_TOKEN}`);
    await page.getByRole("button", { name: /Submit demo request/i }).click();

    await expect(page.getByText(/credential/i).first()).toBeVisible();
    // The token must not survive anywhere in the replayed page.
    await expect(page.locator("body")).not.toContainText(FAKE_TOKEN);
    await expect(page).toHaveURL(/\/intake/);
  });

  test("intake refuses a repository URL carrying a token", async ({ page }) => {
    await page.goto("/ai-app-release-rescue/intake");
    await fillValidIntake(page);
    await page.locator('input[name="repositoryUrl"]').fill(`https://user:${FAKE_TOKEN}@github.com/example/harbor`);
    await page.getByRole("button", { name: /Submit demo request/i }).click();

    await expect(page.locator("body")).not.toContainText(FAKE_TOKEN);
    await expect(page).toHaveURL(/\/intake/);
  });

  test("intake refuses a credential file named as evidence", async ({ page }) => {
    await page.goto("/ai-app-release-rescue/intake");
    await fillValidIntake(page);
    await page.locator('input[name="evidenceFileNames"]').fill("src/app/page.tsx, .env.production");
    await page.getByRole("button", { name: /Submit demo request/i }).click();

    await expect(page.getByText(/\.env\.production/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/intake/);
  });

  test("valid intake records a demo engagement without payment or access", async ({ page }) => {
    await page.goto("/ai-app-release-rescue/intake");
    await fillValidIntake(page);
    await page.getByRole("button", { name: /Submit demo request/i }).click();

    await expect(page).toHaveURL(/\/ai-app-release-rescue\/demo\/rescue_/);
    await expect(page.getByText("Payment not collected")).toBeVisible();
    await expect(page.getByText("No credential held")).toBeVisible();
    // Stored as owner/name, never as the pasted URL.
    await expect(page.getByText("example/harbor-ledger").first()).toBeVisible();
  });

  test("sample report is customer-safe and carries its limitations", async ({ page }) => {
    await page.goto("/ai-app-release-rescue/demo/report");
    await expect(page.getByText(/Synthetic sample/i)).toBeVisible();
    await expect(page.getByText("RR-001").first()).toBeVisible();
    await expect(page.getByText(/not a penetration test/i).first()).toBeVisible();
    // The report states which review mode the customer agreed to.
    await expect(page.getByText(/AI-assisted, signed by a human reviewer/i)).toBeVisible();
    // And it states the injection limitation rather than implying the risk is solved.
    await expect(page.getByText(/This residual risk is not solved/i)).toBeVisible();
    // Internal identity must not reach a customer-facing document.
    await expect(page.locator("body")).not.toContainText("release-rescue-auditor");
    await expect(page.locator("body")).not.toContainText("demo-organization");
    await expect(page.locator("body")).not.toContainText("demo-operator");
  });

  test("sample report offers its JSON without internal identity", async ({ page }) => {
    await page.goto("/ai-app-release-rescue/demo/report?view=json");
    const json = page.locator("pre code");

    await expect(json).toBeVisible();
    await expect(json).toContainText("verdict");
    await expect(json).not.toContainText("executorKey");
    await expect(json).not.toContainText("organizationId");
  });
});
