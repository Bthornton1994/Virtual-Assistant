import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The terminal's argument handling. Every command's arguments are checked in
// full before anything is read or written, so a mistyped invocation cannot run
// a review the operator did not ask for: a different source, a different
// retention policy, or a summary written somewhere else.

const started = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/lib/release-rescue-internal/run", async (original) => {
  const actual = await original<typeof import("@/lib/release-rescue-internal/run")>();
  return {
    ...actual,
    startInternalRun: (...args: Parameters<typeof actual.startInternalRun>) => {
      started.count += 1;
      return actual.startInternalRun(...args);
    },
  };
});

import { main } from "@/lib/release-rescue-internal/cli";
import { loadRun, localDir, saveCheckout } from "@/lib/release-rescue-internal/store";
import {
  FIXTURE_REPOSITORY,
  fixtureAllowlist,
  makeFixtureRepo,
  tempDir,
  writeAllowlist,
} from "@/lib/__tests__/release-rescue-internal-fixtures";

let stdout: string[];
let stderr: string[];
let work: string;
let repo: { path: string; commitSha: string };

beforeEach(() => {
  process.env.RELEASE_RESCUE_LOCAL_DIR = tempDir("rr-internal-cli-");
  work = tempDir("rr-internal-cli-out-");
  repo = makeFixtureRepo({ "src/app.ts": "ok\n" });
  const allowlistPath = join(work, "allowlist.json");
  writeAllowlist(allowlistPath, fixtureAllowlist());
  process.env.RELEASE_RESCUE_ALLOWLIST = allowlistPath;
  saveCheckout(FIXTURE_REPOSITORY, repo.path);
  started.count = 0;
  stdout = [];
  stderr = [];
  for (const [stream, sink] of [
    [process.stdout, stdout],
    [process.stderr, stderr],
  ] as const) {
    vi.spyOn(stream, "write").mockImplementation((chunk: string | Uint8Array) => {
      sink.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
  }
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  delete process.env.RELEASE_RESCUE_ALLOWLIST;
});

function runFiles(): string[] {
  const runs = join(localDir(), "runs");
  return existsSync(runs) ? readdirSync(runs) : [];
}

/** Everything written in the scratch directory, except the allowlist the harness put there. */
function writtenFiles(): string[] {
  return readdirSync(work).filter((name) => name !== "allowlist.json");
}

const STRAYS = ["--confirm-ownership", "-x", "--retention", "--summary-out"];

function expectRefused(message: string) {
  expect(process.exit).toHaveBeenCalledWith(1);
  expect(stderr.join("")).toBe(`${message}\n`);
  expect(started.count).toBe(0);
  expect(runFiles()).toEqual([]);
  expect(writtenFiles()).toEqual([]);
  for (const name of STRAYS) expect(existsSync(join(process.cwd(), name))).toBe(false);
}

describe("run: every argument is checked before anything is read or written", () => {
  const base = () => ["run", FIXTURE_REPOSITORY, "--sha", repo.commitSha];
  const out = () => join(work, "summary.json");
  const archive = () => join(work, "a.tar");

  const cases: Array<[string, () => string[], string]> = [
    ["--retention last on the line", () => [...base(), "--confirm-ownership", "--retention"], "--retention needs a value. Nothing was run."],
    ["--retention before another flag", () => [...base(), "--retention", "--confirm-ownership"], "--retention needs a value. Nothing was run."],
    ["--retention with an empty value", () => [...base(), "--retention", "", "--confirm-ownership"], "--retention needs a value. Nothing was run."],
    ["--retention naming no policy", () => [...base(), "--retention", "forever", "--confirm-ownership"], "Unknown retention policy: use one of purge_on_delivery, minimum_7_day, standard_30_day. Nothing was run."],
    ["--archive last on the line", () => [...base(), "--confirm-ownership", "--archive"], "--archive needs a value. Nothing was run."],
    ["--archive before another flag", () => [...base(), "--archive", "--confirm-ownership"], "--archive needs a value. Nothing was run."],
    ["--archive with an empty value", () => [...base(), "--archive", "", "--confirm-ownership"], "--archive needs a value. Nothing was run."],
    ["--summary-out last on the line", () => [...base(), "--confirm-ownership", "--summary-out"], "--summary-out needs a value. Nothing was run."],
    ["--summary-out before another flag", () => [...base(), "--summary-out", "--confirm-ownership"], "--summary-out needs a value. Nothing was run."],
    ["--summary-out with an empty value", () => [...base(), "--summary-out", "", "--confirm-ownership"], "--summary-out needs a value. Nothing was run."],
    ["--summary-out before a short option", () => [...base(), "--confirm-ownership", "--summary-out", "-x"], "--summary-out needs a value. Nothing was run."],
    ["--sha missing", () => ["run", FIXTURE_REPOSITORY, "--confirm-ownership"], "run needs --sha. Nothing was run."],
    ["--sha before another flag", () => ["run", FIXTURE_REPOSITORY, "--sha", "--confirm-ownership"], "--sha needs a value. Nothing was run."],
    ["--sha that is not a full commit", () => ["run", FIXTURE_REPOSITORY, "--sha", "HEAD", "--confirm-ownership"], "--sha must be a full 40-character lowercase commit sha. Nothing was run."],
    ["--archive=<file>", () => [...base(), "--confirm-ownership", `--archive=${archive()}`], "Write --archive <value>, not --archive=<value>. Nothing was run."],
    ["--summary-out=<file>", () => [...base(), "--confirm-ownership", `--summary-out=${out()}`], "Write --summary-out <value>, not --summary-out=<value>. Nothing was run."],
    ["--retention=<policy>", () => [...base(), "--confirm-ownership", "--retention=purge_on_delivery"], "Write --retention <value>, not --retention=<value>. Nothing was run."],
    ["--confirm-ownership=yes", () => [...base(), "--confirm-ownership=yes"], "Write --confirm-ownership, not --confirm-ownership=<value>. Nothing was run."],
    ["a misspelled --archive", () => [...base(), "--confirm-ownership", "--archve", archive()], "Unknown option --archve for run. Nothing was run."],
    ["a misspelled --summary-out", () => [...base(), "--confirm-ownership", "--sumary-out", out()], "Unknown option --sumary-out for run. Nothing was run."],
    ["a short option", () => [...base(), "--confirm-ownership", "-x"], "Unknown option -x for run. Nothing was run."],
    ["a bare --", () => [...base(), "--confirm-ownership", "--"], "Unknown option -- for run. Nothing was run."],
    ["--summary-out given twice", () => [...base(), "--confirm-ownership", "--summary-out", out(), "--summary-out", join(work, "b.json")], "--summary-out was given more than once. Nothing was run."],
    ["--sha given twice", () => [...base(), "--sha", repo.commitSha, "--confirm-ownership"], "--sha was given more than once. Nothing was run."],
    ["--archive given twice", () => [...base(), "--confirm-ownership", "--archive", archive(), "--archive", archive()], "--archive was given more than once. Nothing was run."],
    ["--confirm-ownership given twice", () => [...base(), "--confirm-ownership", "--confirm-ownership"], "--confirm-ownership was given more than once. Nothing was run."],
    ["an extra argument", () => [...base(), "--confirm-ownership", "extra"], "run takes 1 argument: run <owner/name> --sha <40-char sha> --confirm-ownership [--retention <policy>] [--archive <file.tar>] [--summary-out <file>]. Nothing was run."],
  ];

  it.each(cases)("refuses %s, and neither runs nor writes anything", async (_name, argv, message) => {
    await expect(main(argv())).rejects.toThrow("exit 1");
    expectRefused(message);
  });
});

describe("the other commands check their arguments the same way", () => {
  const cases: Array<[string, string[], string]> = [
    ["operator:add without --name", ["operator:add"], "operator:add needs --name. Nothing was run."],
    ["operator:add --name=<name>", ["operator:add", "--name=Alice"], "Write --name <value>, not --name=<value>. Nothing was run."],
    ["operator:add --name before another flag", ["operator:add", "--name", "--confirm-ownership"], "--name needs a value. Nothing was run."],
    ["operator:add with --name twice", ["operator:add", "--name", "A", "--name", "B"], "--name was given more than once. Nothing was run."],
    ["operator:add with a stray argument", ["operator:add", "Alice"], 'operator:add takes no arguments: operator:add --name "<display name>". Nothing was run.'],
    ["export without --out", ["export", "00000000-0000-4000-8000-000000000000"], "export needs --out. Nothing was run."],
    ["show with two run ids", ["show", "a", "b"], "show takes 1 argument: show <run id>. Nothing was run."],
    ["purge with a flag", ["purge", "--all"], "Unknown option --all for purge. Nothing was run."],
    ["checkout:set with one argument", ["checkout:set", FIXTURE_REPOSITORY], "checkout:set takes 2 arguments: checkout:set <owner/name> <absolute path>. Nothing was run."],
    ["an unknown command", ["frobnicate"], "Unknown command frobnicate. Run with no arguments for usage."],
  ];

  it.each(cases)("refuses %s", async (_name, argv, message) => {
    await expect(main(argv)).rejects.toThrow("exit 1");
    expect(stderr.join("")).toBe(`${message}\n`);
    expect(stdout).toEqual([]);
    expect(runFiles()).toEqual([]);
  });

  it("prints the usage and succeeds when given no command", async () => {
    await main([]);
    expect(stdout.join("")).toContain("Release Rescue, internal local workflow");
    expect(stdout.join("")).toContain("Exit status:");
    expect(process.exit).not.toHaveBeenCalled();
  });
});

describe("valid invocations still run", () => {
  it("runs the checkout with every option, and records exactly what was asked", async () => {
    const out = join(work, "summary.json");
    await main([
      "run",
      FIXTURE_REPOSITORY,
      "--retention",
      "purge_on_delivery",
      "--summary-out",
      out,
      "--sha",
      repo.commitSha,
      "--confirm-ownership",
    ]);
    expect(process.exit).not.toHaveBeenCalled();
    expect(process.exitCode ?? 0).toBe(0);
    expect(started.count).toBe(1);
    const summary = JSON.parse(readFileSync(out, "utf8"));
    expect(summary.status).toBe("awaiting_review");
    const record = loadRun(summary.runId)!;
    expect(record.retentionPolicy).toBe("purge_on_delivery");
    expect(record.source).toBe("git_objects");
  });

  it("runs an archive when --archive names one", async () => {
    const tar = join(work, "a.tar");
    writeFileSync(tar, execFileSync("git", ["-C", repo.path, "archive", "--format=tar", repo.commitSha]));
    const out = join(work, "summary.json");
    await main(["run", FIXTURE_REPOSITORY, "--sha", repo.commitSha, "--confirm-ownership", "--archive", tar, "--summary-out", out]);
    const summary = JSON.parse(readFileSync(out, "utf8"));
    expect(summary.status).toBe("awaiting_review");
    expect(loadRun(summary.runId)!.source).toBe("tar_archive");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("exits 2, after reporting the run, when the run is recorded as BLOCKED", async () => {
    const out = join(work, "summary.json");
    await main(["run", FIXTURE_REPOSITORY, "--sha", "f".repeat(40), "--confirm-ownership", "--summary-out", out]);
    expect(process.exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    expect(JSON.parse(readFileSync(out, "utf8")).status).toBe("blocked");
    expect(runFiles()).toHaveLength(1);
  });
});

describe("the summary file is owner-only and replaces what was there", () => {
  it("replaces an existing, world-readable file with an owner-only one", async () => {
    const out = join(work, "summary.json");
    writeFileSync(out, "old\n", { mode: 0o644 });
    await main(["run", FIXTURE_REPOSITORY, "--sha", repo.commitSha, "--confirm-ownership", "--summary-out", out]);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(out, "utf8")).status).toBe("awaiting_review");
  });

  it("replaces a symlink at the path rather than writing through it", async () => {
    const elsewhere = join(work, "elsewhere.txt");
    writeFileSync(elsewhere, "untouched\n", { mode: 0o644 });
    const out = join(work, "summary.json");
    symlinkSync(elsewhere, out);
    await main(["run", FIXTURE_REPOSITORY, "--sha", repo.commitSha, "--confirm-ownership", "--summary-out", out]);
    expect(readFileSync(elsewhere, "utf8")).toBe("untouched\n");
    expect(statSync(elsewhere).mode & 0o777).toBe(0o644);
    expect(statSync(out).isFile()).toBe(true);
    expect(JSON.parse(readFileSync(out, "utf8")).status).toBe("awaiting_review");
    expect(readdirSync(work).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
