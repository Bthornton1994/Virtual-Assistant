import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The terminal's argument handling. Every command's arguments are checked in
// full before anything is read or written, so a mistyped invocation cannot run
// a review the operator did not ask for: a different source, a different
// retention policy, or a summary written somewhere else.

const started = vi.hoisted(() => ({ count: 0 }));
const staging = vi.hoisted(() => ({ fixed: null as Buffer | null }));

// The staged file's random suffix, made predictable only where a test asks.
vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  return {
    ...actual,
    randomBytes: ((size: number, ...rest: unknown[]) =>
      staging.fixed && rest.length === 0 ? Buffer.from(staging.fixed) : (actual.randomBytes as (...a: unknown[]) => Buffer)(size, ...rest)) as typeof actual.randomBytes,
  };
});

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
import { addOperator } from "@/lib/release-rescue-internal/local-identity";
import { signRunAsLocalOperator } from "@/lib/release-rescue-internal/review";
import { CLI_INITIATOR, startInternalRun } from "@/lib/release-rescue-internal/run";
import { loadRun, localDir, saveCheckout } from "@/lib/release-rescue-internal/store";
import { hashReleaseRescueReviewSubject } from "@/lib/release-rescue-report";
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
  staging.fixed = null;
  delete process.env.RELEASE_RESCUE_ALLOWLIST;
  // A regression that took a stray option as a file name would write it in the
  // working directory, which is the repository. Asserted absent in each
  // refusal; removed here so a failing run leaves nothing behind.
  for (const name of STRAYS) rmSync(join(process.cwd(), name), { force: true });
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
    ["an extra argument", () => [...base(), "--confirm-ownership", "extra"], "run takes 1 argument: run <owner/name> --sha <40-char sha> --confirm-ownership [--retention <policy>] [--archive <file.tar|file.tar.gz>] [--summary-out <file>]. Nothing was run."],
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
    ["checkout:set with an option", ["checkout:set", FIXTURE_REPOSITORY, "/tmp/clone", "--force"], "Unknown option --force for checkout:set. Nothing was run."],
    ["head with no argument", ["head"], "head takes 1 argument: head <owner/name>. Nothing was run."],
    ["head with two arguments", ["head", FIXTURE_REPOSITORY, "extra"], "head takes 1 argument: head <owner/name>. Nothing was run."],
    ["operator:add with a name that begins with -", ["operator:add", "--name", "-Ann"], "--name needs a value. Nothing was run."],
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
    expect(stdout.join("")).toContain("[--archive <file.tar|file.tar.gz>]");
    expect(stdout.join("")).toContain('--name " -Ann" for a display name that begins with one: names are trimmed.');
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("refuses a display name that makes a claim before asking for a passphrase", async () => {
    // Asked on a terminal, the prompt comes first and waits; nothing is typed
    // here, so reaching it would hang the test rather than pass it.
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      await expect(main(["operator:add", "--name", "Certified pentester"])).rejects.toThrow("exit 1");
    } finally {
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
    expect(stderr.join("")).toBe("A display name may not make a claim about the review. Nothing was written.\n");
    expect(stdout).toEqual([]);
    expect(existsSync(join(localDir(), "operators.json"))).toBe(false);
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

  it("exits 1, after reporting a BLOCKED run, when its summary file cannot be written", async () => {
    const out = join(work, "no-such-directory", "summary.json");
    await main(["run", FIXTURE_REPOSITORY, "--sha", "f".repeat(40), "--confirm-ownership", "--summary-out", out]);
    expect(process.exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(runFiles()).toHaveLength(1);
    const runId = runFiles()[0].replace(/\.json$/, "");
    expect(stdout.join("")).toContain("Run BLOCKED.");
    expect(stderr.join("")).toBe(`The summary file could not be written. The run is saved as ${runId}.\n`);
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

  it("writes to a name as long as the directory allows, because the staged name is short", async () => {
    const out = join(work, `${"s".repeat(250)}.json`);
    await main(["run", FIXTURE_REPOSITORY, "--sha", repo.commitSha, "--confirm-ownership", "--summary-out", out]);
    expect(process.exitCode ?? 0).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8")).status).toBe("awaiting_review");
  });

  it("removes its staged file when the rename fails", async () => {
    // A non-empty directory at the path cannot be replaced by a file.
    const out = join(work, "summary.json");
    mkdirSync(out);
    writeFileSync(join(out, "keep.txt"), "kept\n");
    await main(["run", FIXTURE_REPOSITORY, "--sha", repo.commitSha, "--confirm-ownership", "--summary-out", out]);
    expect(process.exitCode).toBe(1);
    expect(readFileSync(join(out, "keep.txt"), "utf8")).toBe("kept\n");
    expect(readdirSync(work).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("does not remove a file it did not create at the staged name", async () => {
    staging.fixed = Buffer.alloc(8, 0xab);
    const staged = join(work, `.rr-local-${"ab".repeat(8)}.tmp`);
    writeFileSync(staged, "someone else's\n");
    const out = join(work, "summary.json");
    await main(["run", FIXTURE_REPOSITORY, "--sha", repo.commitSha, "--confirm-ownership", "--summary-out", out]);
    expect(process.exitCode).toBe(1);
    expect(readFileSync(staged, "utf8")).toBe("someone else's\n");
    expect(existsSync(out)).toBe(false);
  });
});

describe("export reports a file it cannot write, and delivers nothing", () => {
  it("exits 1 with a fixed sentence, and the run is still undelivered", async () => {
    const operator = addOperator("Dana Okafor", "a long local test passphrase");
    const record = await startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: FIXTURE_REPOSITORY,
      commitSha: repo.commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "checkout" },
    });
    const shown = hashReleaseRescueReviewSubject(record.draft!.report);
    const signed = signRunAsLocalOperator(
      operator,
      record.runId,
      { reasonCode: "reviewed_findings_and_verdict_match_the_recorded_observations", approvedContentHash: shown },
      new Date(),
      { ownershipConfirmed: true },
    );
    expect(signed.ok, "control: the run is signed").toBe(true);
    await expect(main(["export", record.runId, "--out", join(work, "no-such-directory", "report.json")])).rejects.toThrow("exit 1");
    expect(stderr.join("")).toBe("The export file could not be written. Nothing was delivered.\n");
    expect(stdout).toEqual([]);
    expect(loadRun(record.runId)!.deliveredAt).toBeNull();

    await main(["export", record.runId, "--out", join(work, "report.json")]);
    expect(loadRun(record.runId)!.deliveredAt, "control: a writable path delivers").not.toBeNull();
  });
});

describe("an operator id or run id that names nothing", () => {
  it("operator:remove of an unknown operator exits 1 and changes nothing", async () => {
    const operator = addOperator("Dana Okafor", "a long local test passphrase");
    const registry = readFileSync(join(localDir(), "operators.json"), "utf8");
    await expect(main(["operator:remove", "00000000-0000-4000-8000-000000000000"])).rejects.toThrow("exit 1");
    expect(stderr.join("")).toBe("No such operator. Nothing was removed.\n");
    expect(stdout).toEqual([]);
    expect(readFileSync(join(localDir(), "operators.json"), "utf8")).toBe(registry);
    // Control: a real id is removed, and says so.
    stderr.length = 0;
    await main(["operator:remove", operator.operatorId]);
    expect(stdout.join("")).toBe("Removed.\n");
    expect(stderr).toEqual([]);
  });

  it("export of something that is not a run id withholds without sweeping retention", async () => {
    // Created long ago and never delivered, so a retention sweep would purge it.
    const old = await startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: FIXTURE_REPOSITORY,
      commitSha: repo.commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "checkout" },
      now: new Date("2000-01-01T00:00:00Z"),
    });
    const before = localState();
    for (const id of ["not-a-run-id", "../operators", old.runId.toUpperCase(), `${old.runId}x`]) {
      stderr.length = 0;
      await expect(main(["export", id, "--out", join(work, "report.json")]), id).rejects.toThrow("exit 1");
      expect(stderr.join(""), id).toBe("Withheld: No such run.\n");
      expect(localState(), id).toEqual(before);
    }
    expect(loadRun(old.runId)!.status).toBe("awaiting_review");
    expect(writtenFiles()).toEqual([]);
    // Control: a well-formed id that names no run does reach the sweep, which purges the old run.
    stderr.length = 0;
    await expect(main(["export", "00000000-0000-4000-8000-000000000000", "--out", join(work, "report.json")])).rejects.toThrow("exit 1");
    expect(stderr.join("")).toBe("Withheld: No such run.\n");
    expect(loadRun(old.runId)!.status).toBe("purged");
  });
});

// Through the real launcher, as an operator runs it: `npm run rr:local`.
const execFileAsync = promisify(execFile);
const LAUNCHER = [
  "--experimental-strip-types",
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  "scripts/release-rescue-local.mjs",
];

async function launch(argv: string[], input = ""): Promise<{ status: number; stdout: string; stderr: string }> {
  const child = execFileAsync(process.execPath, [...LAUNCHER, ...argv], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
  child.child.stdin?.end(input);
  try {
    const { stdout, stderr } = await child;
    return { status: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { status: typeof failed.code === "number" ? failed.code : -1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

/** Every byte of local state, by file, so a side effect anywhere shows. */
function localState(): Record<string, string> {
  const state: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`);
      else state[`${prefix}${name}`] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(localDir(), "");
  return state;
}

describe("an inherited property name is an unknown option, through the real launcher", () => {
  it("refuses --constructor, --toString, --__proto__ and --valueOf on every command", async () => {
    const operator = addOperator("Dana Okafor", "a long local test passphrase");
    // Created long ago and never delivered, so any command that reached the
    // retention sweep would purge it.
    const old = await startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: FIXTURE_REPOSITORY,
      commitSha: repo.commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "checkout" },
      now: new Date("2000-01-01T00:00:00Z"),
    });
    const before = localState();
    expect(Object.keys(before)).toEqual(expect.arrayContaining(["checkouts.json", "operators.json", `runs/${old.runId}.json`]));

    const commands: Array<[string, string[]]> = [
      ["run", ["run", FIXTURE_REPOSITORY, "--sha", repo.commitSha, "--confirm-ownership"]],
      ["operator:add", ["operator:add", "--name", "Kim Okafor"]],
      ["operator:list", ["operator:list"]],
      ["operator:remove", ["operator:remove", operator.operatorId]],
      ["checkout:set", ["checkout:set", FIXTURE_REPOSITORY, repo.path]],
      ["checkout:list", ["checkout:list"]],
      ["head", ["head", FIXTURE_REPOSITORY]],
      ["show", ["show", old.runId]],
      ["export", ["export", old.runId, "--out", join(work, "report.json")]],
      ["purge", ["purge"]],
    ];
    const invocations = commands.flatMap(([command, argv]) =>
      ["constructor", "toString", "__proto__", "valueOf"].map((name) => ({ command, name, argv: [...argv, `--${name}`, "x"] })),
    );
    // Two at a time: each is a cold Node process that strips types from the
    // whole CLI, and more at once starve the other test files' workers.
    const results: Array<Awaited<ReturnType<typeof launch>>> = [];
    for (let start = 0; start < invocations.length; start += 2) {
      const batch = invocations.slice(start, start + 2);
      results.push(...(await Promise.all(batch.map((invocation) => launch(invocation.argv, "a long local test passphrase\n")))));
    }
    expect(invocations).toHaveLength(40);
    invocations.forEach((invocation, index) => {
      const label = `${invocation.command} --${invocation.name}`;
      expect(results[index].stderr, label).toBe(`Unknown option --${invocation.name} for ${invocation.command}. Nothing was run.\n`);
      expect(results[index].status, label).toBe(1);
      expect(results[index].stdout, label).toBe("");
    });
    expect(localState()).toEqual(before);
    expect(writtenFiles()).toEqual([]);

    // Control: the same launcher, asked properly, does reach the sweep.
    const purge = await launch(["purge"]);
    expect(purge).toEqual({ status: 0, stdout: "Purged 1 run(s).\n", stderr: "" });
  }, 180_000);

  it("reports an unexpected failure in one sentence, with no stack trace", async () => {
    rmSync(join(localDir(), "checkouts.json"));
    mkdirSync(join(localDir(), "checkouts.json"));
    const result = await launch(["checkout:list"]);
    expect(result).toEqual({ status: 1, stdout: "", stderr: "The command failed unexpectedly (EISDIR).\n" });
  }, 30_000);

  it("operator:add prints a refusal's fixed sentence, and nothing of any other error's text", async () => {
    addOperator("Dana Okafor", "a long local test passphrase");
    const duplicate = await launch(["operator:add", "--name", "dana okafor"], "a long local test passphrase\n");
    expect(duplicate).toEqual({ status: 1, stdout: "", stderr: "An operator with that display name already exists. Nothing was written.\n" });
    const short = await launch(["operator:add", "--name", "Kim Okafor"], "short\n");
    expect(short).toEqual({ status: 1, stdout: "", stderr: "A passphrase must be at least 12 characters. Nothing was written.\n" });

    const registry = join(localDir(), "operators.json");
    const secret = "/srv/private/rr-secret-path";
    const cases: Array<[string, () => void, string]> = [
      ["a directory where the registry should be", () => {
        rmSync(registry, { force: true, recursive: true });
        mkdirSync(registry);
      }, "The command failed unexpectedly (EISDIR).\n"],
      ["a registry that is not JSON, holding a path and a second line", () => {
        rmSync(registry, { force: true, recursive: true });
        writeFileSync(registry, `not json ${secret}\nsecond line ${secret}\n`);
      }, "The command failed unexpectedly.\n"],
      ["a registry that fails its schema, with a path and a line break in a value", () => {
        rmSync(registry, { force: true, recursive: true });
        writeFileSync(registry, JSON.stringify({ schemaVersion: 1, operators: [{ operatorId: `${secret}\nsecond line`, displayName: secret }] }));
      }, "The command failed unexpectedly.\n"],
    ];
    for (const [name, setUp, expected] of cases) {
      setUp();
      const result = await launch(["operator:add", "--name", "Kim Okafor"], "a long local test passphrase\n");
      expect(result, name).toEqual({ status: 1, stdout: "", stderr: expected });
      for (const leak of [secret, "second line", localDir(), "EISDIR:", "illegal operation", "Expected", "at "]) {
        expect(result.stderr.includes(leak), `${name}: ${leak}`).toBe(false);
      }
    }
  }, 60_000);

  it("an export interrupted partway through its write leaves no partial file, keeps the destination, and delivers nothing", async () => {
    const operator = addOperator("Dana Okafor", "a long local test passphrase");
    const record = await startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: FIXTURE_REPOSITORY,
      commitSha: repo.commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "checkout" },
    });
    const shown = hashReleaseRescueReviewSubject(record.draft!.report);
    const signed = signRunAsLocalOperator(
      operator,
      record.runId,
      { reasonCode: "reviewed_findings_and_verdict_match_the_recorded_observations", approvedContentHash: shown },
      new Date(),
      { ownershipConfirmed: true },
    );
    expect(signed.ok, "control: the run is signed").toBe(true);
    const out = join(work, "report.json");
    writeFileSync(out, "the previous export\n");

    // A file size limit of 1 KiB: the exclusive open succeeds, and the write
    // fails partway, the way a full disk would. SIGXFSZ is ignored so the write
    // fails with EFBIG instead of killing the process.
    const limited = await new Promise<{ status: number; stdout: string; stderr: string }>((done) => {
      execFile(
        "bash",
        ["-c", 'trap "" XFSZ; ulimit -f 1; exec "$@"', "bash", process.execPath, ...LAUNCHER, "export", record.runId, "--out", out],
        { cwd: process.cwd(), env: process.env, encoding: "utf8" },
        (error, stdout, stderr) => done({ status: error ? ((error as { code?: number }).code ?? -1) : 0, stdout, stderr }),
      );
    });
    expect(limited).toEqual({ status: 1, stdout: "", stderr: "The export file could not be written. Nothing was delivered.\n" });
    expect(readdirSync(work).sort()).toEqual(["allowlist.json", "report.json"]);
    expect(readFileSync(out, "utf8")).toBe("the previous export\n");
    expect(loadRun(record.runId)!.deliveredAt).toBeNull();

    // Control: the report is larger than the limit, so the limit is what failed
    // the write; without it the same export succeeds.
    const unlimited = await launch(["export", record.runId, "--out", out]);
    expect(unlimited.status, unlimited.stderr).toBe(0);
    expect(statSync(out).size).toBeGreaterThan(1024);
    expect(loadRun(record.runId)!.deliveredAt).not.toBeNull();
    expect(readdirSync(work).sort()).toEqual(["allowlist.json", "report.json"]);
  }, 60_000);

  it("accepts a display name that begins with - when it is written with a leading space", async () => {
    const result = await launch(["operator:add", "--name", " -Ann Okafor"], "a long local test passphrase\n");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^Operator created: -Ann Okafor \(/);
  }, 30_000);
});
