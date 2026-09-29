import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeSnapshot } from "@/lib/release-rescue-internal/checks";
import { parseLsTree, readGitCommit, resolveCheckoutHead, verifyArchiveAgainstTree } from "@/lib/release-rescue-internal/git-source";
import { addOperator } from "@/lib/release-rescue-internal/local-identity";
import { attestationFromLocalOperator, deliveryForRun, signRunAsLocalOperator } from "@/lib/release-rescue-internal/review";
import { initiatorFromOperator, startInternalRun } from "@/lib/release-rescue-internal/run";
import { measuredRatio, type AcquiredSnapshot } from "@/lib/release-rescue-internal/snapshot";
import { readTarStream } from "@/lib/release-rescue-internal/tar-source";
import { SNAPSHOT_LIMITS_VERSION } from "@/lib/release-rescue-snapshot-limits";
import {
  FAKE_AWS_KEY,
  FIXTURE_REPOSITORY,
  buildTar,
  fixtureAllowlist,
  makeFixtureRepo,
  tarHeader,
  tempDir,
} from "@/lib/__tests__/release-rescue-internal-fixtures";

// Remaining fail-closed acquisition, analysis, and signing gates from the
// merged internal workflow. A plain directory, a GNU size encoding, a
// tree listing with an unsafe size, a credential-only tree, a UTF-16 BE
// secret, a findings cap, or a malformed signature must not pass.

const SHA = "0123456789abcdef0123456789abcdef01234567";
const PASSPHRASE = "a long local test passphrase";
const REASON = "reviewed_findings_and_verdict_match_the_recorded_observations";

beforeEach(() => {
  process.env.RELEASE_RESCUE_LOCAL_DIR = tempDir("rr-internal-reader-");
});

afterEach(() => {
  delete process.env.RELEASE_RESCUE_LOCAL_DIR;
});

function tarStream(buffer: Buffer): Readable {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += 700) chunks.push(buffer.subarray(offset, offset + 700));
  return Readable.from(chunks);
}

function withCommit(entries: Parameters<typeof buildTar>[0]): Parameters<typeof buildTar>[0] {
  return [{ kind: "pax", global: true, records: { comment: SHA } }, ...entries];
}

function gnuBase256SizeHeader(name: string): Buffer {
  const block = tarHeader(name, 0, "0");
  block[124] = 0x80;
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return block;
}

function snapshot(files: Record<string, string | Buffer>): AcquiredSnapshot {
  return {
    status: "acquired",
    source: "git_objects",
    commitSha: SHA,
    limitsVersion: SNAPSHOT_LIMITS_VERSION,
    measuredRatio: measuredRatio(false),
    files: Object.entries(files).map(([path, text]) => ({
      path,
      bytes: typeof text === "string" ? Buffer.from(text, "utf8") : text,
    })),
    rejected: [],
    totals: { entryCount: 0, acceptedFileCount: 0, rejectedCount: 0, streamBytes: 0, expandedBytes: 0, acceptedBytes: 0 },
  };
}

async function draftRun() {
  const operator = addOperator(`Reviewer ${Math.random().toString(36).slice(2, 8)}`, PASSPHRASE);
  const repo = makeFixtureRepo({ "src/a.ts": "export const a = 1;\n" });
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

describe("a checkout that is not a git repository is refused before any object is read", () => {
  it("blocks a plain directory as checkout_not_a_git_repository", async () => {
    const checkout = tempDir("rr-not-git-");
    const outcome = await readGitCommit({
      checkoutPath: checkout,
      repositoryRef: FIXTURE_REPOSITORY,
      commitSha: "a".repeat(40),
    });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") {
      expect(outcome.refusals[0].reason).toBe("checkout_not_a_git_repository");
      expect(outcome.totals.acceptedFileCount).toBe(0);
    }
  });

  it("forwards that refusal when an archive is checked against the same path", async () => {
    const checkout = tempDir("rr-not-git-verify-");
    const verification = await verifyArchiveAgainstTree(
      { checkoutPath: checkout, repositoryRef: FIXTURE_REPOSITORY, commitSha: "a".repeat(40) },
      { files: [], rejected: [], blobIds: new Map() },
    );
    expect(verification.matches).toBe(false);
    if (!verification.matches) expect(verification.refusal.reason).toBe("checkout_not_a_git_repository");
  });
});

describe("the tree listing is refused rather than guessed", () => {
  const objectId = "a".repeat(40);

  it("returns null for a negative size, an unsafe integer, a missing size, or a bad mode", () => {
    expect(parseLsTree(Buffer.from(`100644 blob ${objectId} -1\tfile\0`))).toBeNull();
    expect(parseLsTree(Buffer.from(`100644 blob ${objectId} 9007199254740992\tfile\0`))).toBeNull();
    expect(parseLsTree(Buffer.from(`100644 blob ${objectId}\tfile\0`))).toBeNull();
    expect(parseLsTree(Buffer.from(`10064 blob ${objectId} 1\tfile\0`))).toBeNull();
  });
});

describe("the dashboard head lookup refuses a path or branch that could leave the checkout", () => {
  it("returns null for a relative path, a branch with .., and a branch with a shell metacharacter", async () => {
    const repo = makeFixtureRepo({ "a.ts": "a\n" });
    expect(await resolveCheckoutHead("relative/path", "main")).toBeNull();
    expect(await resolveCheckoutHead(repo.path, "../main")).toBeNull();
    expect(await resolveCheckoutHead(repo.path, "main;rm")).toBeNull();
  });
});

describe("a snapshot with no readable file is blocked, not acquired empty", () => {
  it("blocks a checkout that holds only a credential file", async () => {
    const repo = makeFixtureRepo({ ".env": "X=1\n" });
    const outcome = await readGitCommit({
      checkoutPath: repo.path,
      repositoryRef: FIXTURE_REPOSITORY,
      commitSha: repo.commitSha,
    });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") {
      expect(outcome.refusals[0].reason).toBe("empty_snapshot");
      expect(outcome.totals.acceptedFileCount).toBe(0);
    }
  });

  it("blocks an archive whose only entries are unread", async () => {
    const tar = buildTar(
      withCommit([
        { kind: "file", name: ".env", data: "X=1\n" },
        { kind: "file", name: "link", data: "", typeflag: "2" },
      ]),
    );
    const outcome = await readTarStream(tarStream(tar), SHA, { gzip: false });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.refusals[0].reason).toBe("empty_snapshot");
  });
});

describe("GNU base-256 tar sizes are refused rather than decoded", () => {
  it("blocks a header whose size field has the high bit set", async () => {
    const tar = buildTar(withCommit([{ kind: "raw", block: gnuBase256SizeHeader("a.ts") }]));
    const outcome = await readTarStream(tarStream(tar), SHA, { gzip: false });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.refusals[0].reason).toBe("malformed_input");
  });
});

describe("analysis still finds a credential the encoding would otherwise hide", () => {
  it("decodes UTF-16 BE without a BOM and cites the line", () => {
    const text = `line one\nconst k = "${FAKE_AWS_KEY}";\n`;
    const be = Buffer.from(text, "utf16le").swap16();
    const analysis = analyzeSnapshot(snapshot({ "src/utf16be.ts": be }));
    expect(analysis.notes.utf16FilesDecoded).toBe(1);
    const secrets = analysis.checkRuns.find((check) => check.checkId === "secrets.no_secrets_in_version_control");
    expect(secrets?.status).toBe("FAIL");
    expect(analysis.findings[0].locations).toEqual([{ path: "src/utf16be.ts", startLine: 2, endLine: 2 }]);
  });

  it("caps findings and still counts the dropped observations", () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 30; index += 1) {
      files[`src/key-${String(index).padStart(2, "0")}.ts`] = `const k = "${FAKE_AWS_KEY}";\n`;
    }
    const analysis = analyzeSnapshot(snapshot(files));
    const secrets = analysis.checkRuns.find((check) => check.checkId === "secrets.no_secrets_in_version_control");
    expect(secrets?.status).toBe("FAIL");
    expect(secrets?.observationCount).toBe(30);
    expect(analysis.findings).toHaveLength(25);
    expect(analysis.notes.observationsBeyondCap).toBe(5);
  });

  it("splits one file's locations at the per-finding cap", () => {
    const lines = Array.from({ length: 21 }, () => `const k = "${FAKE_AWS_KEY}";`).join("\n");
    const analysis = analyzeSnapshot(snapshot({ "src/many.ts": `${lines}\n` }));
    const credentialFindings = analysis.findings.filter(
      (finding) => finding.observationCode === "secrets.literal_credential_in_repository",
    );
    expect(credentialFindings).toHaveLength(2);
    expect(credentialFindings[0].locations).toHaveLength(20);
    expect(credentialFindings[1].locations).toHaveLength(1);
    expect(analysis.notes.observationsBeyondCap).toBe(0);
  });

  it("records a client-exposed privileged name from each supported prefix", () => {
    const analysis = analyzeSnapshot(
      snapshot({
        "src/env.ts": [
          "NEXT_PUBLIC_SERVICE_ROLE",
          "VITE_API_SECRET",
          "REACT_APP_ADMIN_KEY",
          "EXPO_PUBLIC_PASSWORD",
          "NUXT_PUBLIC_PRIVATE_KEY",
          "GATSBY_PRIVATE",
          "PUBLIC_ADMIN_KEY",
        ].join("\n"),
      }),
    );
    const client = analysis.checkRuns.find((check) => check.checkId === "secrets.no_secrets_reachable_from_client");
    expect(client?.status).toBe("FAIL");
    expect(client?.observationCount).toBe(7);
  });
});

describe("a signature submission is refused before anything is recorded", () => {
  it("refuses an unknown reason code and a hash that is not 64 lowercase hex", () => {
    const operator = addOperator("Submission Case", PASSPHRASE);
    const now = new Date("2026-09-29T10:00:00.000Z");
    expect(
      attestationFromLocalOperator(operator, { reasonCode: "looks_fine_to_me", approvedContentHash: "a".repeat(64) }, now).ok,
    ).toBe(false);
    expect(
      attestationFromLocalOperator(
        operator,
        { reasonCode: REASON, approvedContentHash: "A".repeat(64) },
        now,
      ).ok,
    ).toBe(false);
    expect(attestationFromLocalOperator(operator, { reasonCode: REASON, approvedContentHash: "zz" }, now).ok).toBe(false);
  });

  it("does not sign a run when the submission is malformed", async () => {
    const { operator, record } = await draftRun();
    const outcome = signRunAsLocalOperator(operator, record.runId, {
      reasonCode: "not_a_catalog_reason",
      approvedContentHash: "a".repeat(64),
    });
    expect(outcome).toEqual(expect.objectContaining({ ok: false, reason: "malformed_submission" }));
    expect(record.status).toBe("awaiting_review");
  });

  it("withholds a purged run with the retention message rather than looking for a signature", async () => {
    const { record } = await draftRun();
    const { loadRun, saveRun } = await import("@/lib/release-rescue-internal/store");
    const stored = loadRun(record.runId);
    expect(stored).not.toBeNull();
    if (!stored) return;
    saveRun({ ...stored, status: "purged", draft: null, signed: null });
    expect(deliveryForRun(record.runId)).toEqual({
      status: "withheld",
      blockers: ["This run was purged under its retention policy."],
    });
  });
});
