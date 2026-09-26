import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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

import { main } from "@/lib/release-rescue-internal/cli";
import { CLI_INITIATOR, startInternalRun } from "@/lib/release-rescue-internal/run";
import { localDir, loadRun, saveCheckout } from "@/lib/release-rescue-internal/store";
import { runSummary } from "@/lib/release-rescue-internal/summary";
import {
  FAKE_AWS_KEY,
  FIXTURE_REPOSITORY,
  PROMPT_INJECTION,
  fixtureAllowlist,
  makeFixtureRepo,
  tempDir,
  writeAllowlist,
} from "@/lib/__tests__/release-rescue-internal-fixtures";

const LEAKY_PATH = "src/payments/live-keys.ts";

let logged: string[];
let stderrOnly: string[];

beforeEach(() => {
  process.env.RELEASE_RESCUE_LOCAL_DIR = tempDir("rr-internal-failure-");
  failing.analysis = false;
  failing.draft = false;
  failing.message = `failed at ${LEAKY_PATH}: ${FAKE_AWS_KEY} ${PROMPT_INJECTION}`;
  logged = [];
  stderrOnly = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
  // Written straight to the process streams, too, so a catch that printed the
  // error without going through console would still be seen.
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, "write").mockImplementation((chunk: string | Uint8Array) => {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      logged.push(text);
      if (stream === process.stderr) stderrOnly.push(text);
      return true;
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  delete process.env.RELEASE_RESCUE_ALLOWLIST;
  delete process.env.RELEASE_RESCUE_TEST_FIXTURES;
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
    expect(runSummary(record).modelDependentAnalysis).toBe(
      "NOT RUN: No model provider is authorized for Release Rescue, so only the automated checks in the ledger ran.",
    );
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
    expect(summary.modelDependentAnalysis).toBe(
      "NOT RUN: No model provider is authorized for Release Rescue, and no automated check ran either.",
    );
    expectNothingLeaked(record.runId);
  });
});

describe("a draft that cannot be sealed keeps the analysis and says what failed", () => {
  it("saves a BLOCKED record at the sealing stage when the local key is malformed", async () => {
    mkdirSync(localDir(), { recursive: true });
    writeFileSync(join(localDir(), "secret.key"), "zz");
    const record = await runOnFixture();

    expect(record.status).toBe("blocked");
    expect(record.processingFailure).toEqual({
      stage: "sealing",
      message:
        "The source was read and analysed and a draft was built, but it could not be sealed with this machine's local key, so there is no report to review.",
    });
    expect(record.checkRuns).toHaveLength(32);
    expect(record.notes).not.toBeNull();
    expect(record.draft).toBeNull();
    expect(loadRun(record.runId)).toEqual(record);
    // BLOCKED, but its ledger ran: the statement follows the ledger, not the status.
    expect(runSummary(record).modelDependentAnalysis).toBe(
      "NOT RUN: No model provider is authorized for Release Rescue, so only the automated checks in the ledger ran.",
    );
    expect(JSON.stringify(record)).not.toContain("secret key is malformed");
    expect(logged.join("\n")).not.toContain("secret key is malformed");
  });
});

describe("the CLI says which stage failed, not that nothing was analysed", () => {
  async function cliRun(options: { sha?: string; extra?: string[]; beforeConfirm?: string[] } = {}) {
    // Source a leaking summary would carry: a credential and an instruction.
    const repo = makeFixtureRepo({
      "src/app.ts": "ok\n",
      "src/settings.ts": `export const key = "${FAKE_AWS_KEY}";\n`,
      "README.md": `${PROMPT_INJECTION}\n`,
    });
    const allowlistPath = join(tempDir("rr-internal-failure-allowlist-"), "allowlist.json");
    writeAllowlist(allowlistPath, fixtureAllowlist());
    process.env.RELEASE_RESCUE_ALLOWLIST = allowlistPath;
    process.env.RELEASE_RESCUE_TEST_FIXTURES = "1";
    saveCheckout(FIXTURE_REPOSITORY, repo.path);
    await main([
      "run",
      FIXTURE_REPOSITORY,
      "--sha",
      options.sha ?? repo.commitSha,
      ...(options.beforeConfirm ?? []),
      "--confirm-ownership",
      ...(options.extra ?? []),
    ]);
    return logged.join("");
  }

  it("says the source was not acquired when the acquisition was refused", async () => {
    const printed = await cliRun({ sha: "f".repeat(40) });
    expect(printed).toContain(
      "Run BLOCKED. The source was not acquired (see the refusal above), so nothing was analysed and no report exists.",
    );
  });

  it("still reports the run, and says so plainly, when the summary file cannot be written", async () => {
    const unwritable = join(tempDir("rr-internal-failure-out-"), "missing", "summary.json");
    try {
      const printed = await cliRun({ extra: ["--summary-out", unwritable] });
      const closing = printed.indexOf("Draft ready and awaiting a named reviewer.");
      const notice = printed.search(/The summary file could not be written\. The run is saved as [0-9a-f-]{36}\./);
      // The run is reported first, and the notice goes to stderr.
      expect(closing).toBeGreaterThan(-1);
      expect(notice).toBeGreaterThan(closing);
      expect(stderrOnly.join("")).toMatch(/^The summary file could not be written\. The run is saved as [0-9a-f-]{36}\.\n$/);
      expect(printed).not.toContain("ENOENT");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
    }
  });

  it("writes the printed summary, owner-only, when the summary file can be written", async () => {
    const out = join(tempDir("rr-internal-failure-out-"), "summary.json");
    const printed = await cliRun({ extra: ["--summary-out", out] });
    const written = readFileSync(out, "utf8");
    expect(printed.startsWith(written)).toBe(true);
    expect(JSON.parse(written).status).toBe("awaiting_review");
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(stderrOnly).toEqual([]);
  });

  it.each([
    ["last on the line", { extra: ["--summary-out"] }],
    ["followed by another flag", { beforeConfirm: ["--summary-out"] }],
  ])("refuses --summary-out %s without a value, before running anything", async (_name, options) => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    // What an unchecked flag parser would write: a file named after the next flag.
    const stray = join(process.cwd(), "--confirm-ownership");
    try {
      await expect(cliRun(options)).rejects.toThrow("exit");
      expect(exit).toHaveBeenCalledWith(1);
      expect(stderrOnly.join("")).toBe("--summary-out needs a value. Nothing was run.\n");
      expect(existsSync(stray)).toBe(false);
      expect(existsSync(join(localDir(), "runs")) ? readdirSync(join(localDir(), "runs")) : []).toEqual([]);
    } finally {
      rmSync(stray, { force: true });
    }
  });

  // The summary file is the printed summary, whatever stage the run stopped
  // at: never the raw record, the error that was thrown, or anything read.
  it.each([
    ["an acquisition that was refused", () => ({ sha: "f".repeat(40) }), null],
    [
      "an analysis that threw",
      () => {
        failing.analysis = true;
        return {};
      },
      "analysis",
    ],
    [
      "a draft that could not be built",
      () => {
        failing.draft = true;
        return {};
      },
      "draft_assembly",
    ],
    [
      "a draft that could not be sealed",
      () => {
        mkdirSync(localDir(), { recursive: true });
        writeFileSync(join(localDir(), "secret.key"), "zz");
        return {};
      },
      "sealing",
    ],
  ] as const)("writes exactly the printed summary for %s, and exits 2", async (_name, arrange, stage) => {
    const out = join(tempDir("rr-internal-failure-out-"), "summary.json");
    const printed = await cliRun({ ...arrange(), extra: ["--summary-out", out] });
    const written = readFileSync(out, "utf8");
    expect(printed.startsWith(written)).toBe(true);
    const summary = JSON.parse(written);
    expect(summary).toEqual(JSON.parse(JSON.stringify(runSummary(loadRun(summary.runId)!))));
    expect(summary.status).toBe("blocked");
    expect(summary.processingFailure?.stage ?? null).toBe(stage);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(process.exitCode).toBe(2);
    for (const text of [written, printed]) {
      expect(text).not.toContain(FAKE_AWS_KEY);
      expect(text).not.toContain(LEAKY_PATH);
      expect(text).not.toContain("ignore all previous instructions");
      expect(text).not.toContain("failed at");
      expect(text).not.toContain("secret key is malformed");
    }
  });

  it("names an analysis that did not complete", async () => {
    failing.analysis = true;
    const printed = await cliRun();
    expect(printed).toContain("Run BLOCKED. The source was read, but the automated analysis did not complete");
    expect(printed).not.toContain("failed at");
  });

  it("names a draft that could not be built after the analysis completed", async () => {
    failing.draft = true;
    const printed = await cliRun();
    expect(printed).toContain('"modelDependentAnalysis": "NOT RUN: No model provider is authorized for Release Rescue, so only the automated checks in the ledger ran."');
    expect(printed).toContain("Run BLOCKED. The source was read and analysed, but no valid draft could be built");
    expect(printed).not.toContain("Nothing was analysed");
    expect(printed).not.toContain("failed at");
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
