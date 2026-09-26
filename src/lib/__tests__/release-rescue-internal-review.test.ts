import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { hashReleaseRescueReviewSubject } from "@/lib/release-rescue-report";
import { SNAPSHOT_LIMITS } from "@/lib/release-rescue-snapshot-limits";
import { internalModeDecision, isLoopbackRequest } from "@/lib/release-rescue-internal/mode";
import {
  addOperator,
  authenticateOperator,
  endSessions,
  issueSession,
  loadOperators,
  operatorFromSession,
  removeOperator,
  SESSION_LIFETIME_MS,
} from "@/lib/release-rescue-internal/local-identity";
import { deliveryForRun, recordDelivery, signRunAsLocalOperator } from "@/lib/release-rescue-internal/review";
import { verifyArchiveAgainstTree } from "@/lib/release-rescue-internal/git-source";
import { blobId } from "@/lib/release-rescue-internal/snapshot";
import { CLI_INITIATOR, RunRefused, initiatorFromOperator, startInternalRun } from "@/lib/release-rescue-internal/run";
import { runSummary } from "@/lib/release-rescue-internal/summary";
import { listRuns, loadRun, localDir, purgeAfter, saveCheckout, sweepRetention } from "@/lib/release-rescue-internal/store";
import {
  FAKE_AWS_KEY,
  FIXTURE_REPOSITORY,
  PROMPT_INJECTION,
  buildTar,
  fixtureAllowlist,
  makeFixtureRepo,
  tempDir,
  commitRawNames,
  editTarEntry,
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

describe("an operator's display name cannot claim a credential the review does not carry", () => {
  it.each(["Certified penetration tester", "certified pentester", "certified pen tester", "Compliance certified"])(
    "refuses to create an operator named %s, and writes nothing",
    (name) => {
      expect(() => addOperator(name, "a long enough passphrase")).toThrow("A display name may not make a claim about the review.");
      expect(loadOperators()).toEqual([]);
    },
  );

  it("refuses to sign as an operator whose stored name makes such a claim, as one registered before this rule would", async () => {
    const { operator, record } = await draftRun();
    const registryPath = join(localDir(), "operators.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    registry.operators[0].displayName = "Certified penetration tester";
    writeFileSync(registryPath, JSON.stringify(registry));
    const renamed = { ...operator, displayName: "Certified penetration tester" };
    const shown = hashReleaseRescueReviewSubject(record.draft!.report);
    const outcome = signRunAsLocalOperator(renamed, record.runId, { reasonCode: REASON, approvedContentHash: shown });
    expect(outcome).toEqual(
      expect.objectContaining({ ok: false, reason: "signature_refused", detail: expect.stringContaining('prohibited claim ("penetration tester")') }),
    );
    expect(loadRun(record.runId)?.status).toBe("awaiting_review");
    expect(loadRun(record.runId)?.signed).toBeNull();
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

  it("ends, with every copy of it, when the operator signs out", () => {
    const operator = addOperator("Sign Out Case", PASSPHRASE);
    const issued = Date.now();
    const copied = issueSession(operator.operatorId, issued);
    endSessions(operator.operatorId, issued);
    expect(operatorFromSession(copied, issued + 10)).toBeNull();
    expect(operatorFromSession(issueSession(operator.operatorId, issued + 10), issued + 20)?.operatorId).toBe(operator.operatorId);
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

describe("a credential stored as a symlink's target is never reported as a clean check", () => {
  it("leaves both secrets checks BLOCKED, not PASS, on the git path", async () => {
    const repo = makeFixtureRepo(
      { "src/settings.ts": "export const a = 1;\n" },
      { symlinks: { "config/key": `aws_access_key_id=${FAKE_AWS_KEY}` } },
    );
    const record = await startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: FIXTURE_REPOSITORY,
      commitSha: repo.commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "checkout", path: repo.path },
      allowlist: fixtureAllowlist(),
    });
    expect(record.acquisition.rejectedByReason).toEqual({ symlink_not_followed: 1 });
    expect(record.checkRuns.filter((check) => check.status !== "NOT_RUN").map((check) => check.status)).toEqual([
      "BLOCKED",
      "BLOCKED",
    ]);
    expect(JSON.stringify(loadRun(record.runId))).not.toContain(FAKE_AWS_KEY);
  });
});

describe("a run started from the terminal needs a named person to confirm ownership before it is signed", () => {
  it("refuses to sign without that confirmation, and records the signer as the confirmer with it", async () => {
    const operator = addOperator("Terminal Signer", PASSPHRASE);
    const repo = makeFixtureRepo({ "a.ts": "a\n" });
    const record = await startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: fixtureAllowlist().repositories[0].repositoryRef,
      commitSha: repo.commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "checkout", path: repo.path },
      allowlist: fixtureAllowlist(),
    });
    const submission = { reasonCode: REASON, approvedContentHash: hashReleaseRescueReviewSubject(record.draft!.report) };
    expect(signRunAsLocalOperator(operator, record.runId, submission)).toEqual(
      expect.objectContaining({ ok: false, reason: "ownership_not_confirmed" }),
    );
    const signed = signRunAsLocalOperator(operator, record.runId, submission, new Date(), { ownershipConfirmed: true });
    expect(signed.ok).toBe(true);
    expect(loadRun(record.runId)!.ownershipConfirmedBy).toEqual({ operatorId: operator.operatorId, displayName: "Terminal Signer" });
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

describe("an archive is accepted only when it is the pinned commit of the allowlisted clone", () => {
  async function archiveRun(repo: { path: string; commitSha: string }, archivePath: string, commitSha = repo.commitSha) {
    return startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: fixtureAllowlist().repositories[0].repositoryRef,
      commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "archive", path: archivePath },
      allowlist: fixtureAllowlist(),
    });
  }
  const gitArchive = (repo: { path: string }, out: string, ...extra: string[]) =>
    execFileSync("git", ["-C", repo.path, "archive", ...extra, "--format=tar", "-o", out, "HEAD"], {
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });

  it("accepts `git archive` of the pinned commit", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "a\n", "src/b.ts": "b\n" });
    saveCheckout(fixtureAllowlist().repositories[0].repositoryRef, repo.path);
    const out = join(tempDir("rr-internal-archive-"), "commit.tar");
    gitArchive(repo, out);
    const record = await archiveRun(repo, out);
    expect(record.status).toBe("awaiting_review");
    expect(record.source).toBe("tar_archive");
  });

  // A `.tar.gz` is judged on the whole archive's ratio, so a small repository
  // (tar padding alone is past 12x) and one whose first file compresses very
  // well are read, and give what the checkout gives.
  it.each([
    ["a small repository", () => ({ "src/a.ts": "a\n", "src/b.ts": "b\n" })],
    [
      "the reported 2.4 MB repository, with 1.6 MB of generated JSON first",
      () => {
        let json = "[";
        for (let index = 0; index < 30_000; index += 1) {
          json += `${JSON.stringify({ id: index, name: `item-${index}`, active: index % 2 === 0, tags: ["a", "b"] })},`;
        }
        const files: Record<string, string> = { "data/fixtures.json": `${json}{}]` };
        let x = 1;
        for (let index = 1; index <= 60; index += 1) {
          const bytes = Buffer.alloc(6000);
          for (let at = 0; at < bytes.length; at += 1) {
            x ^= x << 13;
            x >>>= 0;
            x ^= x >>> 17;
            x ^= x << 5;
            x >>>= 0;
            bytes[at] = x & 0xff;
          }
          files[`src/f${index}.txt`] = bytes.toString("base64");
        }
        return files;
      },
    ],
  ])("accepts a `git archive` .tar.gz of %s, and reports what the checkout reports", async (_name, files) => {
    const repo = makeFixtureRepo(files());
    saveCheckout(fixtureAllowlist().repositories[0].repositoryRef, repo.path);
    const dir = tempDir("rr-internal-archive-");
    const tar = join(dir, "commit.tar");
    gitArchive(repo, tar);
    const tgz = join(dir, "commit.tar.gz");
    writeFileSync(tgz, gzipSync(readFileSync(tar)));

    const archived = await archiveRun(repo, tgz);
    expect(archived.status).toBe("awaiting_review");
    expect(archived.source).toBe("tar_archive");
    const checkout = await startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: fixtureAllowlist().repositories[0].repositoryRef,
      commitSha: repo.commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "checkout", path: repo.path },
      allowlist: fixtureAllowlist(),
    });
    expect(archived.checkRuns).toEqual(checkout.checkRuns);
    expect(archived.acquisition.totals.acceptedFileCount).toBe(checkout.acquisition.totals.acceptedFileCount);
    expect(archived.acquisition.totals.acceptedBytes).toBe(checkout.acquisition.totals.acceptedBytes);
  });

  it("refuses an archive that only claims the pinned commit", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "a\n" });
    saveCheckout(fixtureAllowlist().repositories[0].repositoryRef, repo.path);
    const out = join(tempDir("rr-internal-archive-"), "forged.tar");
    writeFileSync(
      out,
      buildTar([
        { kind: "pax", global: true, records: { comment: repo.commitSha } },
        { kind: "file", name: "src/unrelated.ts", data: "not the commit\n" },
      ]),
    );
    const record = await archiveRun(repo, out);
    expect(record.status).toBe("blocked");
    expect(record.acquisition.refusals[0].reason).toBe("archive_commit_unverified");
    expect(record.draft).toBeNull();
  });

  it("refuses an archive that hides a file with export-ignore", async () => {
    const repo = makeFixtureRepo({ ".gitattributes": "hidden.ts export-ignore\n", "src/a.ts": "a\n", "hidden.ts": `k = "${FAKE_AWS_KEY}"\n` });
    saveCheckout(fixtureAllowlist().repositories[0].repositoryRef, repo.path);
    const out = join(tempDir("rr-internal-archive-"), "hiding.tar");
    gitArchive(repo, out);
    const record = await archiveRun(repo, out);
    expect(record.status).toBe("blocked");
    expect(record.acquisition.refusals[0].detail).toContain("1 of the commit's entries are missing");
  });

  it("refuses an archive with no allowlisted clone to check it against", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "a\n" });
    const out = join(tempDir("rr-internal-archive-"), "commit.tar");
    gitArchive(repo, out);
    const record = await archiveRun(repo, out);
    expect(record.status).toBe("blocked");
    expect(record.acquisition.refusals[0].reason).toBe("checkout_not_configured");
  });

  const tarOf = (commitSha: string, entries: Parameters<typeof buildTar>[0]) => {
    const out = join(tempDir("rr-internal-archive-"), "hand-built.tar");
    writeFileSync(out, buildTar([{ kind: "pax", global: true, records: { comment: commitSha } }, ...entries]));
    return out;
  };
  const gitEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  const gitIn = (path: string, ...args: string[]) => execFileSync("git", ["-C", path, ...args], { env: gitEnv }).toString("utf8").trim();

  it("refuses an archive that repeats one pinned file and omits the other: a BLOCKED run with no draft", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "alpha\n", "src/b.ts": "bravo\n" });
    saveCheckout(FIXTURE_REPOSITORY, repo.path);
    const record = await archiveRun(
      repo,
      tarOf(repo.commitSha, [
        { kind: "file", name: "src/a.ts", data: "alpha\n" },
        { kind: "file", name: "src/a.ts", data: "alpha\n" },
      ]),
    );
    expect(record.status).toBe("blocked");
    expect(record.draft).toBeNull();
    expect(record.signed).toBeNull();
    expect(record.checkRuns).toEqual([]);
    expect(record.acquisition.refusals[0].reason).toBe("duplicate_entry_path");
    expect(loadRun(record.runId)?.status).toBe("blocked");
  });

  it("refuses the same archive when the repeat is spelled differently", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "alpha\n", "src/b.ts": "bravo\n" });
    saveCheckout(FIXTURE_REPOSITORY, repo.path);
    const record = await archiveRun(
      repo,
      tarOf(repo.commitSha, [
        { kind: "file", name: "src/a.ts", data: "alpha\n" },
        { kind: "file", name: "./src//a.ts", data: "alpha\n" },
      ]),
    );
    expect(record.status).toBe("blocked");
    expect(record.draft).toBeNull();
    expect(record.acquisition.refusals[0].reason).toBe("duplicate_entry_path");
  });

  it("does not depend on the reader for that: the tree comparison counts each path once", async () => {
    // The files are handed straight to the comparison, as a reader that failed
    // to refuse the repeat would hand them over.
    const repo = makeFixtureRepo({ "src/a.ts": "alpha\n", "src/b.ts": "bravo\n" });
    const a = { path: "src/a.ts", bytes: Buffer.from("alpha\n") };
    const request = { checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha: repo.commitSha };
    for (const files of [[a, a], [a, { ...a, path: "./src/a.ts" }]]) {
      const verification = await verifyArchiveAgainstTree(request, { files, rejected: [] });
      expect(verification.matches).toBe(false);
      if (!verification.matches) {
        expect(verification.refusal.reason).toBe("archive_commit_unverified");
        expect(verification.refusal.detail).toContain("1 of the commit's entries are missing");
        expect(verification.refusal.detail).toContain("1 are repeated");
      }
    }
    const b = { path: "src/b.ts", bytes: Buffer.from("bravo\n") };
    expect((await verifyArchiveAgainstTree(request, { files: [a, b], rejected: [] })).matches).toBe(true);
  });

  it("refuses an archive that keeps every path but changes a committed file's bytes, so FAIL cannot become PASS", async () => {
    const repo = makeFixtureRepo({ "src/settings.ts": `const k = "${FAKE_AWS_KEY}";\n`, "src/app.ts": "ok\n" });
    saveCheckout(FIXTURE_REPOSITORY, repo.path);
    const record = await archiveRun(
      repo,
      tarOf(repo.commitSha, [
        { kind: "file", name: "src/app.ts", data: "ok\n" },
        { kind: "file", name: "src/settings.ts", data: "const k = process.env.K;\n" },
      ]),
    );
    expect(record.status).toBe("blocked");
    expect(record.draft).toBeNull();
    expect(record.checkRuns).toEqual([]);
    expect(record.acquisition.refusals[0].detail).toContain("1 differ");
  });

  it("refuses a repeat even when it is the only difference from the commit", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "alpha\n", "src/b.ts": "bravo\n" });
    const request = { checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha: repo.commitSha };
    const a = { path: "src/a.ts", bytes: Buffer.from("alpha\n") };
    const b = { path: "src/b.ts", bytes: Buffer.from("bravo\n") };
    for (const archive of [
      { files: [a, a, b], rejected: [] },
      { files: [a, b], rejected: [{ path: "src/a.ts", reason: "symlink_not_followed" as const, detail: "" }] },
    ]) {
      const verification = await verifyArchiveAgainstTree(request, archive);
      expect(verification.matches).toBe(false);
      if (!verification.matches) {
        expect(verification.refusal.detail).toBe(
          "The archive is not the pinned commit of the allowlisted clone: 0 of the commit's entries are missing, 0 differ, 0 are not in the commit and 1 are repeated.",
        );
      }
    }
  });

  it("requires an entry the review does not read to appear once, for the same reason", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "alpha\n", ".env": "X=1\n" });
    const request = { checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha: repo.commitSha };
    const files = [{ path: "src/a.ts", bytes: Buffer.from("alpha\n") }];
    const env = { path: ".env", reason: "credential_file_not_read" as const, detail: "" };
    const blobIds = new Map([[".env", blobId(Buffer.from("X=1\n"))]]);
    expect((await verifyArchiveAgainstTree(request, { files, rejected: [env], blobIds })).matches).toBe(true);
    const cases: Array<[typeof env[], string, ReadonlyMap<string, string> | undefined]> = [
      [[{ ...env, reason: "symlink_not_followed" as never }], "1 differ", blobIds],
      [[env, env], "1 are repeated", blobIds],
      [[], "1 of the commit's entries are missing", blobIds],
      // Unread, so its content cannot matter to the checks; compared anyway.
      [[env], "1 differ", new Map([[".env", blobId(Buffer.from("X=2\n"))]])],
      [[env], "1 differ", undefined],
    ];
    for (const [rejected, expected, ids] of cases) {
      const verification = await verifyArchiveAgainstTree(request, { files, rejected, blobIds: ids });
      expect(verification.matches).toBe(false);
      if (!verification.matches) expect(verification.refusal.detail).toContain(expected);
    }
  });

  it("refuses an archive that leaves out an entry the review would not read, so BLOCKED cannot become PASS", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "alpha\n", ".env": "X=1\n" });
    saveCheckout(FIXTURE_REPOSITORY, repo.path);
    const record = await archiveRun(repo, tarOf(repo.commitSha, [{ kind: "file", name: "src/a.ts", data: "alpha\n" }]));
    expect(record.status).toBe("blocked");
    expect(record.draft).toBeNull();
    expect(record.acquisition.refusals[0].detail).toContain("1 of the commit's entries are missing");
  });

  it("refuses an archive that adds an entry the commit does not have, even one it would not read", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "alpha\n" });
    saveCheckout(FIXTURE_REPOSITORY, repo.path);
    const record = await archiveRun(
      repo,
      tarOf(repo.commitSha, [
        { kind: "file", name: "src/a.ts", data: "alpha\n" },
        { kind: "file", name: "link.ts", data: "", typeflag: "2" },
      ]),
    );
    expect(record.status).toBe("blocked");
    expect(record.acquisition.refusals[0].detail).toContain("1 are not in the commit");
  });

  it("accepts a faithful `git archive` with a symlink, a credential file, an oversized file and a submodule, and records what the git reader records", async () => {
    const sub = makeFixtureRepo({ "s.ts": "s\n" }, { remoteRef: "Bthornton1994/rr-internal-submodule" });
    const repo = makeFixtureRepo(
      { "src/a.ts": "alpha\n", ".env": "X=1\n", "assets/big.txt": "x".repeat(2_200_000) },
      { symlinks: { "src/link.ts": "a.ts" } },
    );
    gitIn(repo.path, "update-index", "--add", "--cacheinfo", `160000,${sub.commitSha},vendor/sub`);
    gitIn(repo.path, "commit", "-q", "-m", "add a submodule");
    const commitSha = gitIn(repo.path, "rev-parse", "HEAD");
    saveCheckout(FIXTURE_REPOSITORY, repo.path);
    const out = join(tempDir("rr-internal-archive-"), "faithful.tar");
    gitArchive(repo, out);

    const viaArchive = await archiveRun({ path: repo.path, commitSha }, out);
    const viaGit = await startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: FIXTURE_REPOSITORY,
      commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "checkout", path: repo.path },
      allowlist: fixtureAllowlist(),
    });
    expect(viaArchive.status).toBe("awaiting_review");
    expect(viaArchive.acquisition.rejectedByReason).toEqual({
      credential_file_not_read: 1,
      file_too_large: 1,
      symlink_not_followed: 1,
      unsupported_entry_type: 1,
    });
    expect(viaArchive.acquisition.rejectedByReason).toEqual(viaGit.acquisition.rejectedByReason);
    expect(viaArchive.acquisition.totals.rejectedCount).toBe(viaGit.acquisition.totals.rejectedCount);
    // The totals add up: the tree's entry count, including the submodule git archive writes as a directory.
    expect(viaArchive.acquisition.totals.entryCount).toBe(viaGit.acquisition.totals.entryCount);
    expect(viaArchive.acquisition.totals.entryCount).toBe(
      viaArchive.acquisition.totals.acceptedFileCount + viaArchive.acquisition.totals.rejectedCount,
    );
    expect(viaArchive.checkRuns).toEqual(viaGit.checkRuns);
    expect(viaArchive.checkRuns.find((check) => check.checkId === "secrets.no_secrets_in_version_control")?.status).toBe("BLOCKED");
  });
});

describe("an archive is bound to the commit by exact names and git blob ids, whether or not the review reads the entry", () => {
  const ref = () => fixtureAllowlist().repositories[0].repositoryRef;
  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "f", GIT_AUTHOR_EMAIL: "f@example.invalid", GIT_COMMITTER_NAME: "f", GIT_COMMITTER_EMAIL: "f@example.invalid" };
  const gitIn = (path: string, ...args: string[]) => execFileSync("git", ["-C", path, ...args], { env: gitEnv }).toString("utf8").trim();
  const archiveOf = (repo: { path: string }, commitSha: string) =>
    execFileSync("git", ["-C", repo.path, "archive", "--format=tar", commitSha], {
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      maxBuffer: 64 * 1024 * 1024,
    });
  async function runArchive(repo: { path: string }, commitSha: string, tar: Buffer) {
    saveCheckout(ref(), repo.path);
    const path = join(tempDir("rr-internal-identity-"), "commit.tar");
    writeFileSync(path, tar);
    return startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: ref(),
      commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "archive", path },
      allowlist: fixtureAllowlist(),
    });
  }
  const FF = Buffer.from([0x6b, 0xff, 0x2e, 0x74, 0x73]); // "k\xff.ts"
  const FE = Buffer.from([0x6b, 0xfe, 0x2e, 0x74, 0x73]); // "k\xfe.ts"
  const BIG = "a".repeat(SNAPSHOT_LIMITS.maxFileBytes + 1);
  function commitWithUnreadEntries() {
    const repo = makeFixtureRepo({ "src/ok.ts": "ok\n", ".env": "X=1\n", "big.txt": BIG }, { symlinks: { link: "src/ok.ts" } });
    const commitSha = commitRawNames(repo, [{ name: FF, content: "raw\n" }]);
    return { repo, commitSha };
  }

  it("control: the unedited `git archive` of that commit is accepted, and every one of those entries is unread", async () => {
    const { repo, commitSha } = commitWithUnreadEntries();
    const record = await runArchive(repo, commitSha, archiveOf(repo, commitSha));
    expect(record.status).toBe("awaiting_review");
    expect(record.acquisition.rejectedByReason).toEqual({
      credential_file_not_read: 1,
      file_too_large: 1,
      illegal_path_character: 1,
      symlink_not_followed: 1,
    });
    expect(record.checkRuns.find((check) => check.checkId === "secrets.no_secrets_in_version_control")?.status).toBe("BLOCKED");
  });

  it.each([
    ["renames the file whose name is not UTF-8 to different bytes", (tar: Buffer) => editTarEntry(tar, FF, { name: FE })],
    ["points the symlink somewhere else", (tar: Buffer) => editTarEntry(tar, "link", { linkname: "src/ok.tx" })],
    ["changes the unread credential file", (tar: Buffer) => editTarEntry(tar, ".env", { data: "X=2\n" })],
    ["changes the unread oversized file", (tar: Buffer) => editTarEntry(tar, "big.txt", { data: `b${BIG.slice(1)}` })],
  ])("refuses an archive that %s", async (_name, edit) => {
    const { repo, commitSha } = commitWithUnreadEntries();
    const record = await runArchive(repo, commitSha, edit(archiveOf(repo, commitSha)));
    expect(record.status).toBe("blocked");
    expect(record.acquisition.refusals[0].reason).toBe("archive_commit_unverified");
  });

  it("compares a symlink whose target is too long for the tar header by its pax target", async () => {
    const target = `src/${"deep/".repeat(30)}ok.ts`;
    expect(target.length).toBeGreaterThan(100);
    const repo = makeFixtureRepo({ "src/ok.ts": "ok\n" }, { symlinks: { link: target } });
    const faithful = archiveOf(repo, repo.commitSha);
    expect(faithful.includes(Buffer.from(` linkpath=${target}\n`)), "control: git archive wrote a pax linkpath").toBe(true);
    expect((await runArchive(repo, repo.commitSha, faithful)).status).toBe("awaiting_review");
    const other = Buffer.from(faithful);
    const at = other.indexOf(Buffer.from(` linkpath=${target}\n`));
    other.write("x", at + " linkpath=".length + target.length - 1, "latin1");
    const record = await runArchive(repo, repo.commitSha, other);
    expect(record.status).toBe("blocked");
    expect(record.acquisition.refusals[0].reason).toBe("archive_commit_unverified");
  });

  it.each([
    // Recorded in docs/RELEASE-RESCUE-INTERNAL.md. A target that fits the
    // 100-byte ustar link name is written there, and that field ends at its
    // first NUL, so the archive cannot match the commit. It fails closed: read
    // the checkout.
    ["a short target, in the ustar link name", "src/ok.ts\0x", "blocked"],
    // A longer target is written as a pax `linkpath` record, which is
    // length-delimited and keeps every byte, NUL included, so the archive is
    // faithful and matches.
    ["a long target, in a pax linkpath record", `src/${"deep/".repeat(30)}ok.ts\0x`, "awaiting_review"],
  ])("reads a symlink whose target holds a NUL byte: %s", async (_form, target, status) => {
    const repo = makeFixtureRepo({ "src/ok.ts": "ok\n" });
    const blob = execFileSync("git", ["-C", repo.path, "hash-object", "-w", "--stdin"], { env: gitEnv, input: Buffer.from(target) })
      .toString("utf8")
      .trim();
    gitIn(repo.path, "update-index", "--add", "--cacheinfo", `120000,${blob},link`);
    gitIn(repo.path, "commit", "-q", "-m", "a symlink with a NUL in its target");
    const commitSha = gitIn(repo.path, "rev-parse", "HEAD");
    const archive = archiveOf(repo, commitSha);
    const pax = archive.includes(Buffer.from(` linkpath=${target}\n`));
    expect(pax, "control: only the long target is written as a pax linkpath, NUL and all").toBe(target.length > 100);
    const record = await runArchive(repo, commitSha, archive);
    expect(record.status).toBe(status);
    if (status === "blocked") expect(record.acquisition.refusals[0].reason).toBe("archive_commit_unverified");
    // The checkout reads the same commit whichever form the archive used.
    saveCheckout(ref(), repo.path);
    const viaCheckout = await startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: ref(),
      commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "checkout" },
      allowlist: fixtureAllowlist(),
    });
    expect(viaCheckout.status).toBe("awaiting_review");
  });

  it("refuses an archive that puts a hard link where the commit has a submodule", async () => {
    const sub = makeFixtureRepo({ "s.ts": "s\n" }, { remoteRef: "Bthornton1994/rr-internal-submodule" });
    const repo = makeFixtureRepo({ "src/a.ts": "a\n" });
    gitIn(repo.path, "update-index", "--add", "--cacheinfo", `160000,${sub.commitSha},vendor/sub`);
    gitIn(repo.path, "commit", "-q", "-m", "add a submodule");
    const commitSha = gitIn(repo.path, "rev-parse", "HEAD");
    const faithful = archiveOf(repo, commitSha);
    expect((await runArchive(repo, commitSha, faithful)).status, "control").toBe("awaiting_review");
    const record = await runArchive(repo, commitSha, editTarEntry(faithful, "vendor/sub/", { typeflag: "1", linkname: FAKE_AWS_KEY }));
    expect(record.status).toBe("blocked");
    expect(record.acquisition.refusals[0].reason).toBe("archive_commit_unverified");
  });

  it("refuses an archive with a directory entry that carries data", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "a\n" });
    const tar = buildTar([
      { kind: "pax", global: true, records: { comment: repo.commitSha } },
      { kind: "file", name: "src/", typeflag: "5", data: "" },
      { kind: "file", name: "src/a.ts", data: "a\n" },
      { kind: "file", name: "hidden/", typeflag: "5", data: `key = "${FAKE_AWS_KEY}"\n` },
    ]);
    const record = await runArchive(repo, repo.commitSha, tar);
    expect(record.status).toBe("blocked");
    expect(record.acquisition.refusals[0]).toEqual({ reason: "malformed_input", detail: "A directory entry carries data." });
  });
});

describe("a record written by the previous version still says why it is BLOCKED", () => {
  it("maps a legacy draftFailure sentence to processingFailure when the record is loaded", async () => {
    const repo = makeFixtureRepo({ "a.ts": "a\n" });
    const record = await startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: FIXTURE_REPOSITORY,
      commitSha: repo.commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "checkout", path: repo.path },
      allowlist: fixtureAllowlist(),
    });
    const legacy = { ...JSON.parse(readFileSync(storedRunPath(record.runId), "utf8")), status: "blocked", draft: null };
    delete legacy.processingFailure;
    legacy.draftFailure = "The source was read, but no valid draft could be built from the analysis, so there is no report.";
    writeFileSync(storedRunPath(record.runId), JSON.stringify(legacy));

    const loaded = loadRun(record.runId)!;
    expect(loaded.processingFailure).toEqual({ stage: "draft_assembly", message: legacy.draftFailure });
    expect("draftFailure" in loaded).toBe(false);
    expect(runSummary(loaded).processingFailure?.message).toBe(legacy.draftFailure);
  });

  it("keeps a processingFailure the record already has, whatever a legacy field says", async () => {
    const repo = makeFixtureRepo({ "a.ts": "a\n" });
    const record = await startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: FIXTURE_REPOSITORY,
      commitSha: repo.commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "checkout", path: repo.path },
      allowlist: fixtureAllowlist(),
    });
    const both = {
      ...JSON.parse(readFileSync(storedRunPath(record.runId), "utf8")),
      status: "blocked",
      draft: null,
      processingFailure: { stage: "sealing", message: "a sealing sentence" },
      draftFailure: "a legacy sentence",
    };
    writeFileSync(storedRunPath(record.runId), JSON.stringify(both));
    expect(loadRun(record.runId)!.processingFailure).toEqual({ stage: "sealing", message: "a sealing sentence" });
  });
});

describe("export applies retention itself", () => {
  it("withholds a report past its window even if nothing else has run the sweep", async () => {
    const { operator, record } = await draftRun();
    const shown = hashReleaseRescueReviewSubject(record.draft!.report);
    signRunAsLocalOperator(operator, record.runId, { reasonCode: REASON, approvedContentHash: shown });
    const day = 24 * 60 * 60 * 1000;
    const deliveredAt = new Date(Date.now() - 30 * day);
    recordDelivery(record.runId, deliveredAt);
    expect(loadRun(record.runId)!.status).toBe("signed");

    expect(deliveryForRun(record.runId).status).toBe("withheld");
    expect(loadRun(record.runId)!.status).toBe("purged");
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

  it("accepts only loopback hosts, and refuses a request that says a proxy forwarded it from elsewhere", () => {
    const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
    expect(isLoopbackRequest(headers({ host: "127.0.0.1:3020" }))).toBe(true);
    expect(isLoopbackRequest(headers({ host: "localhost:3020" }))).toBe(true);
    expect(isLoopbackRequest(headers({ host: "[::1]:3020" }))).toBe(true);
    expect(isLoopbackRequest(headers({ host: "example.com" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1.example.com" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1", "x-forwarded-for": "203.0.113.9" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1", "x-forwarded-for": "127.0.0.1, 203.0.113.9" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1:3020", "x-forwarded-host": "app.example.com" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1:3020", forwarded: "for=203.0.113.9;host=app.example.com" }))).toBe(false);
    expect(isLoopbackRequest(headers({ host: "127.0.0.1:3020", "x-real-ip": "203.0.113.9" }))).toBe(false);
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
