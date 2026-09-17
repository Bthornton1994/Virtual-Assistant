#!/usr/bin/env node
/**
 * Proof that the claim guard's surface-discovery and text-extraction mechanisms
 * are each held by a test that would fail without them.
 *
 * Thirty-five consecutive review rounds found the same defect class in this one
 * area: a mechanism was added, the suite went green, and nothing in the suite
 * actually depended on the mechanism. Three separate times a widening was
 * reverted and no test noticed. Prose in a commit message is not evidence for
 * that; reverting each mechanism and watching a named test fail is.
 *
 * Each entry below reverts ONE mechanism to the implementation it replaced. A
 * mechanism is HELD when the revert makes at least one named test fail that was
 * passing before. `FP1` changes only a comment and must NOT fail anything — a
 * harness that kills everything proves nothing, so the control is part of the
 * result rather than an aside.
 *
 * Scoring is the DIFFERENCE between failing-test SETS, never an exit code and
 * never a count. The repository's full suite exits non-zero from failures
 * unrelated to this area, and an earlier version of this harness read a count
 * that a collection error had inflated. It also counts a file that THREW AT
 * IMPORT, which runs no assertions at all and therefore scored a killed mutant
 * as survived until the run that caught it.
 *
 * What this does NOT prove: that the mechanisms are sufficient. It proves each
 * one is load-bearing. The residual records in `release-rescue-claim-guard-
 * residuals.ts` and the `EXTRACTOR_RESIDUALS`/`ENTRY_RESIDUALS`/`ASSET_RESIDUALS`
 * sets state what remains unread, and a named human reviewer signs before any
 * report reaches a customer.
 *
 *   node scripts/claim-guard-mutation-proof.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODULE = "src/lib/__tests__/release-rescue-surface-files.ts";
const SUITES = [
  "src/lib/__tests__/release-rescue-claim-guard.test.ts",
  "src/lib/ai-app-release-rescue/copy.test.ts",
];

/**
 * Each entry reverts ONE mechanism to THE IMPLEMENTATION IT REPLACED.
 *
 * Two entries used to substitute the EMPTY set instead — `.slice(0, 0)` for the
 * aliases and for the framework entrypoints. That is strictly weaker than the
 * predecessor, and for the aliases it merely tripped an explicit `throw`, so the
 * printed evidence was a module that failed to load rather than a test that
 * caught anything. Reverted to the real predecessors, both suites stayed green:
 * neither mechanism was held, while this script reported "all eight are held"
 * and the commit message, the architecture document and the pull request all
 * repeated it. The rule this harness exists to enforce — run the OLD
 * implementation against the NEW mutants — was the rule this harness broke.
 *
 * Most `to` values are QUOTED from the commit the mechanism replaced. Two cannot
 * be, and say so rather than passing themselves off as quotes — an audit checked
 * the git history and found the blanket claim that used to stand here untrue:
 *
 *   - `M-ASSET-RESIDUAL-SET` guards a pin that has no predecessor at all. Its
 *     `to` MODELS the absence of a pin, which is the state before it existed.
 *   - `M-EVERY-ROUTE-FILE` had a four-statement predecessor that called
 *     `ROUTE_DIR`, `ancestorChainFor` and `filesSellingTheOffer`, all deleted by
 *     the commit this proof runs against. Its `to` restores what the current
 *     module can still express, which is a BIGGER deviation than the real
 *     predecessor and therefore easier to catch — so its HELD verdict is weaker
 *     evidence than a quoted one, and it is labelled so.
 *
 * A mutant that is not the predecessor is not worthless, but it must not be
 * counted as though it were. `kind` is printed with the verdict.
 *
 * @type {ReadonlyArray<{id: string, mechanism: string, from: string, to: string, kind?: string, control?: boolean}>}
 */
const MUTANTS = [
  {
    id: "M-GRAPH-EXCLUSION",
    mechanism: "a module a page imports stays in the graph whatever it is called",
    from: "      if (target && !reached.has(target)) {",
    to: "      if (target && !reached.has(target) && !/\\.(test|test-fixtures)\\.(tsx?|jsx?|mjs|cjs)$/.test(target)) {",
  },
  {
    id: "M-RUNNER-CONFIG",
    mechanism: "test-ness is decided by what the runner collects, not by a name pattern",
    from: "  return RUNNER_PATTERNS.some((pattern) => pattern.test(file));",
    to: "  return /\\.(test|test-fixtures)\\.(tsx?|jsx?|mjs|cjs)$/.test(file);",
  },
  {
    id: "M-ROUTE-ROOTS",
    mechanism: "the route directories Next resolves are probed, not named",
    from: "const ROUTE_ROOTS = routeRoots();",
    to: 'const ROUTE_ROOTS = ["src/app"];',
  },
  {
    id: "M-SERVED-APP",
    mechanism: "the route roots' non-source files are served static too, not only public/",
    from: "  ...ROUTE_ROOTS.flatMap((root) => everyFileUnder(root)).filter((file) => !SOURCE_EXTENSION.test(file)),",
    to: "",
  },
  {
    id: "M-PUBLIC",
    mechanism: "everything public/ serves is enumerated",
    from: '  ...everyFileUnder("public"),',
    to: "",
  },
  {
    id: "M-ALIASES",
    mechanism: "path aliases are read from tsconfig, not assumed to be the one this project uses",
    from: "const ALIASES = tsconfigAliases();",
    to: 'const ALIASES = [{ prefix: "@/", target: "src" }];',
  },
  {
    id: "M-ENTRYPOINTS",
    mechanism: "framework entrypoints are derived from names x locations x extensions",
    from: "  for (const file of frameworkEntrypoints()) entries.add(file);",
    to: '  for (const file of ["src/proxy.ts", "src/middleware.ts", "src/instrumentation.ts"]) {\n    if (existsSync(resolve(process.cwd(), file))) entries.add(file);\n  }',
  },
  {
    id: "M-ENTRYPOINT-NAMES",
    mechanism: "the entrypoint filenames are read from Next, not restated here",
    from: "export const FRAMEWORK_ENTRYPOINT_NAMES = frameworkEntrypointNames();",
    to: 'export const FRAMEWORK_ENTRYPOINT_NAMES = ["proxy", "middleware", "instrumentation", "instrumentation-client"];',
  },
  {
    id: "M-EVERY-ROUTE-FILE",
    mechanism: "every file under a route root is an entry, not only those that sell the offer",
    from: "  const entries = new Set<string>(ROUTE_ROOTS.flatMap((root) => filesUnder(root)));",
    to: '  const entries = new Set<string>(filesUnder("src/app/(marketing)/ai-app-release-rescue"));',
    kind: "modelled: the predecessor also called ancestorChainFor and filesSellingTheOffer, both deleted",
  },
  {
    id: "M-ASSET-RESIDUAL-SET",
    mechanism: "the served assets exempt from the scan are an exact set",
    from: 'export const EXPECTED_ASSET_RESIDUALS = ["src/app/favicon.ico"];',
    to: "export const EXPECTED_ASSET_RESIDUALS = assetResiduals().map((residual) => residual.file);",
    kind: "modelled: this pin is new, so there is no predecessor to quote",
  },
  {
    id: "M-ASSET-DECODING",
    mechanism: "every reading a browser could give an asset is scanned, not just the first that looks printable",
    from:
      '  for (const encoding of ["utf-8", "windows-1252", declaredEncoding(body)]) {\n    if (!encoding) continue;\n    const text = decode(encoding, body);\n    if (text !== null) readings.add(text);\n  }\n  return [...readings];',
    to: '  for (const encoding of ["utf-8", "utf-16le", "utf-16be"]) {\n    const text = decode(encoding, body);\n    if (text !== null) return [text];\n  }\n  return [];',
  },
  {
    id: "M-SELF-CLOSING",
    mechanism: "JSX passed as a prop on an outermost element is read",
    from: "} else if (ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node)) {",
    to: "} else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {",
  },
  {
    id: "M-DIALECT",
    mechanism: "a surface is parsed in the dialect its extension names",
    from: "    scriptKindOf(file),",
    to: '    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,',
  },
  {
    id: "M-ALTERNATIVES",
    mechanism: "the arms of a conditional are not run together into one sentence",
    from: "jsxChildCount(node) >= 2 && !rendersAlternatives(node)",
    to: "jsxChildCount(node) >= 2",
  },
  {
    id: "M-JSX-WHITESPACE",
    mechanism: "rendered text follows JSX's whitespace rule, not the source's indentation",
    from: 'if (ts.isJsxText(child)) parts.push(mode === "separated" ? child.text : jsxTextValue(child.text));',
    to: "if (ts.isJsxText(child)) parts.push(child.text);",
  },
  {
    id: "FP1",
    mechanism: "control: a comment reworded, nothing behavioural",
    from: "// ONE walk. There were two",
    to: "// ONE walk (control mutant). There were two",
    control: true,
  },
];

const workDir = mkdtempSync(join(tmpdir(), "claim-guard-mutation-"));
const reportPath = join(workDir, "report.json");

/**
 * Run the two suites once, ASYNCHRONOUSLY.
 *
 * This used `execFileSync`, which blocks the event loop for the whole child
 * run — so the `SIGINT` handler below could not fire during the 99 seconds that
 * actually matter, and an interrupt left the discovery module mutated on disk.
 * The first attempt at fixing that added the handler and measured nothing: the
 * process ran to completion because the signal could not be delivered until the
 * event loop was free. Spawning asynchronously keeps the loop free, so the
 * handler runs and the child is killed with it.
 */
function runSuites() {
  return new Promise((resolveRun) => {
    child = spawn("npx", ["vitest", "run", "--reporter=json", `--outputFile=${reportPath}`, ...SUITES], {
      stdio: "pipe",
    });
    // A run that never finishes used to hang the script with the module still
    // mutated. Ten minutes is far longer than these two suites need.
    const bound = setTimeout(() => child?.kill("SIGKILL"), 600_000);
    child.on("close", () => {
      clearTimeout(bound);
      child = null;
      resolveRun();
    });
    child.on("error", () => {
      clearTimeout(bound);
      child = null;
      resolveRun();
    });
  });
}

/** The set of tests that fail right now. Files that fail to RUN count too. */
async function failingSet() {
  // Delete the report first. vitest writes no outputFile when collection
  // throws, so reading it unconditionally returns the PREVIOUS run's result.
  if (existsSync(reportPath)) unlinkSync(reportPath);
  await runSuites();
  if (!existsSync(reportPath)) return new Set(["<no report written>"]);
  let data;
  try {
    data = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    return new Set(["<report unparsable>"]);
  }
  const names = new Set();
  for (const suite of data.testResults ?? []) {
    const cases = suite.assertionResults ?? [];
    for (const one of cases) if (one.status === "failed") names.add(one.fullName ?? "?");
    if (suite.status === "failed" && !cases.some((one) => one.status === "failed")) {
      names.add(`<file failed to run> ${suite.name ?? "?"}`);
    }
  }
  return names;
}

const SENTINEL = `${MODULE}.mutation-proof-original`;

// Belt and braces. A signal handler cannot run through a `SIGKILL`, a power cut
// or an OOM kill, and any of those would leave the guard silently weakened in
// the working tree. The untouched original is parked beside the module for the
// duration, so a died-mid-run state is RECOVERABLE.
//
// It is not recovered automatically any more. The previous version copied the
// sentinel over the module unconditionally, before reading `original` — so a
// sentinel holding ANY content silently replaced the committed guard, and the
// run then measured its thirteen mutants against the replacement, passed its own
// byte-for-byte check against it, printed "13/13 held" and exited 0. An audit
// planted a sentinel with a real Next entrypoint name deleted and got exactly
// that. A script that writes to a source file must not decide by itself which
// content is the right one, and `.gitignore` hides this file, so nobody would
// see it arrive.
//
// Refusing is the whole fix: the operator is told what to compare and restores
// deliberately. Recovery stays possible; it stops being silent.
if (existsSync(SENTINEL)) {
  console.error(
    [
      `${MODULE} may have been left mutated by an earlier run of this script.`,
      `The untouched copy is at ${SENTINEL}.`,
      "",
      "This script will not restore it for you: it cannot tell a genuine rescue copy",
      "from one that was placed there, and restoring the wrong bytes would weaken the",
      "guard while the proof reported success. Compare and restore deliberately:",
      "",
      `    git diff -- ${MODULE}`,
      `    diff ${SENTINEL} ${MODULE}`,
      `    git checkout -- ${MODULE}   # or copy the sentinel back, having looked at it`,
      `    rm ${SENTINEL}`,
    ].join("\n"),
  );
  process.exit(2);
}

const original = readFileSync(MODULE, "utf8");
writeFileSync(SENTINEL, original);
let child = null;
let exitCode = 0;

/**
 * Restore on a signal as well as on the normal path.
 *
 * `finally` does not unwind on a default-terminating signal, so a Ctrl-C — or a
 * hung `vitest` run, which nothing used to bound — left the discovery module
 * MUTATED on disk, with the operator's last visible output being a clean
 * baseline line. An audit interrupted this script and found the guard silently
 * weakened in the working tree.
 */
const restore = () => {
  try {
    child?.kill("SIGKILL");
    writeFileSync(MODULE, original);
    rmSync(SENTINEL, { force: true });
  } catch {
    // Nothing useful to do while dying; the byte-for-byte check below is the
    // backstop for the normal path.
  }
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    restore();
    console.error(`\ninterrupted by ${signal}; ${MODULE} restored`);
    process.exit(130);
  });
}
process.on("uncaughtException", (error) => {
  restore();
  console.error(`\nuncaught: ${error instanceof Error ? error.message : String(error)}; ${MODULE} restored`);
  process.exit(2);
});

try {
  const baseline = await failingSet();
  console.log(`baseline failing tests: ${baseline.size === 0 ? "(none)" : [...baseline].join(", ")}`);
  // Stated rather than implied: this measures the WORKING TREE, not the commit.
  // An audit broke two mechanisms on disk and this script still printed that all
  // fifteen were held, which is correct behaviour for what it measures and
  // misleading for what a reader assumes it measures.
  console.log(`measuring the working tree copy of ${MODULE}; run \`git status\` if you expected the committed one`);

  for (const mutant of MUTANTS) {
    const occurrences = original.split(mutant.from).length - 1;
    if (occurrences !== 1) {
      console.log(`${mutant.id.padEnd(18)} ANCHOR-MISS  (${occurrences} matches) — ${mutant.mechanism}`);
      exitCode = 1;
      continue;
    }
    writeFileSync(MODULE, original.replace(mutant.from, mutant.to));
    let newly;
    try {
      newly = [...(await failingSet())].filter((name) => !baseline.has(name)).sort();
    } finally {
      writeFileSync(MODULE, original);
    }
    const held = newly.length > 0;
    const expected = mutant.control ? !held : held;
    const verdict = mutant.control ? (held ? "CONTROL FAILED" : "control ok") : held ? "HELD" : "UNHELD";
    console.log(`${mutant.id.padEnd(18)} ${verdict.padEnd(14)} ${mutant.mechanism}`);
    if (mutant.kind) console.log(`${" ".repeat(20)}(${mutant.kind})`);
    for (const name of newly.slice(0, 2)) console.log(`${" ".repeat(20)}by: ${name}`);
    if (!expected) exitCode = 1;
  }
} finally {
  writeFileSync(MODULE, original);
  rmSync(SENTINEL, { force: true });
  rmSync(workDir, { recursive: true, force: true });
}

if (readFileSync(MODULE, "utf8") !== original) {
  console.error("FATAL: the module was not restored; restore it from git before continuing");
  process.exit(2);
}
console.log(
  exitCode === 0
    ? `\nall ${MUTANTS.length - 1} mechanisms are held by a named test (${MUTANTS.filter((m) => m.kind && !m.control).length} against a modelled predecessor rather than a quoted one, marked above), and the control changed nothing`
    : "\nsee UNHELD/ANCHOR-MISS above",
);
process.exit(exitCode);
