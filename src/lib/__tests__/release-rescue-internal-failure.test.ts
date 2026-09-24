import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What a run records when something after acquisition throws: the analysis, or
// the draft assembly once the analysis has completed.
//
// Neither fails on any input the other suites build, so each is made to fail
// here through a seam that wraps the real module. The error each throws
// carries a credential-shaped value, a file path and an instruction, so the
// tests can show that none of it reaches the stored record, the summary or a
// log.

const failing = vi.hoisted(() => ({ analysis: false, draft: false, message: "" }));

vi.mock("@/lib/release-rescue-internal/checks", async (original) => {
  const actual = await original<typeof import("@/lib/release-rescue-internal/checks")>();
  return {
    ...actual,
    analyzeSnapshot: (...args: Parameters<typeof actual.analyzeSnapshot>) => {
      if (failing.analysis) throw new Error(failing.message);
      return actual.analyzeSnapshot(...args);
    },
  };
});

vi.mock("@/lib/release-rescue-internal/draft-report", async (original) => {
  const actual = await original<typeof import("@/lib/release-rescue-internal/draft-report")>();
  return {
    ...actual,
    buildDraftReport: (...args: Parameters<typeof actual.buildDraftReport>) => {
      if (failing.draft) throw new Error(failing.message);
      return actual.buildDraftReport(...args);
    },
  };
});

import { CLI_INITIATOR, startInternalRun } from "@/lib/release-rescue-internal/run";
import { localDir, loadRun } from "@/lib/release-rescue-internal/store";
import { runSummary } from "@/lib/release-rescue-internal/summary";
import {
  FAKE_AWS_KEY,
  FIXTURE_REPOSITORY,
  PROMPT_INJECTION,
  fixtureAllowlist,
  makeFixtureRepo,
  tempDir,
} from "@/lib/__tests__/release-rescue-internal-fixtures";

const LEAKY_PATH = "src/payments/live-keys.ts";

let logged: string[];

beforeEach(() => {
  process.env.RELEASE_RESCUE_LOCAL_DIR = tempDir("rr-internal-failure-");
  failing.analysis = false;
  failing.draft = false;
  failing.message = `failed at ${LEAKY_PATH}: ${FAKE_AWS_KEY} ${PROMPT_INJECTION}`;
  logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function runOnFixture() {
  const repo = makeFixtureRepo({ "src/settings.ts": `const k = "${FAKE_AWS_KEY}";\n`, "src/app.ts": "ok\n", ".env": "X=1\n" });
  return startInternalRun({
    initiatedBy: CLI_INITIATOR,
    repositoryRef: FIXTURE_REPOSITORY,
    commitSha: repo.commitSha,
    retentionPolicy: "minimum_7_day",
    ownershipConfirmed: true,
    source: { kind: "checkout", path: repo.path },
    allowlist: fixtureAllowlist(),
  });
}

function persistedText(): string {
  const runs = join(localDir(), "runs");
  return readdirSync(runs)
    .map((name) => readFileSync(join(runs, name), "utf8"))
    .join("\n");
}

function expectNothingLeaked(recordId: string) {
  const texts = [persistedText(), JSON.stringify(runSummary(loadRun(recordId)!)), logged.join("\n")];
  for (const text of texts) {
    expect(text).not.toContain(FAKE_AWS_KEY);
    expect(text).not.toContain(LEAKY_PATH);
    expect(text).not.toContain("ignore all previous instructions");
    expect(text).not.toContain("failed at");
  }
}

describe("an analysis that throws is recorded as a BLOCKED run, not an escaped error", () => {
  it("control: without the seam switched on, the same fixture produces a draft", async () => {
    const record = await runOnFixture();
    expect(record.status).toBe("awaiting_review");
    expect(record.processingFailure).toBeNull();
  });

  it("returns and saves a BLOCKED record with the measured acquisition, and nothing the analysis would have said", async () => {
    failing.analysis = true;
    const record = await runOnFixture();

    expect(record.status).toBe("blocked");
    expect(record.processingFailure).toEqual({
      stage: "analysis",
      message:
        "The source was read, but the automated analysis did not complete, so no check has a result and there is no report.",
    });
    // Acquisition happened and is on the record, measured.
    expect(record.acquisition.status).toBe("acquired");
    expect(record.acquisition.refusals).toEqual([]);
    expect(record.acquisition.totals.acceptedFileCount).toBe(2);
    expect(record.acquisition.totals.acceptedBytes).toBeGreaterThan(0);
    expect(record.acquisition.rejectedByReason).toEqual({ credential_file_not_read: 1 });
    // No ledger, no notes, no report, no signature, no accounting.
    expect(record.checkRuns).toEqual([]);
    expect(record.notes).toBeNull();
    expect(record.draft).toBeNull();
    expect(record.signed).toBeNull();
    expect(record.accounting).toEqual({ subjectHash: null, reportHash: null, verdict: null, findingCount: null });

    const stored = loadRun(record.runId);
    expect(stored).toEqual(record);
    const summary = runSummary(stored!);
    expect(summary.checkStatusCounts).toEqual({});
    expect(summary.processingFailure?.stage).toBe("analysis");
    expectNothingLeaked(record.runId);
  });
});

describe("a draft assembly that throws after the analysis completed keeps the analysis", () => {
  it("saves a BLOCKED record with the completed ledger and notes, and no report", async () => {
    failing.draft = true;
    const record = await runOnFixture();

    expect(record.status).toBe("blocked");
    expect(record.processingFailure).toEqual({
      stage: "draft_assembly",
      message: "The source was read and analysed, but no valid draft could be built from the analysis, so there is no report.",
    });
    expect(record.checkRuns).toHaveLength(32);
    expect(record.checkRuns.find((check) => check.checkId === "secrets.no_secrets_in_version_control")?.status).toBe("FAIL");
    expect(record.notes).not.toBeNull();
    expect(record.draft).toBeNull();
    expect(record.signed).toBeNull();
    expect(record.accounting.verdict).toBeNull();
    expect(loadRun(record.runId)).toEqual(record);
    expectNothingLeaked(record.runId);
  });
});
