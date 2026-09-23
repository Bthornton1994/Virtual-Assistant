import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { commitShaSchema } from "@/lib/release-rescue-intake";
import { githubRefFromRemoteUrl } from "@/lib/release-rescue-internal/allowlist";
import {
  SnapshotBudget,
  SnapshotRefused,
  blockedBeforeReading,
  type SnapshotOutcome,
} from "@/lib/release-rescue-internal/snapshot";
import type { SnapshotEntryType } from "@/lib/release-rescue-snapshot-limits";

// Reads one commit of a LOCAL git checkout, read-only, straight from its object
// database.
//
// Not `git archive` and not the working tree, deliberately:
//
// - The working tree is whatever is on disk now, with local edits and symlinks
//   that point anywhere. A review has to be of a commit, so this reads objects
//   by the pinned sha and never opens a working-tree file.
// - `git archive` applies the repository's own `.gitattributes`, so a hostile
//   repository could mark files `export-ignore` and hide them from the review,
//   or `export-subst` and rewrite them. `ls-tree` and `cat-file --batch` return
//   the tree and the blobs exactly as committed, with no attribute or filter
//   applied.
//
// Git runs with system and global configuration disabled, hooks and fsmonitor
// off, replace objects ignored, and every transport protocol refused, so a
// partial clone cannot reach the network to fetch a missing object. Nothing
// here writes to the checkout.

const GIT_TIMEOUT_MS = 120_000;
const MAX_LS_TREE_OUTPUT_BYTES = 16_000_000;

function gitEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

function gitArgs(checkout: string, args: string[]): string[] {
  return [
    "-c", "core.fsmonitor=false",
    "-c", "core.hooksPath=/dev/null",
    "-c", "protocol.allow=never",
    "-c", "core.quotePath=false",
    "-C", checkout,
    ...args,
  ];
}

/** Runs git and returns stdout, refusing output larger than `maxBytes`. */
function runGit(checkout: string, args: string[], maxBytes = 1_000_000): Promise<{ code: number; stdout: Buffer }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", gitArgs(checkout, args), { env: gitEnv(), stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), GIT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        child.kill("SIGKILL");
        reject(new SnapshotRefused("too_many_files", "The tree listing is larger than the review reads."));
        return;
      }
      chunks.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout: Buffer.concat(chunks) });
    });
  });
}

export type GitSourceRequest = {
  /** Absolute path of an existing local clone. */
  checkoutPath: string;
  /** The allowlisted `owner/name` this checkout must be a clone of. */
  repositoryRef: string;
  /** The full 40-character commit to read. */
  commitSha: string;
};

type TreeEntry = { mode: string; objectType: string; objectId: string; declaredBytes: number; path: string };

/** Parses `git ls-tree -r -z -l` output. Returns null on any malformed record. */
export function parseLsTree(output: Buffer): TreeEntry[] | null {
  const entries: TreeEntry[] = [];
  const text = output.toString("utf8");
  if (text.length === 0) return entries;
  const records = text.split("\0");
  if (records[records.length - 1] === "") records.pop();
  for (const record of records) {
    const tab = record.indexOf("\t");
    if (tab < 0) return null;
    const meta = record.slice(0, tab).trim().split(/\s+/);
    const path = record.slice(tab + 1);
    if (meta.length !== 4) return null;
    const [mode, objectType, objectId, sizeField] = meta;
    if (!/^[0-7]{6}$/.test(mode) || !/^[0-9a-f]{40}$/.test(objectId)) return null;
    const declaredBytes = sizeField === "-" ? 0 : Number(sizeField);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) return null;
    entries.push({ mode, objectType, objectId, declaredBytes, path });
  }
  return entries;
}

/** What the snapshot rules call an entry of this git mode. */
export function entryTypeForMode(mode: string, objectType: string): SnapshotEntryType {
  if (objectType === "blob" && (mode === "100644" || mode === "100755")) return "file";
  if (objectType === "blob" && mode === "120000") return "symlink";
  // 160000 is a submodule: another repository, which this review does not read.
  return "other";
}

/**
 * Reads the admitted blobs through one `git cat-file --batch`, counting every
 * byte that arrives and stopping the process the moment a limit is crossed.
 */
function readBlobs(
  checkout: string,
  wanted: TreeEntry[],
  budget: SnapshotBudget,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (wanted.length === 0) {
      resolvePromise();
      return;
    }
    const child = spawn("git", gitArgs(checkout, ["cat-file", "--batch"]), {
      env: gitEnv(),
      stdio: ["pipe", "pipe", "ignore"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), GIT_TIMEOUT_MS);
    let buffered: Buffer = Buffer.alloc(0);
    let index = 0;
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(error);
    };

    const drain = () => {
      while (index < wanted.length) {
        const newline = buffered.indexOf(0x0a);
        if (newline < 0) return;
        const header = buffered.subarray(0, newline).toString("utf8");
        const entry = wanted[index];
        const match = /^([0-9a-f]{40}) (\S+) (\d+)$/.exec(header);
        if (!match || match[1] !== entry.objectId || match[2] !== "blob") {
          throw new SnapshotRefused("malformed_input", "The object database returned an unexpected record.");
        }
        const size = Number(match[3]);
        if (size !== entry.declaredBytes) {
          throw new SnapshotRefused(
            "declared_size_mismatch",
            `The tree declared ${entry.declaredBytes} bytes for an object that holds ${size}.`,
          );
        }
        const needed = newline + 1 + size + 1;
        if (buffered.length < needed) return;
        const bytes = Buffer.from(buffered.subarray(newline + 1, newline + 1 + size));
        if (buffered[newline + 1 + size] !== 0x0a) {
          throw new SnapshotRefused("malformed_input", "An object record was not terminated.");
        }
        budget.accept(entry.path, entry.declaredBytes, bytes);
        buffered = buffered.subarray(needed);
        index += 1;
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      try {
        budget.countStream(chunk.length);
        buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
        drain();
        if (index === wanted.length && !child.stdin.writableEnded) child.stdin.end();
      } catch (error) {
        fail(error);
      }
    });
    child.on("error", fail);
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (index !== wanted.length) {
        reject(new SnapshotRefused("malformed_input", "The object database stopped before every admitted file was read."));
        return;
      }
      resolvePromise();
    });
    child.stdin.on("error", () => undefined);
    child.stdin.write(wanted.map((entry) => `${entry.objectId}\n`).join(""));
  });
}

export async function readGitCommit(request: GitSourceRequest): Promise<SnapshotOutcome> {
  const source = "git_objects" as const;
  const sha = commitShaSchema.safeParse(request.commitSha);
  if (!sha.success) {
    return blockedBeforeReading(source, null, "commit_sha_malformed", "A full 40-character lowercase commit sha is required.");
  }
  const commitSha = sha.data;
  if (!isAbsolute(request.checkoutPath)) {
    return blockedBeforeReading(source, commitSha, "checkout_not_configured", "The checkout path must be absolute.");
  }
  const checkout = resolve(request.checkoutPath);
  if (!existsSync(checkout) || !statSync(checkout).isDirectory()) {
    return blockedBeforeReading(source, commitSha, "checkout_not_configured", "The configured checkout does not exist.");
  }

  const budget = new SnapshotBudget(false);
  try {
    const inside = await runGit(checkout, ["rev-parse", "--is-inside-work-tree"]);
    const bare = await runGit(checkout, ["rev-parse", "--is-bare-repository"]);
    if (inside.code !== 0 && bare.code !== 0) {
      return blockedBeforeReading(source, commitSha, "checkout_not_a_git_repository", "The configured path is not a git repository.");
    }

    // The checkout must be a clone of the allowlisted repository, so a path
    // cannot point the review at some other codebase.
    const remote = await runGit(checkout, ["config", "--local", "--get", "remote.origin.url"]);
    const remoteRef = remote.code === 0 ? githubRefFromRemoteUrl(remote.stdout.toString("utf8")) : null;
    if (!remoteRef || remoteRef.toLowerCase() !== request.repositoryRef.toLowerCase()) {
      return blockedBeforeReading(
        source,
        commitSha,
        "checkout_remote_mismatch",
        "The checkout's origin remote is not the allowlisted repository.",
      );
    }

    const resolved = await runGit(checkout, ["rev-parse", "--verify", "--quiet", `${commitSha}^{commit}`]);
    if (resolved.code !== 0 || resolved.stdout.toString("utf8").trim() !== commitSha) {
      return blockedBeforeReading(source, commitSha, "commit_not_found", "The pinned commit is not in the local checkout.");
    }

    const listing = await runGit(
      checkout,
      ["ls-tree", "-r", "-z", "-l", "--full-tree", commitSha],
      MAX_LS_TREE_OUTPUT_BYTES,
    );
    if (listing.code !== 0) {
      return blockedBeforeReading(source, commitSha, "reader_failed", "The tree of the pinned commit could not be listed.");
    }
    const entries = parseLsTree(listing.stdout);
    if (!entries) {
      return blockedBeforeReading(source, commitSha, "malformed_input", "The tree listing was malformed.");
    }

    const wanted: TreeEntry[] = [];
    for (const entry of entries) {
      const type = entryTypeForMode(entry.mode, entry.objectType);
      if (budget.admit({ path: entry.path, type, declaredBytes: entry.declaredBytes })) wanted.push(entry);
    }
    await readBlobs(checkout, wanted, budget);
    return budget.finish(source, commitSha);
  } catch (error) {
    if (error instanceof SnapshotRefused) return budget.blocked(source, commitSha, error.refusal);
    return budget.blocked(source, commitSha, { reason: "reader_failed", detail: "The local git reader failed." });
  }
}

/** The commit a checkout's branch points at, for pre-filling the pin. Read-only. */
export async function resolveCheckoutHead(checkoutPath: string, branch: string): Promise<string | null> {
  if (!isAbsolute(checkoutPath) || !existsSync(checkoutPath)) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..")) return null;
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`, "HEAD"]) {
    const result = await runGit(checkoutPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    const value = result.stdout.toString("utf8").trim();
    if (result.code === 0 && /^[0-9a-f]{40}$/.test(value)) return value;
  }
  return null;
}
