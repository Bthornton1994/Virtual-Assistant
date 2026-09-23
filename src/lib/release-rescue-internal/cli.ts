import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { isAbsolute, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { RETENTION_POLICIES, type RetentionPolicy } from "@/lib/release-rescue-intake";
import { findAllowlisted, loadAllowlist } from "@/lib/release-rescue-internal/allowlist";
import { resolveCheckoutHead } from "@/lib/release-rescue-internal/git-source";
import { addOperator, loadOperators, removeOperator } from "@/lib/release-rescue-internal/local-identity";
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

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
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

const USAGE = `Release Rescue, internal local workflow

  operator:add --name "<display name>"       create the reviewer who will sign (prompts for a passphrase)
  operator:list                              list operators (names and ids only)
  operator:remove <operator id>              remove an operator; their sessions end
  checkout:set <owner/name> <absolute path>  record where an allowlisted repository's local clone is
  checkout:list                              list configured clones
  head <owner/name>                          print the commit the clone's default branch points at
  run <owner/name> --sha <40-char sha> --confirm-ownership [--retention <policy>] [--archive <file.tar.gz>] [--summary-out <file>]
                                             run a review up to the unsigned draft
  show <run id>                              print a run's sanitized summary
  export <run id> --out <file>               write the signed, delivery-gated report
  purge                                      apply retention now

Local data lives in ${"${RELEASE_RESCUE_LOCAL_DIR:-.release-rescue-local}"} and is never committed.`;

export async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  switch (command) {
    case "operator:add": {
      const name = flag(args, "name");
      if (!name) fail("operator:add needs --name.");
      const first = await readPassphrase("Passphrase (not shown): ");
      if (process.stdin.isTTY) {
        const second = await readPassphrase("Repeat passphrase: ");
        if (first !== second) fail("The passphrases did not match. Nothing was written.");
      }
      try {
        const operator = addOperator(name, first);
        process.stdout.write(`Operator created: ${operator.displayName} (${operator.operatorId})\n`);
      } catch (error) {
        fail(error instanceof Error ? error.message : "The operator could not be created.");
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
      const id = args[0];
      if (!id) fail("operator:remove needs an operator id.");
      process.stdout.write(removeOperator(id) ? "Removed.\n" : "No such operator.\n");
      return;
    }
    case "checkout:set": {
      const [ref, path] = args;
      if (!ref || !path) fail("checkout:set needs <owner/name> <absolute path>.");
      const entry = findAllowlisted(loadAllowlist(), ref);
      if (!entry) fail("That repository is not on the internal allowlist.");
      if (!isAbsolute(path)) fail("The checkout path must be absolute.");
      saveCheckout(entry.repositoryRef, resolve(path));
      process.stdout.write(`Checkout for ${entry.repositoryRef}: ${resolve(path)}\n`);
      return;
    }
    case "checkout:list": {
      for (const [ref, path] of Object.entries(loadCheckouts())) process.stdout.write(`${ref}  ${path}\n`);
      return;
    }
    case "head": {
      const entry = findAllowlisted(loadAllowlist(), args[0] ?? "");
      if (!entry) fail("That repository is not on the internal allowlist.");
      const checkout = checkoutFor(entry.repositoryRef);
      if (!checkout) fail("No checkout is configured for that repository.");
      const sha = await resolveCheckoutHead(checkout, entry.defaultBranch);
      if (!sha) fail("The clone's default branch could not be resolved.");
      process.stdout.write(`${sha}\n`);
      return;
    }
    case "run": {
      const ref = args[0];
      const sha = flag(args, "sha");
      if (!ref || !sha) fail("run needs <owner/name> --sha <40-character commit>.");
      const retention = (flag(args, "retention") ?? "minimum_7_day") as RetentionPolicy;
      if (!(RETENTION_POLICIES as readonly string[]).includes(retention)) fail("Unknown retention policy.");
      const archive = flag(args, "archive");
      try {
        const record = await startInternalRun({
          initiatedBy: CLI_INITIATOR,
          repositoryRef: ref,
          commitSha: sha,
          retentionPolicy: retention,
          ownershipConfirmed: has(args, "confirm-ownership"),
          source: archive ? { kind: "archive", path: resolve(archive) } : { kind: "checkout" },
        });
        const summary = runSummary(record);
        const out = flag(args, "summary-out");
        if (out) writeFileSync(resolve(out), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        process.stdout.write(
          record.status === "awaiting_review"
            ? `\nDraft ready and awaiting a named reviewer. Sign it in the app: /internal/release-rescue/runs/${record.runId}\n`
            : `\nRun BLOCKED. Nothing was analysed and no report exists.\n`,
        );
      } catch (error) {
        if (error instanceof RunRefused) fail(`Refused (${error.reason}): ${error.message}`);
        throw error;
      }
      return;
    }
    case "show": {
      const record = loadRun(args[0] ?? "");
      if (!record) fail("No such run.");
      process.stdout.write(`${JSON.stringify(runSummary(record), null, 2)}\n`);
      return;
    }
    case "export": {
      const runId = args[0] ?? "";
      const out = flag(args, "out");
      if (!out) fail("export needs --out <file>.");
      const outcome = deliveryForRun(runId);
      if (outcome.status !== "deliverable") fail(`Withheld: ${outcome.blockers.join("; ")}`);
      const { view, contentHash, reviewer, checks } = outcome.decision;
      writeFileSync(resolve(out), `${JSON.stringify({ contentHash, reviewer, checks, report: view }, null, 2)}\n`, {
        mode: 0o600,
      });
      recordDelivery(runId);
      process.stdout.write(`Exported to ${resolve(out)}\n`);
      return;
    }
    case "purge": {
      const purged = sweepRetention();
      process.stdout.write(`Purged ${purged.length} run(s).\n`);
      return;
    }
    default:
      process.stdout.write(`${USAGE}\n\nLocal directory: ${localDir()}\n`);
  }
}
