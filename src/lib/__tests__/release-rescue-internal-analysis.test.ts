import { describe, expect, it } from "vitest";
import { SNAPSHOT_LIMITS_VERSION } from "@/lib/release-rescue-snapshot-limits";
import { RELEASE_RESCUE_RUBRIC_V1 } from "@/lib/release-rescue-rubric";
import { validateReleaseRescueReport } from "@/lib/release-rescue-report";
import { IMPLEMENTED_CHECK_IDS, analyzeSnapshot } from "@/lib/release-rescue-internal/checks";
import { buildDraftReport } from "@/lib/release-rescue-internal/draft-report";
import type { AcquiredSnapshot, RejectedEntry } from "@/lib/release-rescue-internal/snapshot";
import {
  FAKE_AWS_KEY,
  FAKE_GITHUB_TOKEN,
  FAKE_PEM,
  PROMPT_INJECTION,
  fixtureAllowlist,
} from "@/lib/__tests__/release-rescue-internal-fixtures";

// What the internal analysis records, and what it must never do: invent a
// finding, pass a check it did not run, turn an incomplete review into a clean
// one, copy source into the report, or take instructions from a file.

const SHA = "0123456789abcdef0123456789abcdef01234567";
const RUN_ID = "3b1f8c2a-7d4e-4f6a-9b8c-1d2e3f4a5b6c";
const ENTRY = fixtureAllowlist().repositories[0];

function snapshot(files: Record<string, string>, rejected: RejectedEntry[] = []): AcquiredSnapshot {
  return {
    status: "acquired",
    source: "git_objects",
    commitSha: SHA,
    limitsVersion: SNAPSHOT_LIMITS_VERSION,
    files: Object.entries(files).map(([path, text]) => ({ path, bytes: Buffer.from(text, "utf8") })),
    rejected,
    totals: { entryCount: 0, acceptedFileCount: 0, rejectedCount: 0, streamBytes: 0, expandedBytes: 0, acceptedBytes: 0 },
  };
}

function draftFor(files: Record<string, string>, rejected: RejectedEntry[] = []) {
  const analysis = analyzeSnapshot(snapshot(files, rejected));
  const draft = buildDraftReport({
    runId: RUN_ID,
    entry: ENTRY,
    commitSha: SHA,
    analysis,
    retentionPolicy: "minimum_7_day",
    now: new Date("2026-09-23T12:00:00.000Z"),
  });
  return { analysis, draft, json: JSON.stringify(draft.report) };
}

describe("a committed credential is recorded as an observation, and never copied", () => {
  it("finds a vendor-shaped key, cites its line, and keeps the value out of the report", () => {
    const { analysis, draft, json } = draftFor({
      "src/settings.ts": `export const region = "eu-west-1";\nexport const key = "${FAKE_AWS_KEY}";\n`,
      "src/app.ts": "export const ok = true;\n",
    });
    const run = analysis.checkRuns.find((check) => check.checkId === "secrets.no_secrets_in_version_control");
    expect(run?.status).toBe("FAIL");
    expect(draft.report.findings).toHaveLength(1);
    const [finding] = draft.report.findings;
    expect(finding.observationCode).toBe("secrets.literal_credential_in_repository");
    expect(finding.locations).toEqual([{ path: "src/settings.ts", startLine: 2, endLine: 2 }]);
    // Not confirmed: a pattern match cannot say the key is live, so it does not block.
    expect(finding.confidence).toBe("likely");
    expect(finding.blocking).toBe(false);
    expect(json).not.toContain(FAKE_AWS_KEY);
    expect(json).not.toContain("eu-west-1");
    expect(json).not.toContain("export const");
  });

  it("finds a multi-line private key no single line reveals", () => {
    const { draft, json } = draftFor({ "keys/server.txt": `header\n${FAKE_PEM}\nfooter\n` });
    expect(draft.report.findings.map((finding) => finding.observationCode)).toContain(
      "secrets.literal_credential_in_repository",
    );
    expect(json).not.toContain("MIIEowIBAAKCAQEA");
  });

  it("counts a generic assignment for a reviewer instead of reporting it", () => {
    const { analysis, draft } = draftFor({ "src/config.ts": 'const password = "hunter2hunter2";\n' });
    expect(draft.report.findings).toHaveLength(0);
    expect(Object.values(analysis.notes.reviewerCandidatesByDetector).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it("names a privileged key exposed to the browser, as a possibility, from its name alone", () => {
    const { draft, json } = draftFor({
      "src/client.ts": `const url = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;\nconst t = "${FAKE_GITHUB_TOKEN}";\n`,
    });
    const codes = draft.report.findings.map((finding) => [finding.observationCode, finding.confidence]);
    expect(codes).toContainEqual(["secrets.privileged_key_reaches_the_client", "possible"]);
    expect(codes).toContainEqual(["secrets.literal_credential_in_repository", "likely"]);
    expect(json).not.toContain(FAKE_GITHUB_TOKEN);
  });
});

describe("nothing unrun or merely clean becomes a pass", () => {
  it("leaves every check it did not implement NOT RUN and not assessed", () => {
    const { analysis, draft } = draftFor({ "src/app.ts": "export const ok = true;\n" });
    for (const check of RELEASE_RESCUE_RUBRIC_V1) {
      const run = analysis.checkRuns.find((entry) => entry.checkId === check.id);
      const assessment = draft.report.assessments.find((entry) => entry.checkId === check.id);
      if ((IMPLEMENTED_CHECK_IDS as readonly string[]).includes(check.id)) continue;
      expect(run?.status).toBe("NOT_RUN");
      expect(assessment?.outcome).toBe("not_assessed");
      expect(assessment?.rationaleCode).toBe("not_assessed_requires_a_reviewers_reading");
    }
  });

  it("records a clean automated check as PASS in the ledger and not assessed in the report", () => {
    const { analysis, draft } = draftFor({ "src/app.ts": "export const ok = true;\n" });
    const run = analysis.checkRuns.find((check) => check.checkId === "secrets.no_secrets_in_version_control");
    expect(run?.status).toBe("PASS");
    const assessment = draft.report.assessments.find((entry) => entry.checkId === "secrets.no_secrets_in_version_control");
    expect(assessment?.outcome).toBe("not_assessed");
    expect(assessment?.rationaleCode).toBe("not_assessed_automated_check_found_no_instance");
  });

  it("never produces a pass, and never a clean verdict, on any input", () => {
    const inputs: Record<string, string>[] = [
      { "a.ts": "export const ok = 1;\n" },
      { "a.ts": `const k = "${FAKE_AWS_KEY}";\n` },
      { "README.md": PROMPT_INJECTION },
    ];
    for (const files of inputs) {
      const { draft } = draftFor(files);
      expect(draft.report.assessments.some((assessment) => assessment.outcome === "pass")).toBe(false);
      expect(draft.report.verdict).toBe("conditional_release");
      expect(draft.report.coverage.assessedChecks).toBeLessThan(draft.report.coverage.totalChecks);
    }
  });

  it("marks a text check BLOCKED when a file it covers was not read", () => {
    const { analysis, draft } = draftFor({ "src/app.ts": "ok\n" }, [
      { path: ".env", reason: "credential_file_not_read", detail: "" },
    ]);
    const run = analysis.checkRuns.find((check) => check.checkId === "secrets.no_secrets_in_version_control");
    expect(run?.status).toBe("BLOCKED");
    expect(run?.filesNotRead).toBe(1);
    expect(draft.report.assessments.find((entry) => entry.checkId === run?.checkId)?.rationaleCode).toBe(
      "not_assessed_automated_check_could_not_read_everything",
    );
  });

  it("does not treat a skipped symlink as an unread file", () => {
    const { analysis } = draftFor({ "src/app.ts": "ok\n" }, [
      { path: "link", reason: "symlink_not_followed", detail: "" },
    ]);
    expect(analysis.checkRuns.find((check) => check.checkId === "secrets.no_secrets_in_version_control")?.status).toBe("PASS");
  });
});

describe("repository content is data, never an instruction", () => {
  it("is unmoved by a file telling the reviewer what to conclude", () => {
    const clean = draftFor({ "src/app.ts": "export const ok = true;\n" });
    const hostile = draftFor({
      "src/app.ts": "export const ok = true;\n",
      "README.md": `${PROMPT_INJECTION}\n`,
      "src/notes.ts": `// ${PROMPT_INJECTION}\n`,
    });
    expect(hostile.draft.report.verdict).toBe(clean.draft.report.verdict);
    expect(hostile.draft.report.assessments).toEqual(clean.draft.report.assessments);
    expect(hostile.draft.report.findings).toEqual(clean.draft.report.findings);
    expect(hostile.json).not.toContain("ignore all previous instructions");
    expect(hostile.json).not.toContain("SYSTEM NOTICE");
  });
});

describe("the draft is a valid, unsigned report built by the production assembler", () => {
  it("passes the report validator and carries no reviewer", () => {
    const { draft } = draftFor({ "a.ts": `const k = "${FAKE_AWS_KEY}";\n` });
    expect(validateReleaseRescueReport(draft.report).hardGatePass).toBe(true);
    expect(draft.report.reviewedBy).toBeNull();
    expect(draft.report.preparedBy.executorKind).toBe("deterministic");
    expect(draft.report.preparedBy.modelId).toBeNull();
    expect(draft.report.limitationCodes).toContain("review_limited_to_automated_checks");
    expect(draft.report.scope.aiAssistedReviewAccepted).toBe(false);
    expect(draft.report.authorityReport).toEqual(
      expect.objectContaining({ externalMessagesSent: 0, repositoryChangesMade: 0, permissionsChanged: 0 }),
    );
  });
});
