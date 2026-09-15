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
  await page.locator('input[name="applicationName"]').fill("Harbor Ledger");
  await page.locator('select[name="repositoryHost"]').selectOption("github");
  await page.locator('input[name="repositoryUrl"]').fill("https://github.com/example/harbor-ledger");
  await page.locator('input[name="defaultBranch"]').fill("main");
  await page.locator('select[name="appType"]').selectOption("next_js_web_app");
  await page
    .locator('textarea[name="criticalWorkflow"]')
    .fill("Staff sign in and then create an inventory receipt end to end.");
  await page.locator('input[name="criticalWorkflowEntryPoint"]').fill("/receipts/new");
  await page.locator('select[name="accessGrantMethod"]').selectOption("customer_added_readonly_collaborator");
  await page.locator('select[name="accessWindowDays"]').selectOption("14");
  await page.locator('select[name="retentionPolicy"]').selectOption("minimum_7_day");
  for (const name of ["usesAiFeatures", "handlesCustomerData", "triggersExternalActions"]) {
    await page.locator(`input[name="${name}"]`).check();
  }
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
    await expect(page.locator("body")).not.toContainText("ready, ready with caveats");
    await expect(page.locator("h1")).not.toContainText("ready to ship");
  });

  test("skip link is first focusable and moves focus to main", async ({ page }) => {
    await page.goto("/ai-app-release-rescue");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await skip.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("gold labels on accent meet WCAG AA contrast", async ({ page }) => {
    await page.goto("/ai-app-release-rescue");
    const ratio = await page.locator("p", { hasText: /^Review$/ }).evaluate((el) => {
      const fg = getComputedStyle(el).color;
      const bg = getComputedStyle(el.parentElement ?? el).backgroundColor;
      const parse = (value: string) => {
        const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!match) throw new Error(value);
        return [Number(match[1]), Number(match[2]), Number(match[3])].map((channel) => {
          const c = channel / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
      };
      const [r1, g1, b1] = parse(fg);
      const [r2, g2, b2] = parse(bg);
      const L1 = 0.2126 * r1 + 0.7152 * g1 + 0.0722 * b1;
      const L2 = 0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2;
      const hi = Math.max(L1, L2);
      const lo = Math.min(L1, L2);
      return (hi + 0.05) / (lo + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
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

  test("a demo engagement page is not readable by anyone who knows the URL", async ({ page, browser }) => {
    await page.goto("/ai-app-release-rescue/intake");
    await fillValidIntake(page);
    await page.getByRole("button", { name: /Submit demo request/i }).click();
    await expect(page).toHaveURL(/\/ai-app-release-rescue\/demo\/rescue_/);

    const url = page.url();
    // The submitter sees their own record.
    await expect(page.getByText("ada@harbor.example")).toBeVisible();

    // A second visitor with the same URL and no cookie must not.
    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(url);
    await expect(strangerPage.locator("body")).not.toContainText("ada@harbor.example");
    await expect(strangerPage.locator("body")).not.toContainText("example/harbor-ledger");
    await expect(strangerPage.locator("body")).not.toContainText("Ada Khoury");
    await stranger.close();
  });

  test("demo engagement ids are not guessable", async ({ page }) => {
    await page.goto("/ai-app-release-rescue/intake");
    await fillValidIntake(page);
    await page.getByRole("button", { name: /Submit demo request/i }).click();
    await expect(page).toHaveURL(/\/ai-app-release-rescue\/demo\/rescue_/);

    const id = page.url().split("/").pop() ?? "";
    expect(id).toMatch(/^rescue_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
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
