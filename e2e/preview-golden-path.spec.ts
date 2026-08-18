import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // optional
}

const clientEmail = process.env.E2E_CLIENT_EMAIL || "client.admin@northline-test.delegation.cloud";
const harborEmail = process.env.E2E_OTHER_CLIENT_EMAIL || "client.admin@harbor-test.delegation.cloud";
const managerEmail = process.env.E2E_MANAGER_EMAIL || "ops.manager@delegation-test.cloud";
const operatorEmail = process.env.E2E_OPERATOR_EMAIL || "operator@delegation-test.cloud";
const password = process.env.E2E_PASSWORD || "Preview-Gate-2026!";
const onPreview = Boolean(process.env.PLAYWRIGHT_BASE_URL?.includes("vercel.app"));

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Need service role in .env.local to assert persistence");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function login(page: Page, email: string, pass: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(pass);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(app|ops)\//, { timeout: 30_000 });
}

async function signOut(page: Page) {
  const button = page.getByRole("button", { name: /sign out/i });
  if (await button.count()) {
    await button.click();
    await page.waitForURL(/\/$|\/login/, { timeout: 20_000 }).catch(() => undefined);
  }
  await page.context().clearCookies();
}

test.describe("deployed preview persistent golden path", () => {
  test.skip(!onPreview, "Set PLAYWRIGHT_BASE_URL to the Vercel Preview URL.");
  test.setTimeout(240_000);

  test("multi-role browser lifecycle persists on Supabase", async ({ browser }, testInfo) => {
    const title = `Preview golden ${Date.now()}`;
    const client = await browser.newContext();
    const manager = await browser.newContext();
    const operator = await browser.newContext();
    const harbor = await browser.newContext();
    const clientPage = await client.newPage();
    const managerPage = await manager.newPage();
    const operatorPage = await operator.newPage();
    const harborPage = await harbor.newPage();

    await login(clientPage, clientEmail, password);
    await clientPage.goto("/app/requests/new");
    await clientPage.locator('textarea[name="what"]').fill(
      `${title}. Inspect CRM, identify unassigned conference leads, and draft follow-up emails. Do not send until approved.`,
    );
    await clientPage.locator('textarea[name="objective"]').fill(
      "Every conference lead has an owner and a next step.",
    );
    await clientPage.locator('input[name="deliverable"]').fill("Owner list plus drafted follow-ups");
    await clientPage.locator('input[name="externalCommunication"]').check();
    await clientPage.getByRole("button", { name: /submit and see the execution plan/i }).click();
    await expect(clientPage).toHaveURL(/\/app\/requests\/[0-9a-f-]+/i, { timeout: 45_000 });
    const requestId = clientPage.url().split("/").pop()!;
    await clientPage.screenshot({ path: testInfo.outputPath("client-created.png"), fullPage: true });

    let { data: row } = await db().from("requests").select("id, status, title").eq("id", requestId).single();
    expect(row?.title).toContain("Preview golden");
    expect(row?.status).toMatch(/awaiting_plan_approval|needs_clarification/);

    if (row?.status === "needs_clarification") {
      const answer = clientPage.locator('textarea[name="answer"]');
      if (await answer.count()) {
        await answer.first().fill("Use HubSpot public notes only. Do not send.");
        await clientPage.getByRole("button", { name: /answer|save/i }).first().click();
      }
    }

    await clientPage.reload();
    await expect(clientPage.getByRole("button", { name: /approve plan/i })).toBeVisible({ timeout: 20_000 });
    await clientPage.locator('textarea[name="note"]').first().fill("Plan approved from preview browser");
    await clientPage.getByRole("button", { name: /approve plan/i }).click();
    await clientPage.waitForTimeout(1500);
    await signOut(clientPage);
    await login(clientPage, clientEmail, password);
    await clientPage.goto(`/app/requests/${requestId}`);
    await expect(clientPage.getByText(/queued|assigned|awaiting/i).first()).toBeVisible({ timeout: 20_000 });
    await clientPage.screenshot({ path: testInfo.outputPath("client-plan-approved.png"), fullPage: true });

    ({ data: row } = await db().from("requests").select("status").eq("id", requestId).single());
    expect(row?.status).toBe("queued");

    await login(managerPage, managerEmail, password);
    await managerPage.goto(`/ops/requests/${requestId}`);
    await expect(managerPage.getByText(title.slice(0, 20))).toBeVisible({ timeout: 20_000 });
    const assignSelect = managerPage.locator('select[name="operatorId"]');
    await expect(assignSelect).toBeVisible();
    const option = assignSelect.locator("option").filter({ hasText: /maya|operator/i }).first();
    const opValue = (await option.getAttribute("value")) || (await assignSelect.locator("option").nth(1).getAttribute("value"));
    expect(opValue).toBeTruthy();
    await assignSelect.selectOption(opValue!);
    await managerPage.getByRole("button", { name: /^assign$/i }).click();
    await managerPage.waitForTimeout(1500);
    await managerPage.reload();
    await managerPage.screenshot({ path: testInfo.outputPath("ops-assigned.png"), fullPage: true });

    ({ data: row } = await db().from("requests").select("status, assigned_operator_id").eq("id", requestId).single());
    expect(row?.assigned_operator_id).toBeTruthy();

    await login(operatorPage, operatorEmail, password);
    await operatorPage.goto(`/ops/requests/${requestId}`);
    await expect(operatorPage.getByRole("button", { name: /start work/i })).toBeVisible({ timeout: 20_000 });
    await operatorPage.getByRole("button", { name: /start work/i }).click();
    await operatorPage.getByRole("button", { name: /submit for qa/i }).click({ timeout: 20_000 });
    await operatorPage.screenshot({ path: testInfo.outputPath("operator-in-qa.png"), fullPage: true });

    await managerPage.goto(`/ops/requests/${requestId}`);
    await managerPage.getByRole("button", { name: /request revision/i }).click();
    ({ data: row } = await db().from("requests").select("status").eq("id", requestId).single());
    expect(row?.status).toBe("revision_required");

    await operatorPage.goto(`/ops/requests/${requestId}`);
    if (await operatorPage.getByRole("button", { name: /start work/i }).count()) {
      await operatorPage.getByRole("button", { name: /start work/i }).click();
    }
    await operatorPage.getByRole("button", { name: /submit for qa/i }).click({ timeout: 20_000 });

    await managerPage.goto(`/ops/requests/${requestId}`);
    await managerPage.locator('textarea[name="notes"]').fill("QA passed after revision");
    await managerPage.getByRole("button", { name: /^approve$/i }).click();
    await managerPage.waitForTimeout(1500);

    await signOut(clientPage);
    await login(clientPage, clientEmail, password);
    await clientPage.goto(`/app/requests/${requestId}`);
    const approveOutbound = clientPage.getByRole("button", { name: /^approve$/i }).first();
    await expect(approveOutbound).toBeVisible({ timeout: 20_000 });
    await approveOutbound.click();
    await clientPage.screenshot({ path: testInfo.outputPath("client-external-approved.png"), fullPage: true });

    await operatorPage.goto(`/ops/requests/${requestId}`);
    await expect(operatorPage.locator('textarea[name="summary"]')).toBeVisible({ timeout: 20_000 });
    await operatorPage.locator('textarea[name="summary"]').fill("Prepared owner list and drafts. Nothing was sent until approval.");
    await operatorPage.locator('textarea[name="actionsTaken"]').fill("Drafted follow-ups");
    await operatorPage.locator('input[name="nextStep"]').fill("Capture playbook");
    await operatorPage.getByRole("button", { name: /deliver package/i }).click();

    await clientPage.goto(`/app/requests/${requestId}`);
    await expect(clientPage.getByRole("button", { name: /accept delivery/i })).toBeVisible({ timeout: 20_000 });
    await clientPage.getByRole("button", { name: /accept delivery/i }).click();
    await clientPage.getByRole("button", { name: /create customer playbook/i }).click();
    await clientPage.waitForURL(/\/app\/playbooks\//, { timeout: 20_000 });
    const playbookId = clientPage.url().split("/").pop()!;
    await clientPage.screenshot({ path: testInfo.outputPath("client-playbook.png"), fullPage: true });

    await clientPage.goto(`/app/requests/new?playbookId=${playbookId}`);
    await clientPage.locator('textarea[name="what"]').fill(`${title} reuse`);
    await clientPage.locator('textarea[name="objective"]').fill("Reuse the captured playbook.");
    await clientPage.locator('input[name="deliverable"]').fill("Same pack");
    await clientPage.getByRole("button", { name: /submit and see the execution plan/i }).click();
    await expect(clientPage).toHaveURL(/\/app\/requests\/[0-9a-f-]+/i, { timeout: 45_000 });

    ({ data: row } = await db().from("requests").select("status").eq("id", requestId).single());
    expect(row?.status).toBe("accepted");
    const { data: pb } = await db().from("playbooks").select("id, title").eq("id", playbookId).single();
    expect(pb?.id).toBe(playbookId);

    await login(harborPage, harborEmail, password);
    await harborPage.goto(`/app/requests/${requestId}`);
    await expect(harborPage.getByText(title)).toHaveCount(0);
    await harborPage.goto("/app/requests");
    await expect(harborPage.getByText(title)).toHaveCount(0);
    await harborPage.screenshot({ path: testInfo.outputPath("harbor-isolation.png"), fullPage: true });

    await signOut(clientPage);
    await clientPage.goto(`/app/requests/${requestId}`);
    await expect(clientPage).toHaveURL(/\/login/);
    await clientPage.context().addCookies([
      { name: "dc_session", value: "stale", url: clientPage.url() },
      { name: "dc_demo_session", value: "usr_founder", url: new URL(clientPage.url()).origin },
    ]);
    await clientPage.goto("/login");
    await expect(clientPage.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await login(clientPage, clientEmail, password);
    await clientPage.goto(`/app/requests/${requestId}`);
    await expect(clientPage.getByText(/accepted|playbook/i).first()).toBeVisible();

    test.info().annotations.push({ type: "requestId", description: requestId });
    test.info().annotations.push({ type: "playbookId", description: playbookId });

    await client.close();
    await manager.close();
    await operator.close();
    await harbor.close();
  });
});
