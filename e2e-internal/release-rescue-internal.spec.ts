import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FAKE_AWS_KEY, FIXTURE_REPOSITORY } from "../src/lib/__tests__/release-rescue-internal-fixtures";
import { E2E_LOCAL_DIR, E2E_OPERATOR, E2E_PASSPHRASE } from "./paths";

// The whole internal workflow in a browser: sign in as a reviewer created in
// the terminal, start a review of a pinned commit, read the draft, sign exactly
// what is shown, and export the signed report. Along the way, every place a
// forged identity, an altered report or an out-of-scope repository could get
// in is tried and must be refused.

const HOME = "/internal/release-rescue";
const RUNS_DIR = join(E2E_LOCAL_DIR, "runs");

test.describe.configure({ mode: "serial" });

function runFiles(): string[] {
  try {
    return readdirSync(RUNS_DIR).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

function storedRun(runId: string) {
  return JSON.parse(readFileSync(join(RUNS_DIR, `${runId}.json`), "utf8"));
}

function operatorId(): string {
  const registry = JSON.parse(readFileSync(join(E2E_LOCAL_DIR, "operators.json"), "utf8"));
  return registry.operators.find((operator: { displayName: string }) => operator.displayName === E2E_OPERATOR).operatorId;
}

async function signIn(page: Page, passphrase = E2E_PASSPHRASE) {
  await page.goto(`${HOME}/login`);
  await page.getByLabel("Display name").fill(E2E_OPERATOR);
  await page.getByLabel("Passphrase").fill(passphrase);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (passphrase === E2E_PASSPHRASE) {
    await page.waitForURL(new RegExp(`${HOME}$`));
  } else {
    await page.waitForURL(/\?error=/);
  }
}

async function startRun(page: Page): Promise<string> {
  await page.goto(HOME);
  const card = page.locator("form").filter({ has: page.getByRole("button", { name: "Run review" }) });
  await card.getByRole("checkbox").check();
  await card.getByRole("button", { name: "Run review" }).click();
  await page.waitForURL(new RegExp(`${HOME}/runs/[0-9a-f-]{36}$`));
  return page.url().split("/").pop()!;
}

async function expectNoRepositoryText(page: Page) {
  const html = await page.content();
  expect(html).not.toContain(FAKE_AWS_KEY);
  expect(html).not.toContain("eu-north-1");
  expect(html).not.toContain("ignore all previous instructions");
}

test("nothing is reachable without a reviewer session", async ({ page, request }) => {
  await page.goto(HOME);
  await expect(page).toHaveURL(new RegExp(`${HOME}/login$`));
  await expect(page.getByText("There is no default account and no sign-up here.")).toBeVisible();

  const forwarded = await request.get(`${HOME}/login`, { headers: { "x-forwarded-for": "203.0.113.9" } });
  expect(forwarded.status()).toBe(404);
});

test("a wrong passphrase is refused", async ({ page }) => {
  await signIn(page, "not the passphrase at all");
  await expect(page.locator('p[role="alert"]')).toHaveText("That name and passphrase do not match a registered reviewer.");
});

test("a forged session cookie is not a session", async ({ page, context }) => {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, operatorId: operatorId(), issuedAt: Date.now(), expiresAt: Date.now() + 3_600_000, nonce: "x" }),
  ).toString("base64url");
  await context.addCookies([
    { name: "dc_rr_internal_session", value: `${payload}.${"0".repeat(64)}`, domain: "127.0.0.1", path: HOME },
  ]);
  await page.goto(HOME);
  await expect(page).toHaveURL(new RegExp(`${HOME}/login$`));
});

test("the server refuses an out-of-scope repository and an unconfirmed one, and reads nothing", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText(`Signed in as ${E2E_OPERATOR}.`)).toBeVisible();
  const before = runFiles().length;
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Run review" }) });

  // Bypass the browser's own checks so the server's are the ones tested.
  await form.evaluate((element) => {
    (element.querySelector('input[name="repositoryRef"]') as HTMLInputElement).value = "someone-else/other";
    (element as HTMLFormElement).noValidate = true;
  });
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Run review" }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText("That repository is not on the internal allowlist, so nothing was read.");

  await page.goto(HOME);
  await form.evaluate((element) => {
    (element as HTMLFormElement).noValidate = true;
  });
  await form.getByRole("button", { name: "Run review" }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText("Confirm the repository is ours to review before starting a run.");

  expect(runFiles().length).toBe(before);
});

test("a draft edited on disk is shown as tampered and cannot be signed", async ({ page }) => {
  await signIn(page);
  const runId = await startRun(page);
  await expect(page.getByRole("heading", { name: "Sign this report" })).toBeVisible();

  const path = join(RUNS_DIR, `${runId}.json`);
  const stored = storedRun(runId);
  stored.draft.report.findings = [];
  writeFileSync(path, JSON.stringify(stored));

  await page.reload();
  await expect(page.getByText(/TAMPERED: the stored draft no longer matches its seal/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign this report" })).toHaveCount(0);
});

test("the full journey: acquire, analyze, review, sign exactly what is shown, export", async ({ page, browser }) => {
  await signIn(page);
  const runId = await startRun(page);

  // Acquisition and the analysis ledger.
  await expect(page.getByRole("heading", { name: "Source acquisition: ACQUIRED" })).toBeVisible();
  await expect(
    page.getByText(
      "Model-assisted analysis: NOT RUN. No model provider is authorized for Release Rescue, so only the automated checks in the ledger ran.",
    ),
  ).toBeVisible();
  await expect(page.getByText(/1 FAIL, 1 PASS, 0 BLOCKED, 30 NOT RUN\./)).toBeVisible();
  await expectNoRepositoryText(page);

  // The draft names the credential by its location, never its value.
  await expect(page.getByText("src/settings.ts", { exact: false }).first()).toBeVisible();
  const shownHash = await page.locator('input[name="approvedContentHash"]').inputValue();
  expect(shownHash).toMatch(/^[0-9a-f]{64}$/);

  // Approving a hash other than the one shown is refused, and nothing is signed.
  await page.locator('input[name="approvedContentHash"]').evaluate((input) => {
    (input as HTMLInputElement).value = "a".repeat(64);
  });
  await page.getByRole("button", { name: `Sign as ${E2E_OPERATOR}` }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText(
    "The report changed after it was shown to you. Read it again and sign what is shown now.",
  );
  expect(storedRun(runId).status).toBe("awaiting_review");

  // A field naming someone else is not forwarded; the session decides who signs.
  await page.goto(`${HOME}/runs/${runId}`);
  await page.locator('form:has(input[name="approvedContentHash"])').evaluate((form) => {
    const extra = document.createElement("input");
    extra.type = "hidden";
    extra.name = "operatorUserId";
    extra.value = "00000000-0000-4000-8000-000000000000";
    form.appendChild(extra);
  });
  await page.getByRole("button", { name: `Sign as ${E2E_OPERATOR}` }).click();
  await page.waitForURL(new RegExp(`${HOME}/runs/${runId}\\?signed=1$`));

  const signed = storedRun(runId);
  expect(signed.status).toBe("signed");
  expect(signed.signed.report.reviewedBy.operatorUserId).toBe(operatorId());
  expect(signed.signed.report.reviewedBy.displayName).toBe(E2E_OPERATOR);
  expect(signed.signed.report.reviewedBy.approvedContentHash).toBe(shownHash);

  // The signed report, as the customer view.
  await expect(page.getByText(`${E2E_OPERATOR} on`, { exact: false })).toBeVisible();
  await expect(page.getByText(shownHash).first()).toBeVisible();
  await expectNoRepositoryText(page);

  // Viewing is not delivery. Give the browser every chance to prefetch the
  // export link first: a prefetch must not start the retention window.
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: /download/i }).first().hover();
  await page.waitForTimeout(1_000);
  expect(storedRun(runId).deliveredAt).toBeNull();

  // A person clicking the link does get the file, and that is the delivery.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download JSON" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`release-rescue-${runId}.json`);
  const clickedAt = storedRun(runId).deliveredAt;
  expect(clickedAt).not.toBeNull();

  // Export is the delivery: it goes through the delivery gate and starts retention.
  const exported = await page.request.get(`${HOME}/runs/${runId}/export`);
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-disposition"]).toContain(`release-rescue-${runId}.json`);
  const body = await exported.text();
  expect(body).not.toContain(FAKE_AWS_KEY);
  expect(body).not.toContain("eu-north-1");
  const json = JSON.parse(body);
  expect(json.reviewer.displayName).toBe(E2E_OPERATOR);
  expect(json.reviewer.approvedContentHash).toBe(shownHash);
  expect(json.report.scope.repositoryRef).toBe(FIXTURE_REPOSITORY);
  expect(json.report.scope.commitSha).toBe(signed.commitSha);
  // A later export does not move the delivery time.
  expect(storedRun(runId).deliveredAt).toBe(clickedAt);

  // Nobody else can export it.
  const stranger = await browser.newContext();
  expect((await stranger.request.get(`http://127.0.0.1:3021${HOME}/runs/${runId}/export`)).status()).toBe(401);
  await stranger.close();

  // A signed report edited on disk is withheld, in the page and in the export.
  const path = join(RUNS_DIR, `${runId}.json`);
  const altered = storedRun(runId);
  altered.signed.report.reviewedBy.displayName = "Someone Else";
  writeFileSync(path, JSON.stringify(altered));
  expect((await page.request.get(`${HOME}/runs/${runId}/export`)).status()).toBe(409);
  await page.reload();
  await expect(page.getByRole("heading", { name: "What is blocking delivery" })).toBeVisible();
  await expect(page.getByText("The stored signed report no longer matches its seal.")).toBeVisible();
  await expect(page.getByText("Someone Else")).toHaveCount(0);

  // Nothing persisted carries the credential or the injected text.
  for (const name of runFiles()) {
    const text = readFileSync(join(RUNS_DIR, name), "utf8");
    expect(text).not.toContain(FAKE_AWS_KEY);
    expect(text).not.toContain("ignore all previous instructions");
  }
});

test("signing out ends the session everywhere, including a copied cookie", async ({ page, browser }) => {
  await signIn(page);
  const cookie = (await page.context().cookies()).find((entry) => entry.name === "dc_rr_internal_session");
  expect(cookie).toBeTruthy();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(new RegExp(`${HOME}/login$`));

  const copy = await browser.newContext();
  await copy.addCookies([{ ...cookie! }]);
  const other = await copy.newPage();
  await other.goto(`http://127.0.0.1:3021${HOME}`);
  await expect(other).toHaveURL(new RegExp(`${HOME}/login$`));
  await copy.close();
});
