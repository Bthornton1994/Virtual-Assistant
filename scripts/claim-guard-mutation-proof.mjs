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
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODULE = "src/lib/__tests__/release-rescue-surface-files.ts";
const SUITES = [
  "src/lib/__tests__/release-rescue-claim-guard.test.ts",
  "src/lib/ai-app-release-rescue/copy.test.ts",
];

/** @type {ReadonlyArray<{id: string, mechanism: string, from: string, to: string, control?: boolean}>} */
const MUTANTS = [
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
    id: "M-ENTRYPOINTS",
    mechanism: "files the framework loads are derived, not listed",
    from: "  for (const file of frameworkEntrypoints()) entries.add(file);",
    to: "  for (const file of frameworkEntrypoints().slice(0, 0)) entries.add(file);",
  },
  {
    id: "M-ALIASES",
    mechanism: "path aliases are read from tsconfig, not assumed",
    from: "const ALIASES = tsconfigAliases();",
    to: "const ALIASES = tsconfigAliases().slice(0, 0);",
  },
  {
    id: "M-PUBLIC",
    mechanism: "everything public/ serves is enumerated",
    from: 'export const RELEASE_RESCUE_SERVED_ASSETS: string[] = everyFileUnder("public").sort();',
    to: "export const RELEASE_RESCUE_SERVED_ASSETS: string[] = [];",
  },
  {
    id: "M-PAGE-ADJACENT",
    mechanism: "every file Next renders around a page counts, including ones this repo has none of",
    from:
      "RENDERED_AROUND_A_PAGE =\n  /^(layout|template|error|global-error|global-not-found|not-found|forbidden|unauthorized|loading|default)\\.(tsx?|jsx?|mjs|cjs)$/;",
    to: "RENDERED_AROUND_A_PAGE = /^(layout|template|error|global-error|not-found|loading)\\.tsx?$/;",
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

/** The set of tests that fail right now. Files that fail to RUN count too. */
function failingSet() {
  // Delete the report first. vitest writes no outputFile when collection
  // throws, so reading it unconditionally returns the PREVIOUS run's result.
  if (existsSync(reportPath)) unlinkSync(reportPath);
  try {
    execFileSync("npx", ["vitest", "run", "--reporter=json", `--outputFile=${reportPath}`, ...SUITES], {
      stdio: "pipe",
    });
  } catch {
    // A non-zero exit is expected for a mutant. The report, not the code, decides.
  }
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

const original = readFileSync(MODULE, "utf8");
let exitCode = 0;

try {
  const baseline = failingSet();
  console.log(`baseline failing tests: ${baseline.size === 0 ? "(none)" : [...baseline].join(", ")}`);

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
      newly = [...failingSet()].filter((name) => !baseline.has(name)).sort();
    } finally {
      writeFileSync(MODULE, original);
    }
    const held = newly.length > 0;
    const expected = mutant.control ? !held : held;
    const verdict = mutant.control ? (held ? "CONTROL FAILED" : "control ok") : held ? "HELD" : "UNHELD";
    console.log(`${mutant.id.padEnd(18)} ${verdict.padEnd(14)} ${mutant.mechanism}`);
    for (const name of newly.slice(0, 2)) console.log(`${" ".repeat(20)}by: ${name}`);
    if (!expected) exitCode = 1;
  }
} finally {
  writeFileSync(MODULE, original);
  rmSync(workDir, { recursive: true, force: true });
}

if (readFileSync(MODULE, "utf8") !== original) {
  console.error("FATAL: the module was not restored; restore it from git before continuing");
  process.exit(2);
}
console.log(exitCode === 0 ? "\nevery mechanism is held by a test, and the control changed nothing" : "\nsee UNHELD/ANCHOR-MISS above");
process.exit(exitCode);
