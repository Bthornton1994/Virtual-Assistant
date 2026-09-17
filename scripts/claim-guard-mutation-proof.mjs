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
// One mechanism lives in the guard itself rather than the discovery module.
const INTAKE = "src/lib/release-rescue-intake.ts";
const FILES = [MODULE, INTAKE];
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
 * A `to` value is either VERBATIM from the commit the mechanism replaced, or a
 * RECONSTRUCTION of it, and each says which. The sentence that used to stand
 * here claimed all but two were quoted; an audit checked every one against
 * `git show` for the ten commits that touched the module and found four
 * verbatim, not thirteen. The rest are functionally faithful but use identifiers
 * that no longer exist (`NOT_A_SURFACE`, `APP_DIR`, `decodedAssetText` returning
 * a scalar), so they cannot be quotes.
 *
 * Both of the special cases below remain special for their own reasons:
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
 * counted as though it were. `kind` is printed with the verdict, and an entry
 * WITHOUT a `kind` is verbatim. The header used to say "each says which", which
 * was not true of the entries carrying no label; it was then corrected to name
 * "the six that carry no label", and there were SEVEN — the seventh being the
 * CONTROL, whose `to` is a synthetic comment reword and a verbatim predecessor
 * of nothing. Counting by hand is how both versions went wrong, so no count is
 * stated here: the control now carries its own `kind`, and the check below
 * fails the run if it ever loses it, which is what makes "no label means
 * verbatim" true of every remaining entry.
 *
 * @type {ReadonlyArray<{id: string, mechanism: string, from: string, to: string, kind?: string, file?: string, control?: boolean}>}
 */
const MUTANTS = [
  {
    id: "M-GRAPH-EXCLUSION",
    mechanism: "a module a page imports stays in the graph whatever it is called",
    from: "      if (target && !reached.has(target)) {",
    to: "      if (target && !reached.has(target) && !/\\.(test|test-fixtures)\\.(tsx?|jsx?|mjs|cjs)$/.test(target)) {",
    kind: "reconstruction: the predecessor used identifiers this commit removed, so no verbatim quote exists",
  },
  {
    id: "M-RUNNER-CONFIG",
    mechanism: "test-ness is decided by what the runner collects, not by a name pattern",
    from: "  return RUNNER_PATTERNS.some((pattern) => pattern.test(file));",
    to: "  return /\\.(test|test-fixtures)\\.(tsx?|jsx?|mjs|cjs)$/.test(file);",
    kind: "reconstruction: the predecessor used identifiers this commit removed, so no verbatim quote exists",
  },
  {
    id: "M-ROUTE-ROOTS",
    mechanism: "the route directories Next resolves are probed, not named",
    from: "const ROUTE_ROOTS = routeRoots();",
    to: 'const ROUTE_ROOTS = ["src/app"];',
    kind: "reconstruction: the predecessor used identifiers this commit removed, so no verbatim quote exists",
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
    kind: "reconstruction: the predecessor used identifiers this commit removed, so no verbatim quote exists",
  },
  {
    id: "M-ENTRYPOINTS",
    mechanism: "framework entrypoints are derived from names x locations x extensions",
    from: "  for (const file of frameworkEntrypoints()) entries.add(file);",
    to: '  for (const file of ["src/proxy.ts", "src/middleware.ts", "src/instrumentation.ts"]) {\n    if (existsSync(resolve(process.cwd(), file))) entries.add(file);\n  }',
    kind: "reconstruction: the predecessor used identifiers this commit removed, so no verbatim quote exists",
  },
  {
    id: "M-ENTRYPOINT-NAMES",
    mechanism: "the entrypoint filenames are read from Next, not restated here",
    from: "export const FRAMEWORK_ENTRYPOINT_NAMES = frameworkEntrypointNames();",
    to: 'export const FRAMEWORK_ENTRYPOINT_NAMES = ["proxy", "middleware", "instrumentation", "instrumentation-client"];',
    kind: "reconstruction: the predecessor used identifiers this commit removed, so no verbatim quote exists",
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
      '  for (const encoding of ["utf-8", "windows-1252", declaredEncoding(body)]) {\n    if (!encoding) continue;\n    add(decode(encoding, body));\n  }\n  return [...readings];',
    to: '  for (const encoding of ["utf-8", "utf-16le", "utf-16be"]) {\n    const text = decode(encoding, body);\n    if (text !== null) return [text];\n  }\n  return [];',
    kind: "reconstruction: the predecessor used identifiers this commit removed, so no verbatim quote exists",
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
    id: "M-SPECIFIER-PARSER",
    mechanism: "import specifiers are read by the parser, not by a regular expression",
    from: "export function staticSpecifiersIn(source: string, file = \"specifiers.tsx\"): string[] {\n  const parsed = parseSurface(file, source);",
    to: 'export function staticSpecifiersIn(source: string, file = "specifiers.tsx"): string[] {\n  void file;\n  const found2: string[] = [];\n  for (const match of source.matchAll(/(?:from\\s+|import\\s*\\(\\s*)["\']([^"\']+)["\']|import\\s+["\']([^"\']+)["\']|require\\s*\\(\\s*["\']([^"\']+)["\']/g)) {\n    const specifier = match[1] ?? match[2] ?? match[3];\n    if (specifier) found2.push(specifier);\n  }\n  return found2;\n  // eslint-disable-next-line no-unreachable\n  const parsed = parseSurface(file, source);',
    kind: "verbatim: this is the regex the parser replaced",
  },
  {
    id: "M-ASSET-DECODE-ENTITIES",
    mechanism: "a served asset's entities are decoded before matching",
    from: "    const decoded = decodeEntities(text);\n    if (decoded !== text) readings.add(decoded);",
    to: "    const decoded = text;\n    if (decoded !== text) readings.add(decoded);",
    kind: "reconstruction: the predecessor decoded nothing on this path",
  },
  {
    id: "M-RESOLVE-ANY-OWN-FILE",
    mechanism: "the resolver resolves any own-tree file that exists, not only modules",
    from: "    if (existsSync(full) && statSync(full).isFile()) return candidate.replace(/\\\\/g, \"/\");",
    to: '    if (existsSync(full) && statSync(full).isFile() && /\\.(tsx?|jsx?|mjs|cjs|json)$/.test(candidate)) return candidate.replace(/\\\\/g, "/");',
    kind: "verbatim: this is the READABLE filter the predecessor applied",
  },
  {
    id: "M-SOURCE-CSS-ESCAPES",
    mechanism: "CSS escapes are decoded on the SOURCE path too, not only in assets",
    from: "  const decoded: string[] = [];\n  for (const text of found) {\n    const withoutEscapes = decodeCssEscapes(text);\n    if (withoutEscapes !== text) decoded.push(withoutEscapes);\n  }\n  return [...found, ...decoded].filter((text) => text.length > 0);",
    to: "  return found.filter((text) => text.length > 0);",
    kind: "verbatim: this is what the source path returned before",
  },
  {
    id: "M-RAW-LITERAL-TEXT",
    mechanism: "a literal's RAW source text is read, not only its cooked value",
    from: "      const raw = rawTextOf(node, parsed);",
    to: "      const raw = node.text;",
    kind: "reconstruction: the predecessor had no raw reading at all",
  },
  {
    id: "M-ENTITY-NAMES",
    mechanism: "every named character reference is decoded, not eleven of them",
    from: '    .replace(/&[a-z][a-z0-9]{1,31};?/gi, " ");',
    to: '    .replace(/&nbsp;/gi, " ")\n    .replace(/&(amp|lt|gt|quot|apos|hellip|mdash|ndash|shy|zwnj|zwj);/gi, " ");',
    kind: "verbatim: this is the eleven-name list it replaced",
  },
  {
    id: "M-GRAPH-DIALECT",
    mechanism: "the import graph parses each module in its own dialect",
    from: "    for (const specifier of staticSpecifiersIn(source, file)) {",
    to: "    for (const specifier of staticSpecifiersIn(source)) {",
    kind: "verbatim: this is the call the predecessor made",
  },
  {
    id: "M-DENIAL-SHAPE",
    mechanism: "only a declared denial SHAPE licenses a claim",
    from: "        if (denialShapeGoverns(before)) continue;",
    to: "        if (before.some((word) => NEGATION_TOKENS.has(word))) continue;",
    kind: "verbatim: this is the clause-wide rule two predecessors ago",
    file: "src/lib/release-rescue-intake.ts",
  },
  {
    id: "M-DENIAL-ADJACENT",
    mechanism: "an adjacent negation licenses, so the offer's own denials survive",
    from: "    if (next === null) return true;",
    to: "    if (next === null) return false;",
    kind: "modelled: the adjacency arm removed",
    file: "src/lib/release-rescue-intake.ts",
  },
  {
    id: "M-DENIAL-VERB",
    mechanism: "a negation on one of the offer's own reporting verbs licenses",
    from: "    if (DENIAL_VERBS.has(next)) return true;",
    to: "    if (DENIAL_VERBS.has(next) && next !== \"claim\") return true;",
    kind: "modelled: one verb dropped from the declared set",
    file: "src/lib/release-rescue-intake.ts",
  },
  {
    id: "M-SUBJECT-NEGATION",
    mechanism: "a subject negation whose predicate denies licenses the offer's refusal copy",
    from: "    if (!SUBJECT_NEGATIONS.has(before[index] ?? \"\")) continue;",
    to: "    if (true) continue;",
    kind: "modelled: the subject-negation arm removed",
    file: "src/lib/release-rescue-intake.ts",
  },
  {
    id: "M-SUBJECT-BOUND",
    mechanism: "the subject skip is bounded by an auxiliary, not open to the clause",
    from: "      if (!PREDICATE_AUXILIARIES.has(before[auxiliary] ?? \"\")) continue;",
    to: "      if (false) continue;",
    kind: "modelled: the bound removed, so any later denial verb licenses",
    file: "src/lib/release-rescue-intake.ts",
  },
  {
    id: "M-CONTRAST-ADJACENT",
    mechanism: "a contrast head licenses only what it points straight at",
    from: "      if (meaningfulAfter(index + head.length) === null) return true;",
    to: "      return true;",
    kind: "modelled: the adjacency requirement dropped from the contrast arm",
    file: "src/lib/release-rescue-intake.ts",
  },
  {
    id: "FP1",
    mechanism: "control: a comment reworded, nothing behavioural",
    from: "// ONE walk. There were two",
    to: "// ONE walk (control mutant). There were two",
    kind: "control: a synthetic reword, and a verbatim predecessor of nothing",
    control: true,
  },
];

// The invariant the header rests on, checked rather than counted: an entry with
// no `kind` is claiming to be a verbatim predecessor, and the control is not one.
for (const mutant of MUTANTS) {
  if (mutant.control && !mutant.kind) {
    console.error(`FATAL: control mutant ${mutant.id} carries no \`kind\`, so the header's "no label means verbatim" is false`);
    process.exit(2);
  }
}

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

/**
 * One sentinel per mutable file.
 *
 * This was a single `${MODULE}.mutation-proof-original`, added after a run died
 * mid-mutation. It covered the discovery module only — while the mutant list had
 * already grown a second target, `src/lib/release-rescue-intake.ts`, which holds
 * the claim guard itself. A run killed while an intake mutant was planted left
 * the LICENSING RULE weakened on disk with no sentinel beside it, and the next
 * run started, found no sentinel, and measured the weakened copy without
 * refusing. A recovery mechanism that covers one of the two files it mutates is
 * the failure it was written to prevent, narrowed rather than fixed.
 *
 * Derived from `FILES` so a third target cannot be added without one.
 */
const SENTINELS = new Map(FILES.map((file) => [file, `${file}.mutation-proof-original`]));

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
const stranded = [...SENTINELS].filter(([, sentinel]) => existsSync(sentinel));
if (stranded.length > 0) {
  console.error(
    [
      ...stranded.flatMap(([file, sentinel]) => [
        `${file} may have been left mutated by an earlier run of this script.`,
        `The untouched copy is at ${sentinel}.`,
      ]),
      "",
      "This script will not restore it for you: it cannot tell a genuine rescue copy",
      "from one that was placed there, and restoring the wrong bytes would weaken the",
      "guard while the proof reported success. Compare and restore deliberately:",
      "",
      ...stranded.flatMap(([file, sentinel]) => [
        `    git diff -- ${file}`,
        `    diff ${sentinel} ${file}`,
        `    git checkout -- ${file}   # or copy the sentinel back, having looked at it`,
        `    rm ${sentinel}`,
      ]),
    ].join("\n"),
  );
  process.exit(2);
}

/** Every file a mutant may touch, snapshotted before anything runs. */
const ORIGINALS = new Map(FILES.map((file) => [file, readFileSync(file, "utf8")]));
for (const [file, sentinel] of SENTINELS) writeFileSync(sentinel, ORIGINALS.get(file));
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
    for (const [file, text] of ORIGINALS) writeFileSync(file, text);
    for (const sentinel of SENTINELS.values()) rmSync(sentinel, { force: true });
  } catch {
    // Nothing useful to do while dying; the byte-for-byte check below is the
    // backstop for the normal path.
  }
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    restore();
    console.error(`\ninterrupted by ${signal}; ${FILES.join(" and ")} restored`);
    process.exit(130);
  });
}
process.on("uncaughtException", (error) => {
  restore();
  console.error(`\nuncaught: ${error instanceof Error ? error.message : String(error)}; ${FILES.join(" and ")} restored`);
  process.exit(2);
});

try {
  const baseline = await failingSet();
  console.log(`baseline failing tests: ${baseline.size === 0 ? "(none)" : [...baseline].join(", ")}`);
  // Stated rather than implied: this measures the WORKING TREE, not the commit.
  // An audit broke two mechanisms on disk and this script still printed that all
  // fifteen were held, which is correct behaviour for what it measures and
  // misleading for what a reader assumes it measures.
  console.log(`measuring the working tree copies of ${FILES.join(" and ")}; run \`git status\` if you expected the committed ones`);

  for (const mutant of MUTANTS) {
    const target = mutant.file ?? MODULE;
    const source = ORIGINALS.get(target);
    const occurrences = source.split(mutant.from).length - 1;
    if (occurrences !== 1) {
      console.log(`${mutant.id.padEnd(18)} ANCHOR-MISS  (${occurrences} matches) — ${mutant.mechanism}`);
      exitCode = 1;
      continue;
    }
    writeFileSync(target, source.replace(mutant.from, mutant.to));
    let newly;
    try {
      newly = [...(await failingSet())].filter((name) => !baseline.has(name)).sort();
    } finally {
      writeFileSync(target, source);
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
  for (const [file, text] of ORIGINALS) writeFileSync(file, text);
  for (const sentinel of SENTINELS.values()) rmSync(sentinel, { force: true });
  rmSync(workDir, { recursive: true, force: true });
}

for (const [file, text] of ORIGINALS) {
  if (readFileSync(file, "utf8") !== text) {
    console.error(`FATAL: ${file} was not restored; restore it from git before continuing`);
    process.exit(2);
  }
}
console.log(
  exitCode === 0
    ? `\nall ${MUTANTS.length - 1} mechanisms are held by a named test (${MUTANTS.filter((m) => !m.control && m.kind && !m.kind.startsWith("verbatim")).length} of them against a reconstructed or modelled predecessor rather than a verbatim one, each marked above), and the control changed nothing`
    : "\nsee UNHELD/ANCHOR-MISS above",
);
process.exit(exitCode);
