import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { hashReleaseRescueReviewSubject } from "@/lib/release-rescue-report";
import { internalModeDecision, isLoopbackRequest } from "@/lib/release-rescue-internal/mode";
import {
  addOperator,
  authenticateOperator,
  issueSession,
  operatorFromSession,
  removeOperator,
  SESSION_LIFETIME_MS,
} from "@/lib/release-rescue-internal/local-identity";
import { deliveryForRun, recordDelivery, signRunAsLocalOperator } from "@/lib/release-rescue-internal/review";
import { CLI_INITIATOR, RunRefused, initiatorFromOperator, startInternalRun } from "@/lib/release-rescue-internal/run";
import { runSummary } from "@/lib/release-rescue-internal/summary";
import { listRuns, loadRun, localDir, purgeAfter, sweepRetention } from "@/lib/release-rescue-internal/store";
import {
  FAKE_AWS_KEY,
  PROMPT_INJECTION,
  fixtureAllowlist,
  makeFixtureRepo,
  tempDir,
} from "@/lib/__tests__/release-rescue-internal-fixtures";

// The human half: who may sign, what they sign, and what happens to the report
// afterwards. Every test gets a fresh local directory, so no identity or run
// crosses tests, and nothing is written outside the system temp directory.

const PASSPHRASE = "a long local test passphrase";
const REASON = "reviewed_findings_and_verdict_match_the_recorded_observations";

beforeEach(() => {
  process.env.RELEASE_RESCUE_LOCAL_DIR = tempDir("rr-internal-store-");
});

async function draftRun(files: Record<string, string> = { "src/settings.ts": `const k = "${FAKE_AWS_KEY}";\n` }) {
  const operator = addOperator(`Reviewer ${Math.random().toString(36).slice(2, 8)}`, PASSPHRASE);
  const repo = makeFixtureRepo(files);
  const record = await startInternalRun({
    initiatedBy: initiatorFromOperator(operator),
    repositoryRef: fixtureAllowlist().repositories[0].repositoryRef,
    commitSha: repo.commitSha,
    retentionPolicy: "minimum_7_day",
    ownershipConfirmed: true,
    source: { kind: "checkout", path: repo.path },
    allowlist: fixtureAllowlist(),
  });
  return { operator, record };
}

function storedRunPath(runId: string): string {
  return join(localDir(), "runs", `${runId}.json`);
}

describe("an operator is a real local identity, created only with a passphrase", () => {
  it("refuses a short passphrase and a display name that makes a claim", () => {
    expect(() => addOperator("Short Pass", "tooshort")).toThrow(/at least/);
    expect(() => addOperator("SOC 2 certified reviewer", PASSPHRASE)).toThrow(/claim/);
    expect(() => addOperator(`Reviewer ${FAKE_AWS_KEY}`, PASSPHRASE)).toThrow(/credential/);
  });

  it("stores only a salted hash, in owner-only files", () => {
    addOperator("Owner Only", PASSPHRASE);
    const registry = readFileSync(join(localDir(), "operators.json"), "utf8");
    expect(registry).not.toContain(PASSPHRASE);
    expect(registry).toMatch(/scrypt\$32768\$8\$1\$/);
    expect(statSync(join(localDir(), "operators.json")).mode & 0o777).toBe(0o600);
    expect(statSync(localDir()).mode & 0o777).toBe(0o700);
  });

  it("creates the store on first use, on a machine where it does not exist yet", () => {
    process.env.RELEASE_RESCUE_LOCAL_DIR = join(tempDir("rr-internal-fresh-"), "not", "yet", "here");
    addOperator("First Operator", PASSPHRASE);
    expect(statSync(localDir()).mode & 0o777).toBe(0o700);
    expect(authenticateOperator("First Operator", PASSPHRASE).ok).toBe(true);
  });

  it("authenticates the right passphrase, refuses a wrong one, and locks out repeated guessing", () => {
    addOperator("Lockout Case", PASSPHRASE);
    expect(authenticateOperator("Lockout Case", PASSPHRASE).ok).toBe(true);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(authenticateOperator("Lockout Case", "wrong passphrase here").ok).toBe(false);
    }
    expect(authenticateOperator("Lockout Case", PASSPHRASE)).toEqual({ ok: false, reason: "locked" });
    expect(authenticateOperator("Nobody At All", PASSPHRASE)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("a session names an operator, and cannot be forged, extended or outlive the operator", () => {
  it("accepts its own session and refuses every altered one", () => {
    const operator = addOperator("Session Case", PASSPHRASE);
    const token = issueSession(operator.operatorId);
    expect(operatorFromSession(token)?.operatorId).toBe(operator.operatorId);

    const [payload, signature] = token.split(".");
    const other = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), expiresAt: Date.now() * 2 }),
    ).toString("base64url");
    expect(operatorFromSession(`${other}.${signature}`)).toBeNull();
    expect(operatorFromSession(`${payload}.${"0".repeat(64)}`)).toBeNull();
    expect(operatorFromSession("dc_demo_session=usr_admin")).toBeNull();
    expect(operatorFromSession(undefined)).toBeNull();
  });

  it("expires", () => {
    const operator = addOperator("Expiry Case", PASSPHRASE);
    const issued = Date.now();
    const token = issueSession(operator.operatorId, issued);
    expect(operatorFromSession(token, issued + SESSION_LIFETIME_MS - 1)).not.toBeNull();
    expect(operatorFromSession(token, issued + SESSION_LIFETIME_MS)).toBeNull();
  });

  it("ends when the operator is removed, and when the local key changes", () => {
    const operator = addOperator("Removal Case", PASSPHRASE);
    const token = issueSession(operator.operatorId);
    removeOperator(operator.operatorId);
    expect(operatorFromSession(token)).toBeNull();

    const second = addOperator("Rotation Case", PASSPHRASE);
    const secondToken = issueSession(second.operatorId);
    rmSync(join(localDir(), "secret.key"));
    expect(operatorFromSession(secondToken)).toBeNull();
  });
});

describe("the signature is the session's operator, over exactly the report shown", () => {
  it("binds the reviewer to the signed-in operator and the approved hash to the draft", async () => {
    const { operator, record } = await draftRun();
    const shown = hashReleaseRescueReviewSubject(record.draft!.report);
    const outcome = signRunAsLocalOperator(operator, record.runId, { reasonCode: REASON, approvedContentHash: shown });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.record.signed!.report.reviewedBy).toEqual(
      expect.objectContaining({
        operatorUserId: operator.operatorId,
        displayName: operator.displayName,
        reasonCode: REASON,
        approvedContentHash: shown,
      }),
    );
  });

  it("refuses a submission that tries to name the reviewer", async () => {
    const { operator, record } = await draftRun();
    const shown = hashReleaseRescueReviewSubject(record.draft!.report);
    for (const extra of [{ operatorUserId: "someone-else" }, { displayName: "The Owner" }, { reviewedAt: "2020-01-01T00:00:00.000Z" }]) {
      const outcome = signRunAsLocalOperator(operator, record.runId, { reasonCode: REASON, approvedContentHash: shown, ...extra });
      expect(outcome).toEqual(expect.objectContaining({ ok: false, reason: "malformed_submission" }));
    }
  });

  it("refuses an approval of content other than the stored draft", async () => {
    const { operator, record } = await draftRun();
    const outcome = signRunAsLocalOperator(operator, record.runId, { reasonCode: REASON, approvedContentHash: "a".repeat(64) });
    expect(outcome).toEqual(expect.objectContaining({ ok: false, reason: "content_changed_since_shown" }));
    expect(loadRun(record.runId)?.status).toBe("awaiting_review");
  });

  it("refuses to sign a draft edited on disk, even with a matching hash", async () => {
    const { operator, record } = await draftRun();
    const path = storedRunPath(record.runId);
    const stored = JSON.parse(readFileSync(path, "utf8"));
    stored.draft.report.findings = [];
    stored.draft.report.verdict = "no_blocking_findings_identified";
    writeFileSync(path, JSON.stringify(stored));
    const tamperedHash = hashReleaseRescueReviewSubject(stored.draft.report);
    const outcome = signRunAsLocalOperator(operator, record.runId, { reasonCode: REASON, approvedContentHash: tamperedHash });
    expect(outcome).toEqual(expect.objectContaining({ ok: false, reason: "draft_tampered" }));
  });

  it("refuses a second signature, and an operator that no longer exists", async () => {
    const { operator, record } = await draftRun();
    const shown = hashReleaseRescueReviewSubject(record.draft!.report);
    expect(signRunAsLocalOperator(operator, record.runId, { reasonCode: REASON, approvedContentHash: shown }).ok).toBe(true);
    expect(signRunAsLocalOperator(operator, record.runId, { reasonCode: REASON, approvedContentHash: shown })).toEqual(
      expect.objectContaining({ ok: false, reason: "not_awaiting_review" }),
    );

    const second = await draftRun();
    removeOperator(second.operator.operatorId);
    const secondShown = hashReleaseRescueReviewSubject(second.record.draft!.report);
    expect(signRunAsLocalOperator(second.operator, second.record.runId, { reasonCode: REASON, approvedContentHash: secondShown })).toEqual(
      expect.objectContaining({ ok: false, reason: "operator_unknown" }),
    );
  });
});

describe("export goes through the production delivery gate, and refuses what is unsigned or altered", () => {
  it("withholds an unsigned report and delivers a signed one", async () => {
    const { operator, record } = await draftRun();
    expect(deliveryForRun(record.runId).status).toBe("withheld");
    const shown = hashReleaseRescueReviewSubject(record.draft!.report);
    signRunAsLocalOperator(operator, record.runId, { reasonCode: REASON, approvedContentHash: shown });
    const outcome = deliveryForRun(record.runId);
    expect(outcome.status).toBe("deliverable");
    if (outcome.status === "deliverable") {
      expect(outcome.decision.reviewer.displayName).toBe(operator.displayName);
      expect(JSON.stringify(outcome.decision.view)).not.toContain(FAKE_AWS_KEY);
    }
  });

  it("withholds a signed report edited on disk", async () => {
    const { operator, record } = await draftRun();
    const shown = hashReleaseRescueReviewSubject(record.draft!.report);
    signRunAsLocalOperator(operator, record.runId, { reasonCode: REASON, approvedContentHash: shown });
    const path = storedRunPath(record.runId);
    const stored = JSON.parse(readFileSync(path, "utf8"));
    stored.signed.report.reviewedBy.displayName = "Someone Else";
    writeFileSync(path, JSON.stringify(stored));
    expect(deliveryForRun(record.runId)).toEqual({
      status: "withheld",
      blockers: ["The stored signed report no longer matches its seal."],
    });
  });
});

describe("nothing a repository contained is persisted or printed", () => {
  it("keeps credentials, source lines and injected text out of the run record and the summary", async () => {
    const { operator, record } = await draftRun({
      "src/settings.ts": `const region = "eu-central-1";\nconst k = "${FAKE_AWS_KEY}";\n`,
      "README.md": PROMPT_INJECTION,
    });
    const shown = hashReleaseRescueReviewSubject(record.draft!.report);
    signRunAsLocalOperator(operator, record.runId, { reasonCode: REASON, approvedContentHash: shown });
    const persisted = readdirSync(join(localDir(), "runs")).map((name) => readFileSync(join(localDir(), "runs", name), "utf8")).join("\n");
    const printed = JSON.stringify(runSummary(loadRun(record.runId)!));
    for (const text of [persisted, printed]) {
      expect(text).not.toContain(FAKE_AWS_KEY);
      expect(text).not.toContain("eu-central-1");
      expect(text).not.toContain("ignore all previous instructions");
    }
    expect(printed).toContain("src/settings.ts:2");
  });
});

describe("a run starts only for an allowlisted repository we have confirmed is ours", () => {
  it("refuses an out-of-scope repository without reading or writing anything", async () => {
    const repo = makeFixtureRepo({ "a.ts": "a\n" }, { remoteRef: "someone-else/other" });
    await expect(
      startInternalRun({
        initiatedBy: CLI_INITIATOR,
        repositoryRef: "someone-else/other",
        commitSha: repo.commitSha,
        retentionPolicy: "minimum_7_day",
        ownershipConfirmed: true,
        source: { kind: "checkout", path: repo.path },
        allowlist: fixtureAllowlist(),
      }),
    ).rejects.toBeInstanceOf(RunRefused);
    expect(listRuns()).toEqual([]);
  });

  it("refuses without the ownership confirmation", async () => {
    const repo = makeFixtureRepo({ "a.ts": "a\n" });
    await expect(
      startInternalRun({
        initiatedBy: CLI_INITIATOR,
        repositoryRef: fixtureAllowlist().repositories[0].repositoryRef,
        commitSha: repo.commitSha,
        retentionPolicy: "minimum_7_day",
        ownershipConfirmed: false,
        source: { kind: "checkout", path: repo.path },
        allowlist: fixtureAllowlist(),
      }),
    ).rejects.toThrow(/ours to review/);
  });

  it("records a blocked acquisition as a BLOCKED run with no report", async () => {
    const record = await startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: fixtureAllowlist().repositories[0].repositoryRef,
      commitSha: "f".repeat(40),
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "checkout", path: makeFixtureRepo({ "a.ts": "a\n" }).path },
      allowlist: fixtureAllowlist(),
    });
    expect(record.status).toBe("blocked");
    expect(record.draft).toBeNull();
    expect(record.acquisition.refusals[0].reason).toBe("commit_not_found");
  });
});

describe("retention", () => {
  it("purges an undelivered run at the backstop and a delivered one after its window, keeping only accounting", async () => {
    const { operator, record } = await draftRun();
    const undelivered = await draftRun();
    const shown = hashReleaseRescueReviewSubject(record.draft!.report);
    signRunAsLocalOperator(operator, record.runId, { reasonCode: REASON, approvedContentHash: shown });
    const deliveredAt = new Date();
    recordDelivery(record.runId, deliveredAt);

    const day = 24 * 60 * 60 * 1000;
    expect(purgeAfter(loadRun(record.runId)!).getTime()).toBe(deliveredAt.getTime() + 7 * day);

    expect(sweepRetention(new Date(deliveredAt.getTime() + 6 * day))).toEqual([]);
    expect(sweepRetention(new Date(deliveredAt.getTime() + 7 * day))).toEqual([record.runId]);
    const purged = loadRun(record.runId)!;
    expect(purged.status).toBe("purged");
    expect(purged.draft).toBeNull();
    expect(purged.signed).toBeNull();
    expect(purged.accounting.subjectHash).toBe(shown);
    expect(deliveryForRun(record.runId).status).toBe("withheld");

    expect(sweepRetention(new Date(deliveredAt.getTime() + 59 * day))).toEqual([]);
    expect(sweepRetention(new Date(Date.now() + 60 * day))).toEqual([undelivered.record.runId]);
    // Idempotent.
    expect(sweepRetention(new Date(Date.now() + 90 * day))).toEqual([]);
  });
});

describe("the internal mode exists only where it was switched on, on a loopback host", () => {
  it("is off by default and off on any deployment", () => {
    expect(internalModeDecision({})).toEqual({ enabled: false, reason: "not_switched_on" });
    expect(internalModeDecision({ RELEASE_RESCUE_INTERNAL: "local" })).toEqual({ enabled: true });
    expect(internalModeDecision({ RELEASE_RESCUE_INTERNAL: "local", VERCEL: "1" })).toEqual({
      enabled: false,
      reason: "deployment_environment",
    });
    expect(internalModeDecision({ RELEASE_RESCUE_INTERNAL: "yes" }).enabled).toBe(false);
  });

  it("accepts only loopback hosts, and never a request a client or proxy forwarded", () => {
    const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
    expect(isLoopbackRequest(headers({ host: "127.0.0.1:3020" }))).toBe(true);
    expect(isLoopbackRequest(headers({ host: "localhost:3020" }))).toBe(true);
    expect(isLoopbackRequest(headers({ host: "[::1]:3020" }))).toBe(true);
    expect(isLoopbackRequest(headers({ host: "example.com" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1.example.com" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1", "x-forwarded-for": "203.0.113.9" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1", "x-forwarded-for": "127.0.0.1, 203.0.113.9" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1:3020", "x-forwarded-host": "app.example.com" }))).toBe(false);
    // What `next start` itself adds to a direct local request.
    expect(
      isLoopbackRequest(
        headers({ host: "127.0.0.1:3020", "x-forwarded-host": "127.0.0.1:3020", "x-forwarded-for": "127.0.0.1" }),
      ),
    ).toBe(true);
    expect(
      isLoopbackRequest(headers({ host: "[::1]:3020", "x-forwarded-host": "[::1]:3020", "x-forwarded-for": "::1" })),
    ).toBe(true);
    expect(isLoopbackRequest(headers({}))).toBe(false);
  });
});
