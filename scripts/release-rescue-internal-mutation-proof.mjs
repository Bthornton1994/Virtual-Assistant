#!/usr/bin/env node
/**
 * Proof that the fixes from the third and later reviews of the internal Release Rescue
 * workflow are each held by a test that fails without them.
 *
 * Each entry below undoes ONE guard, by an exact textual replacement, and runs
 * the suite that is meant to hold it. A guard is HELD when at least one test
 * that passed before the change fails after it. Scoring is the difference
 * between the failing-test sets, read from vitest's JSON report, never an exit
 * code or a count. `CONTROL` changes only a comment and must fail nothing.
 *
 * What this does not prove: that a guard is sufficient, or that the tests say
 * why it exists. It proves only that removing the guard is noticed.
 *
 * It edits the files it names on disk while it runs, and restores them at the
 * end, on an interrupt, and on an uncaught error. It refuses to start if any of
 * those files has uncommitted changes, so a restore can never discard work.
 *
 *   npm run proof:rr-internal
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INTAKE = "src/lib/release-rescue-intake.ts";
const SNAPSHOT = "src/lib/release-rescue-internal/snapshot.ts";
const TAR = "src/lib/release-rescue-internal/tar-source.ts";
const GZIP = "src/lib/release-rescue-internal/gzip-members.ts";
const CLI = "src/lib/release-rescue-internal/cli.ts";
const REVIEW = "src/lib/release-rescue-internal/review.ts";
const LAUNCHER = "scripts/release-rescue-local.mjs";

const CLAIM_SUITE = "src/lib/__tests__/release-rescue-claim-guard.test.ts";
const SNAPSHOT_SUITE = "src/lib/__tests__/release-rescue-internal-snapshot.test.ts";
const CLI_SUITE = "src/lib/__tests__/release-rescue-internal-cli.test.ts";

const MUTANTS = [
  {
    id: "M-POSSESSIVE",
    guard: "a typed value's possessive reads as the bare word",
    file: INTAKE,
    from: "return bare === token.word || bare.length === 0 ? token",
    to: "return true ? token",
    suite: CLAIM_SUITE,
  },
  {
    id: "M-POSSESSIVE-OFFER",
    guard: "possessives are read as bare words in typed fields only, not in offer copy",
    file: INTAKE,
    from: "        : [plain, unquoted];",
    to: "        : [plain, withoutPossessives(plain), unquoted, withoutPossessives(unquoted)];",
    suite: CLAIM_SUITE,
  },
  {
    id: "M-CLAUSE",
    guard: "a typed-field phrase does not run across a clause break",
    file: INTAKE,
    from: '(contiguous && token.breakBefore === "clause" && token.spacedBefore)',
    to: '(false && token.breakBefore === "clause" && token.spacedBefore)',
    suite: CLAIM_SUITE,
  },
  {
    id: "M-CLAUSE-SPACED",
    guard: "only a clause mark with a space beside it separates a typed-field phrase",
    file: INTAKE,
    from: 'token.breakBefore === "clause" && token.spacedBefore)))',
    to: 'token.breakBefore === "clause")))',
    suite: CLAIM_SUITE,
  },
  {
    id: "M-LEAD-AUDITOR",
    guard: '"ISO 27001 Lead Auditor" is refused in a typed field',
    file: INTAKE,
    from: '  "27001 lead auditor",\n',
    to: "",
    suite: CLAIM_SUITE,
  },
  {
    id: "M-RATIO-PREFIX",
    guard: "the expansion ratio is the whole archive's, not the bytes read so far",
    file: SNAPSHOT,
    from: "const refusal = this.ratioRefusal(this.inputBytes);",
    to: "const refusal = this.ratioRefusal(this.totals.streamBytes);",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-BACKSLASH",
    guard: "a backslash in a name that is not valid UTF-8 is escaped",
    file: SNAPSHOT,
    from: "byte >= 0x80 || byte === 0x5c ?",
    to: "byte >= 0x80 ?",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-GZIP-FRAMING",
    guard: "a member's header and trailer are counted as framing, not compressed data",
    file: GZIP,
    from: "    onFraming((await readHeader(reader)) + TRAILER_BYTES);\n",
    to: "    await readHeader(reader);\n",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-RATIO-FRAMING",
    guard: "the ratio's denominator is the input less its framing",
    file: SNAPSHOT,
    from: "    const compressedBytes = inputBytes - this.framingBytes;\n",
    to: "    const compressedBytes = inputBytes;\n",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-GZIP-MEMBERS",
    guard: "a gzip input may have at most 4,096 members",
    file: GZIP,
    from: "    if (members > MAX_GZIP_MEMBERS) {\n",
    to: "    if (false) {\n",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-GZIP-LEFTOVER",
    guard: "the bytes after a member's deflate data are given back and read as its trailer",
    file: GZIP,
    from: "          reader.unread(chunk.subarray(chunk.length - unused));\n",
    to: "",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-GZIP-CRC",
    guard: "a member's CRC-32 and length are checked",
    file: GZIP,
    from: "    if (trailer.readUInt32LE(0) !== crc >>> 0 || trailer.readUInt32LE(4) !== size % 2 ** 32) throw notGzip();\n",
    to: "",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-GZIP-HCRC",
    guard: "a header CRC is checked",
    file: GZIP,
    from: "    if (stored.readUInt16LE(0) !== (crc & 0xffff)) throw notGzip();\n",
    to: "",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-GZIP-TRAILING",
    guard: "bytes after the gzip data that begin with a zero byte are reported and refused",
    file: GZIP,
    from: "      trailing.bytes = true;\n",
    to: "",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-GZIP-DRAIN",
    guard: "bytes after the gzip data are read to the end before the decision",
    file: GZIP,
    from: "      while ((await reader.next()) !== null) {\n        // read to the end, so the input's size is measured whole\n      }\n",
    to: "",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-GZIP-FEED-ERROR",
    guard: "an input that fails while a member is inflated ends the read instead of hanging it",
    file: GZIP,
    from: "    feeding.catch((error: unknown) => inflate.destroy(error as Error));\n",
    to: "    feeding.catch(() => undefined);\n",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-PAX-CAP",
    guard: "a pax header over 64 KiB is refused",
    file: TAR,
    from: '        if (header.size > MAX_PAX_BYTES) throw new SnapshotRefused("malformed_input", "A pax header is oversized.");\n',
    to: "",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-ZERO-BLOCK",
    guard: "an entry after a single zero block is refused",
    file: TAR,
    from: '      if (zeroBlocks > 0) throw new SnapshotRefused("malformed_input", "Data followed an end-of-archive marker.");\n',
    to: "",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-PAX-DIGITS",
    guard: "a pax size is one to fifteen ASCII digits",
    file: TAR,
    from: "if (paxSize !== undefined && !/^[0-9]{1,15}$/.test(paxSize)) {",
    to: "if (false) {",
    suite: SNAPSHOT_SUITE,
  },
  {
    id: "M-OWN-OPTIONS",
    guard: "only a command's own declared names are options",
    file: CLI,
    from: "name && Object.hasOwn(spec.options, name) ? spec.options[name]",
    to: "name ? spec.options[name]",
    suite: CLI_SUITE,
  },
  {
    id: "M-OWN-COMMAND",
    guard: "only the command table's own names are commands, so `constructor` is unknown",
    file: CLI,
    from: "const spec = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;",
    to: "const spec = COMMANDS[command];",
    suite: CLI_SUITE,
  },
  {
    id: "M-ADD-RAW-ERROR",
    guard: "operator:add prints a refusal's sentence and no other error's text",
    file: CLI,
    from: "        if (error instanceof OperatorRefused) fail(`${error.message} Nothing was written.`);\n        throw error;",
    to: '        fail(error instanceof Error ? error.message : "The operator could not be created.");',
    suite: CLI_SUITE,
  },
  {
    id: "M-REMOVE-UNKNOWN",
    guard: "operator:remove of an unknown operator exits 1",
    file: CLI,
    from: '      if (!removeOperator(first)) fail("No such operator. Nothing was removed.");\n      process.stdout.write("Removed.\\n");',
    to: '      process.stdout.write(removeOperator(first) ? "Removed.\\n" : "No such operator.\\n");',
    suite: CLI_SUITE,
  },
  {
    id: "M-EXPORT-ID-FIRST",
    guard: "an export id that is not a run id is withheld before the retention sweep",
    file: REVIEW,
    from: '  if (!isRunId(runId)) return { status: "withheld", blockers: ["No such run."] };\n',
    to: "",
    suite: CLI_SUITE,
  },
  {
    id: "M-NAME-FIRST",
    guard: "operator:add checks the display name before the passphrase prompt",
    file: CLI,
    from: "if (problem) fail(`${problem} Nothing was written.`);",
    to: "",
    suite: CLI_SUITE,
  },
  {
    id: "M-STAGED-NAME",
    guard: "the staged file's name is short, whatever the target is called",
    file: CLI,
    from: '`.rr-local-${randomBytes(8).toString("hex")}.tmp`',
    to: '`.${target.split("/").pop()}.${randomBytes(18).toString("hex")}.tmp`',
    suite: CLI_SUITE,
  },
  {
    id: "M-STAGED-CREATED",
    guard: "a staged file is removed only if this call created it",
    file: CLI,
    from: "if (created) rmSync",
    to: "rmSync",
    suite: CLI_SUITE,
  },
  {
    id: "M-STAGED-OPEN",
    guard: "a staged file is tracked for removal as soon as it is opened, before it is written",
    file: CLI,
    // The predecessor marked it created only after the write had succeeded.
    from: "    created = true;\n    const bytes = Buffer.from(text, \"utf8\");\n    for (let offset = 0; offset < bytes.length; ) offset += writeSync(fd, bytes, offset, bytes.length - offset);\n    closeSync(fd);\n    fd = null;\n",
    to: "    const bytes = Buffer.from(text, \"utf8\");\n    for (let offset = 0; offset < bytes.length; ) offset += writeSync(fd, bytes, offset, bytes.length - offset);\n    closeSync(fd);\n    fd = null;\n    created = true;\n",
    suite: CLI_SUITE,
  },
  {
    id: "M-STAGED-CLEANUP",
    guard: "the staged file is removed when the rename fails",
    file: CLI,
    from: "if (created) rmSync(staged, { force: true });",
    to: "",
    suite: CLI_SUITE,
  },
  {
    id: "M-EXPORT-WRITE",
    guard: "an export that cannot be written is reported in one sentence and not delivered",
    file: CLI,
    from: '      } catch {\n        fail("The export file could not be written. Nothing was delivered.");\n      }',
    to: "      } finally {\n      }",
    suite: CLI_SUITE,
  },
  {
    id: "M-LAUNCHER-CATCH",
    guard: "the launcher reports an unexpected failure without a stack trace",
    file: LAUNCHER,
    from: "} catch (error) {\n  // No stack trace",
    to: "} finally {\n}\nif (false) {\n  const error = null;\n  // No stack trace",
    suite: CLI_SUITE,
  },
  {
    id: "CONTROL",
    guard: "a comment-only change fails nothing",
    file: CLI,
    from: "// The terminal half of the internal workflow.",
    to: "// The terminal half of the internal workflow (control).",
    suite: CLI_SUITE,
    control: true,
  },
];

const FILES = [...new Set(MUTANTS.map((mutant) => mutant.file))];

const dirty = spawnSync("git", ["status", "--porcelain", "--", ...FILES], { encoding: "utf8" }).stdout.trim();
if (dirty) {
  console.error(`Refusing to start: these files have uncommitted changes, and a restore would discard them:\n${dirty}`);
  process.exit(1);
}

const originals = new Map(FILES.map((file) => [file, readFileSync(file, "utf8")]));
const restore = () => {
  for (const [file, text] of originals) writeFileSync(file, text);
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    restore();
    console.error(`\ninterrupted by ${signal}; ${FILES.join(", ")} restored`);
    process.exit(130);
  });
}
process.on("uncaughtException", (error) => {
  restore();
  console.error(`\nuncaught: ${error instanceof Error ? error.message : String(error)}; files restored`);
  process.exit(1);
});

const scratch = mkdtempSync(join(tmpdir(), "rr-internal-mutation-"));

/** The full names of the tests that failed in `suite`, or null when the report is missing. */
function failingTests(suite) {
  return new Promise((done) => {
    const report = join(scratch, `report-${Math.random().toString(36).slice(2)}.json`);
    const child = spawn("npx", ["vitest", "run", suite, "--reporter=json", `--outputFile=${report}`], {
      stdio: "ignore",
      env: process.env,
    });
    child.on("close", () => {
      try {
        const parsed = JSON.parse(readFileSync(report, "utf8"));
        const failed = new Set();
        for (const file of parsed.testResults) {
          // A file that threw at import ran no assertions; count it as failed.
          if (file.status === "failed" && file.assertionResults.length === 0) failed.add(`${file.name}: failed to load`);
          for (const test of file.assertionResults) if (test.status === "failed") failed.add(test.fullName);
        }
        done(failed);
      } catch {
        done(null);
      }
    });
  });
}

const results = [];
try {
  const baseline = new Map();
  for (const suite of new Set(MUTANTS.map((mutant) => mutant.suite))) {
    const failed = await failingTests(suite);
    if (failed === null) throw new Error(`no report from ${suite}`);
    baseline.set(suite, failed);
    console.log(`baseline ${suite}: ${failed.size} failing`);
  }
  for (const mutant of MUTANTS) {
    const text = originals.get(mutant.file);
    const count = text.split(mutant.from).length - 1;
    if (count !== 1) {
      results.push({ ...mutant, verdict: "NOT APPLIED", detail: `the text to replace occurs ${count} times` });
      continue;
    }
    writeFileSync(mutant.file, text.replace(mutant.from, mutant.to));
    try {
      const failed = await failingTests(mutant.suite);
      if (failed === null) {
        results.push({ ...mutant, verdict: "NO REPORT", detail: "vitest wrote no report" });
        continue;
      }
      const newly = [...failed].filter((name) => !baseline.get(mutant.suite).has(name));
      const verdict = mutant.control ? (newly.length === 0 ? "CONTROL OK" : "CONTROL FAILED") : newly.length > 0 ? "HELD" : "SURVIVED";
      results.push({ ...mutant, verdict, detail: newly.join(" | ") || "no test failed" });
    } finally {
      writeFileSync(mutant.file, text);
    }
    const last = results[results.length - 1];
    console.log(`${last.verdict.padEnd(14)} ${mutant.id}: ${last.detail}`);
  }
} finally {
  restore();
  rmSync(scratch, { recursive: true, force: true });
}

const held = results.filter((result) => result.verdict === "HELD").length;
const mutants = results.filter((result) => !result.control).length;
const controlOk = results.some((result) => result.verdict === "CONTROL OK");
console.log(`\n${held} of ${mutants} guards held; control ${controlOk ? "changed nothing" : "FAILED"}.`);
process.exit(held === mutants && controlOk ? 0 : 1);
