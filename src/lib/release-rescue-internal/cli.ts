import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { closeSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { RETENTION_POLICIES, commitShaSchema, type RetentionPolicy } from "@/lib/release-rescue-intake";
import { findAllowlisted, loadAllowlist } from "@/lib/release-rescue-internal/allowlist";
import { resolveCheckoutHead } from "@/lib/release-rescue-internal/git-source";
import { OperatorRefused, addOperator, displayNameProblem, loadOperators, removeOperator } from "@/lib/release-rescue-internal/local-identity";
import { deliveryForRun, recordDelivery } from "@/lib/release-rescue-internal/review";
import { CLI_INITIATOR, RunRefused, startInternalRun } from "@/lib/release-rescue-internal/run";
import { runSummary } from "@/lib/release-rescue-internal/summary";
import {
  checkoutFor,
  loadCheckouts,
  loadRun,
  localDir,
  saveCheckout,
  sweepRetention,
} from "@/lib/release-rescue-internal/store";

// The terminal half of the internal workflow. Run it through
// `npm run rr:local -- <command>`; see docs/RELEASE-RESCUE-INTERNAL.md.
//
// Two things are deliberately terminal-only:
//
// - Creating an operator. The passphrase is read from the terminal without
//   echo, or from standard input when it is piped, and never from an argument,
//   an environment variable, or a web page.
// - Configuring where a repository's local clone is.
//
// Signing is deliberately NOT here. A report is signed in the app, by a
// signed-in operator, after reading the report the app shows.
//
// Output is summaries: counts, codes, hashes, paths and line numbers. No
// command prints file content.

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

// Each command's arguments, declared once. The usage text is built from these,
// and `parseArguments` checks an invocation against them in full before the
// command does anything, so a mistyped invocation is refused rather than run
// as something else:
//
// - an option the command does not take, a misspelled one included, is refused;
// - an option given twice is refused, rather than one copy winning;
// - `--flag=value` is refused, because nothing else here reads that form;
// - an option that takes a value needs one: not missing, not empty, and not
//   the next option (a value may not begin with `-`; write `./-x` for a file
//   called `-x`, and ` -Ann` for a display name, which is trimmed);
// - the number of plain arguments must be exact.
//
// Only a command's own declared names count: `--constructor` or `--__proto__`
// is an unknown option, not a property every object inherits.

type OptionKind = "value" | "switch";

type CommandSpec = {
  usage: string;
  summary: string;
  arguments: number;
  options: Record<string, OptionKind>;
  required?: string[];
};

const COMMANDS: Record<string, CommandSpec> = {
  "operator:add": {
    usage: 'operator:add --name "<display name>"',
    summary: "create the reviewer who will sign (prompts for a passphrase)",
    arguments: 0,
    options: { name: "value" },
    required: ["name"],
  },
  "operator:list": { usage: "operator:list", summary: "list operators (names and ids only)", arguments: 0, options: {} },
  "operator:remove": {
    usage: "operator:remove <operator id>",
    summary: "remove an operator; their sessions end",
    arguments: 1,
    options: {},
  },
  "checkout:set": {
    usage: "checkout:set <owner/name> <absolute path>",
    summary: "record where an allowlisted repository's local clone is",
    arguments: 2,
    options: {},
  },
  "checkout:list": { usage: "checkout:list", summary: "list configured clones", arguments: 0, options: {} },
  head: {
    usage: "head <owner/name>",
    summary: "print the commit the clone's default branch points at",
    arguments: 1,
    options: {},
  },
  run: {
    usage:
      "run <owner/name> --sha <40-char sha> --confirm-ownership [--retention <policy>] [--archive <file.tar|file.tar.gz>] [--summary-out <file>]",
    summary: "run a review up to the unsigned draft",
    arguments: 1,
    options: { sha: "value", "confirm-ownership": "switch", retention: "value", archive: "value", "summary-out": "value" },
    required: ["sha"],
  },
  show: { usage: "show <run id>", summary: "print a run's sanitized summary", arguments: 1, options: {} },
  export: {
    usage: "export <run id> --out <file>",
    summary: "write the signed, delivery-gated report",
    arguments: 1,
    options: { out: "value" },
    required: ["out"],
  },
  purge: { usage: "purge", summary: "apply retention now", arguments: 0, options: {} },
};

type ParsedArguments = { arguments: string[]; values: Record<string, string>; switches: Set<string> };

function refuse(message: string): never {
  fail(`${message} Nothing was run.`);
}

function countOf(count: number): string {
  return count === 0 ? "no arguments" : count === 1 ? "1 argument" : `${count} arguments`;
}

function parseArguments(command: string, spec: CommandSpec, args: string[]): ParsedArguments {
  const parsed: ParsedArguments = { arguments: [], values: Object.create(null) as Record<string, string>, switches: new Set() };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("-")) {
      parsed.arguments.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const spelled = equals < 0 ? token : token.slice(0, equals);
    const name = spelled.startsWith("--") ? spelled.slice(2) : "";
    const kind = name && Object.hasOwn(spec.options, name) ? spec.options[name] : undefined;
    if (kind === undefined) refuse(`Unknown option ${spelled} for ${command}.`);
    if (equals >= 0) {
      refuse(kind === "value" ? `Write --${name} <value>, not --${name}=<value>.` : `Write --${name}, not --${name}=<value>.`);
    }
    if (seen.has(name)) refuse(`--${name} was given more than once.`);
    seen.add(name);
    if (kind === "switch") {
      parsed.switches.add(name);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value === "" || value.startsWith("-")) refuse(`--${name} needs a value.`);
    parsed.values[name] = value;
    index += 1;
  }
  if (parsed.arguments.length !== spec.arguments) refuse(`${command} takes ${countOf(spec.arguments)}: ${spec.usage}.`);
  for (const name of spec.required ?? []) {
    if (parsed.values[name] === undefined && !parsed.switches.has(name)) refuse(`${command} needs --${name}.`);
  }
  return parsed;
}

/**
 * Writes `text` to `path` owner-only. The text goes to a new file beside the
 * target, created 0600, which is then renamed over it. So an existing file's
 * wider permissions are not kept, and a symlink at the path is replaced rather
 * than written through.
 *
 * The staged name is a fixed 30 characters, whatever the target is called, so
 * any name the directory accepts can be written. It is removed on failure only
 * if this call created it, and this call has created it as soon as the
 * exclusive open succeeds: a write that fails partway (a full disk, a file
 * size limit) leaves no partial copy behind, and the target is untouched.
 */
function writeOwnerOnly(path: string, text: string): void {
  const target = resolve(path);
  const staged = join(dirname(target), `.rr-local-${randomBytes(8).toString("hex")}.tmp`);
  let created = false;
  let fd: number | null = null;
  try {
    fd = openSync(staged, "wx", 0o600);
    created = true;
    const bytes = Buffer.from(text, "utf8");
    for (let offset = 0; offset < bytes.length; ) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    closeSync(fd);
    fd = null;
    renameSync(staged, target);
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Already failing; the removal below is what matters.
      }
    }
    if (created) rmSync(staged, { force: true });
    throw error;
  }
}

async function readPassphrase(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // Piped: read one line. Used by tests and by an operator who pipes from a
    // password manager.
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0];
  }
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  process.stdout.write(prompt);
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  const answer = await new Promise<string>((done) => rl.question("", done));
  rl.close();
  process.stdout.write("\n");
  return answer;
}

function usage(): string {
  const lines = Object.values(COMMANDS).map((spec) =>
    spec.usage.length < 43 ? `  ${spec.usage.padEnd(43)}${spec.summary}` : `  ${spec.usage}\n  ${"".padEnd(43)}${spec.summary}`,
  );
  return `Release Rescue, internal local workflow

${lines.join("\n")}

Exit status: 0 when the command did what it says (for run, a draft is awaiting a
reviewer); 1 when it was refused or failed, and for run when the summary file
could not be written, BLOCKED or not; 2 when run saved the run as BLOCKED.

A value may not begin with "-". Write ./-x for a file called -x, and
--name " -Ann" for a display name that begins with one: names are trimmed.

Local data lives in ${"${RELEASE_RESCUE_LOCAL_DIR:-.release-rescue-local}"} and is never committed.`;
}

export async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  if (command === undefined || command === "help" || command === "--help") {
    process.stdout.write(`${usage()}\n\nLocal directory: ${localDir()}\n`);
    return;
  }
  const spec = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (!spec) fail(`Unknown command ${command}. Run with no arguments for usage.`);
  const parsed = parseArguments(command, spec, args);
  const [first, second] = parsed.arguments;

  switch (command) {
    case "operator:add": {
      const name = parsed.values.name;
      // Checked before the prompt, so a name that will be refused does not cost
      // the operator a passphrase first. `addOperator` checks it again.
      const problem = displayNameProblem(name);
      if (problem) fail(`${problem} Nothing was written.`);
      const passphrase = await readPassphrase("Passphrase (not shown): ");
      if (process.stdin.isTTY) {
        const repeated = await readPassphrase("Repeat passphrase: ");
        if (passphrase !== repeated) fail("The passphrases did not match. Nothing was written.");
      }
      try {
        const operator = addOperator(name, passphrase);
        process.stdout.write(`Operator created: ${operator.displayName} (${operator.operatorId})\n`);
      } catch (error) {
        // Only a refusal's fixed sentence is printed. Anything else (a registry
        // that cannot be read or parsed) goes to the launcher, which prints one
        // sentence and at most a system error code, never the error's text.
        if (error instanceof OperatorRefused) fail(`${error.message} Nothing was written.`);
        throw error;
      }
      return;
    }
    case "operator:list": {
      for (const operator of loadOperators()) {
        process.stdout.write(`${operator.operatorId}  ${operator.displayName}  ${operator.role}  ${operator.createdAt}\n`);
      }
      return;
    }
    case "operator:remove": {
      // An id that names no operator is a failure, as `show` treats a run id
      // that names no run, so a script is not told it removed someone.
      if (!removeOperator(first)) fail("No such operator. Nothing was removed.");
      process.stdout.write("Removed.\n");
      return;
    }
    case "checkout:set": {
      const entry = findAllowlisted(loadAllowlist(), first);
      if (!entry) fail("That repository is not on the internal allowlist.");
      if (!isAbsolute(second)) fail("The checkout path must be absolute.");
      saveCheckout(entry.repositoryRef, resolve(second));
      process.stdout.write(`Checkout for ${entry.repositoryRef}: ${resolve(second)}\n`);
      return;
    }
    case "checkout:list": {
      for (const [ref, path] of Object.entries(loadCheckouts())) process.stdout.write(`${ref}  ${path}\n`);
      return;
    }
    case "head": {
      const entry = findAllowlisted(loadAllowlist(), first);
      if (!entry) fail("That repository is not on the internal allowlist.");
      const checkout = checkoutFor(entry.repositoryRef);
      if (!checkout) fail("No checkout is configured for that repository.");
      const sha = await resolveCheckoutHead(checkout, entry.defaultBranch);
      if (!sha) fail("The clone's default branch could not be resolved.");
      process.stdout.write(`${sha}\n`);
      return;
    }
    case "run": {
      const sha = commitShaSchema.safeParse(parsed.values.sha);
      if (!sha.success) refuse("--sha must be a full 40-character lowercase commit sha.");
      const retention = parsed.values.retention ?? "minimum_7_day";
      if (!(RETENTION_POLICIES as readonly string[]).includes(retention)) {
        refuse(`Unknown retention policy: use one of ${RETENTION_POLICIES.join(", ")}.`);
      }
      const archive = parsed.values.archive;
      const out = parsed.values["summary-out"];
      try {
        const record = await startInternalRun({
          initiatedBy: CLI_INITIATOR,
          repositoryRef: first,
          commitSha: sha.data,
          retentionPolicy: retention as RetentionPolicy,
          ownershipConfirmed: parsed.switches.has("confirm-ownership"),
          source: archive ? { kind: "archive", path: resolve(archive) } : { kind: "checkout" },
        });
        const summary = runSummary(record);
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        process.stdout.write(
          record.status === "awaiting_review"
            ? `\nDraft ready and awaiting a named reviewer. Sign it in the app: /internal/release-rescue/runs/${record.runId}\n`
            : `\nRun BLOCKED. ${
                record.processingFailure?.message ??
                "The source was not acquired (see the refusal above), so nothing was analysed and no report exists."
              }\n`,
        );
        // A BLOCKED run is saved and reported, but it is not a draft, so a
        // script that checks the exit status is not told it succeeded.
        if (record.status !== "awaiting_review") process.exitCode = 2;
        // Written after the run is reported, so a bad path cannot hide the run id.
        if (out) {
          try {
            writeOwnerOnly(out, `${JSON.stringify(summary, null, 2)}\n`);
          } catch {
            process.stderr.write(`The summary file could not be written. The run is saved as ${record.runId}.\n`);
            process.exitCode = 1;
          }
        }
      } catch (error) {
        if (error instanceof RunRefused) fail(`Refused (${error.reason}): ${error.message}`);
        throw error;
      }
      return;
    }
    case "show": {
      const record = loadRun(first);
      if (!record) fail("No such run.");
      process.stdout.write(`${JSON.stringify(runSummary(record), null, 2)}\n`);
      return;
    }
    case "export": {
      const outcome = deliveryForRun(first);
      if (outcome.status !== "deliverable") fail(`Withheld: ${outcome.blockers.join("; ")}`);
      const { view, contentHash, reviewer, checks } = outcome.decision;
      try {
        writeOwnerOnly(parsed.values.out, `${JSON.stringify({ contentHash, reviewer, checks, report: view }, null, 2)}\n`);
      } catch {
        fail("The export file could not be written. Nothing was delivered.");
      }
      recordDelivery(first);
      process.stdout.write(`Exported to ${resolve(parsed.values.out)}\n`);
      return;
    }
    case "purge": {
      const purged = sweepRetention();
      process.stdout.write(`Purged ${purged.length} run(s).\n`);
      return;
    }
  }
}
