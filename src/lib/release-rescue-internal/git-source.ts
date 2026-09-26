import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { commitShaSchema } from "@/lib/release-rescue-intake";
import { githubRefFromRemoteUrl } from "@/lib/release-rescue-internal/allowlist";
import {
  SnapshotBudget,
  SnapshotRefused,
  blobId,
  blockedBeforeReading,
  canonicalEntryPath,
  exactText,
  type AcquiredSnapshot,
  type AcquisitionRefusal,
  type RejectedEntry,
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
// A clone is hostile input too, including its own `.git/config`, which git
// reads and which can outrank a `-c` default: `protocol.ext.allow=always` plus
// a promisor remote whose url is `ext::<command>` makes git RUN that command
// the moment it lazily fetches a missing object. So:
//
// - every transport is refused through GIT_ALLOW_PROTOCOL, which repository
//   configuration cannot override, and lazy fetching is switched off where git
//   supports the switch;
// - before any other git command reads the repository, its local
//   configuration is checked against a short allowlist of keys a plain clone
//   carries, and a checkout with any other key, or with object alternates, is
//   refused;
// - system and global configuration are disabled, hooks and fsmonitor are
//   off, and replace objects are ignored.
//
// Nothing here writes to the checkout.

const GIT_TIMEOUT_MS = 120_000;
const MAX_LS_TREE_OUTPUT_BYTES = 16_000_000;

export function gitEnv(): NodeJS.ProcessEnv {
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
    // No transport at all. A name no transport has, because an empty value is
    // treated by some git versions as "unset".
    GIT_ALLOW_PROTOCOL: "none",
    GIT_PROTOCOL_FROM_USER: "0",
    // Honoured by git 2.44 and later; GIT_ALLOW_PROTOCOL covers older versions.
    GIT_NO_LAZY_FETCH: "1",
  };
}

export function gitArgs(checkout: string, args: string[]): string[] {
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

/**
 * The local configuration keys a plain `git clone` writes, plus a few a person
 * commonly sets. None of them makes a read-only `ls-tree` / `cat-file` run a
 * program, reach a transport, or read objects from elsewhere. Anything else
 * (`extensions.*`, `include.*`, `protocol.*`, `credential.*`, `core.*`
 * commands, any remote other than `origin`, ...) refuses the checkout.
 */
const ALLOWED_LOCAL_CONFIG: readonly RegExp[] = [
  /^core\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|autocrlf|eol|safecrlf|checkstat|trustctime)$/,
  /^remote\.origin\.(?:url|fetch|tagopt)$/,
  /^branch\.[A-Za-z0-9._/-]+\.(?:remote|merge|rebase)$/,
  /^user\.(?:name|email)$/,
  /^pull\.(?:rebase|ff)$/,
  /^init\.defaultbranch$/,
];

/** A config key as it can be shown: section and name, never a subsection's text. */
function displayKey(key: string): string {
  const first = key.indexOf(".");
  const last = key.lastIndexOf(".");
  if (first < 0) return "(malformed)";
  return first === last ? key : `${key.slice(0, first)}.<name>${key.slice(last)}`;
}

/**
 * Refuses a checkout whose own configuration or object store could change what
 * git does while it reads. Returns the refusal, or null when the checkout is a
 * plain clone.
 */
async function checkoutConfigProblem(checkout: string): Promise<string | null> {
  const listing = await runGit(checkout, ["config", "--local", "--no-includes", "--list", "--name-only", "-z"]);
  if (listing.code !== 0) return "The checkout's local configuration could not be read.";
  const keys = listing.stdout.toString("utf8").split("\0").filter((key) => key.length > 0);
  const refused = [...new Set(keys.filter((key) => !ALLOWED_LOCAL_CONFIG.some((pattern) => pattern.test(key))).map(displayKey))];
  if (refused.length > 0) {
    const shown = refused.slice(0, 5).join(", ");
    return `The checkout's local git configuration sets keys the reader does not allow: ${shown}${refused.length > 5 ? ", ..." : ""}. Use a plain clone.`;
  }
  const alternates = await runGit(checkout, ["rev-parse", "--git-path", "objects/info/alternates"]);
  const alternatesPath = resolve(checkout, alternates.stdout.toString("utf8").trim());
  if (alternates.code !== 0 || existsSync(alternatesPath)) {
    return "The checkout borrows objects from another repository (object alternates). Use a plain clone.";
  }
  return null;
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

/**
 * Parses `git ls-tree -r -t -z -l` output. Returns null on any malformed record.
 *
 * Each record is split as bytes, and its path decoded with `exactText`, so a
 * name that is not valid UTF-8 keeps its identity rather than collapsing into
 * another name's U+FFFD spelling.
 */
export function parseLsTree(output: Buffer): TreeEntry[] | null {
  const entries: TreeEntry[] = [];
  for (let start = 0; start < output.length; ) {
    let end = output.indexOf(0, start);
    if (end < 0) end = output.length;
    const record = output.subarray(start, end);
    start = end + 1;
    const tab = record.indexOf(0x09);
    if (tab < 0) return null;
    const meta = record.subarray(0, tab).toString("latin1").trim().split(/\s+/);
    const path = exactText(record.subarray(tab + 1));
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

type PinnedTree =
  | { ok: true; checkout: string; commitSha: string; entries: TreeEntry[] }
  | { ok: false; outcome: SnapshotOutcome };

/**
 * Everything before reading a blob: the sha, the path, that it is a plain clone
 * of the allowlisted repository, that the commit is there, and its tree.
 */
async function openPinnedTree(request: GitSourceRequest): Promise<PinnedTree> {
  const source = "git_objects" as const;
  const refuse = (commitSha: string | null, reason: Parameters<typeof blockedBeforeReading>[2], detail: string): PinnedTree => ({
    ok: false,
    outcome: blockedBeforeReading(source, commitSha, reason, detail),
  });
  const sha = commitShaSchema.safeParse(request.commitSha);
  if (!sha.success) return refuse(null, "commit_sha_malformed", "A full 40-character lowercase commit sha is required.");
  const commitSha = sha.data;
  if (!isAbsolute(request.checkoutPath)) return refuse(commitSha, "checkout_not_configured", "The checkout path must be absolute.");
  const checkout = resolve(request.checkoutPath);
  if (!existsSync(checkout) || !statSync(checkout).isDirectory()) {
    return refuse(commitSha, "checkout_not_configured", "The configured checkout does not exist.");
  }

  const inside = await runGit(checkout, ["rev-parse", "--is-inside-work-tree"]);
  const bare = await runGit(checkout, ["rev-parse", "--is-bare-repository"]);
  if (inside.code !== 0 && bare.code !== 0) {
    return refuse(commitSha, "checkout_not_a_git_repository", "The configured path is not a git repository.");
  }

  const configProblem = await checkoutConfigProblem(checkout);
  if (configProblem) return refuse(commitSha, "checkout_config_not_allowed", configProblem);

  // The checkout must be a clone of the allowlisted repository, so a path
  // cannot point the review at some other codebase.
  const remote = await runGit(checkout, ["config", "--local", "--get", "remote.origin.url"]);
  const remoteRef = remote.code === 0 ? githubRefFromRemoteUrl(remote.stdout.toString("utf8")) : null;
  if (!remoteRef || remoteRef.toLowerCase() !== request.repositoryRef.toLowerCase()) {
    return refuse(commitSha, "checkout_remote_mismatch", "The checkout's origin remote is not the allowlisted repository.");
  }

  const resolved = await runGit(checkout, ["rev-parse", "--verify", "--quiet", `${commitSha}^{commit}`]);
  if (resolved.code !== 0 || resolved.stdout.toString("utf8").trim() !== commitSha) {
    return refuse(commitSha, "commit_not_found", "The pinned commit is not in the local checkout.");
  }

  // `-t` lists the subtrees too, so a path's directory can be checked to be a
  // real subtree rather than part of one entry's name.
  const listing = await runGit(checkout, ["ls-tree", "-r", "-t", "-z", "-l", "--full-tree", commitSha], MAX_LS_TREE_OUTPUT_BYTES);
  if (listing.code !== 0) return refuse(commitSha, "reader_failed", "The tree of the pinned commit could not be listed.");
  const listed = parseLsTree(listing.stdout);
  if (!listed) return refuse(commitSha, "malformed_input", "The tree listing was malformed.");
  if (holdsNameGitRefuses(listed)) {
    return refuse(
      commitSha,
      "malformed_input",
      "The commit's tree holds a name git itself refuses (empty, `.`, `..`, or containing `/`).",
    );
  }
  return { ok: true, checkout, commitSha, entries: listed.filter((entry) => entry.objectType !== "tree") };
}

/**
 * Whether a tree entry has a name `git fsck` refuses: empty, `.`, `..`, or one
 * containing `/`. A hostile tree can hold one, and `ls-tree -r` prints it as
 * part of a path, so `./a.ts` would be read as `a.ts` and `x/y.ts` as a file in
 * a directory `x` that does not exist. A path's segments are checked, and its
 * directory must be one of the subtrees `-t` lists.
 *
 * Such a name is not seen when its directory part is also a real subtree: a
 * blob named `x/y.ts`, or a subtree named `x/y`, beside a subtree `x`. Each
 * path is read under the path it spells, which is what `git archive` writes.
 */
function holdsNameGitRefuses(entries: readonly TreeEntry[]): boolean {
  const subtrees = new Set(entries.filter((entry) => entry.objectType === "tree").map((entry) => entry.path));
  for (const entry of entries) {
    const segments = entry.path.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return true;
    const slash = entry.path.lastIndexOf("/");
    if (slash >= 0 && !subtrees.has(entry.path.slice(0, slash))) return true;
  }
  return false;
}

export async function readGitCommit(request: GitSourceRequest): Promise<SnapshotOutcome> {
  const source = "git_objects" as const;
  let tree: PinnedTree;
  try {
    tree = await openPinnedTree(request);
  } catch (error) {
    const refusal =
      error instanceof SnapshotRefused ? error.refusal : { reason: "reader_failed" as const, detail: "The local git reader failed." };
    return new SnapshotBudget(false).blocked(source, null, refusal);
  }
  if (!tree.ok) return tree.outcome;
  const { checkout, commitSha, entries } = tree;

  const budget = new SnapshotBudget(false);
  try {
    const wanted: TreeEntry[] = [];
    for (const entry of entries) {
      const type = entryTypeForMode(entry.mode, entry.objectType);
      const readAs = budget.admit({ path: entry.path, type, declaredBytes: entry.declaredBytes });
      if (readAs !== null) wanted.push({ ...entry, path: readAs });
    }
    await readBlobs(checkout, wanted, budget);
    return budget.finish(source, commitSha);
  } catch (error) {
    if (error instanceof SnapshotRefused) return budget.blocked(source, commitSha, error.refusal);
    return budget.blocked(source, commitSha, { reason: "reader_failed", detail: "The local git reader failed." });
  }
}


export type ArchiveVerification =
  | {
      matches: true;
      /**
       * What the pinned tree holds and the review does not read, classified as
       * the git reader classifies it. The run records this rather than the
       * archive's own list; the two differ only by submodules, which
       * `git archive` writes as directories.
       */
      treeRejected: RejectedEntry[];
      /** The pinned tree's entry and rejection counts, so the run's totals add up with `treeRejected`. */
      treeCounts: { entryCount: number; rejectedCount: number };
    }
  | { matches: false; refusal: AcquisitionRefusal };

/**
 * Whether an archive matches the pinned commit of the allowlisted clone, entry
 * by entry. Directory entries are not compared (the tar reader refuses one
 * that carries data), and paths are compared in their canonical spelling.
 *
 * An archive declares its own commit, and `git archive` applies the
 * repository's `export-ignore` and `export-subst` attributes, so neither the
 * declaration nor the content can be taken on trust. The tree of the pinned
 * commit is classified by the same budget the git reader uses, and then:
 *
 * - every file the tree's rules accept must appear in the archive exactly once,
 *   under the same canonical path, with the same git blob id;
 * - every entry the rules do not read (a symlink, a credential file, an
 *   oversized file, an illegal path) must appear once with the same path, the
 *   same reason and, for a file or a symlink, the same git blob id: its bytes,
 *   or its target, hashed as they stream past unread. So an archive cannot drop
 *   one and turn an honest BLOCKED into a PASS, or change one it knows will
 *   not be read. A submodule is the one exception: `git archive` writes it as a
 *   directory, and anything else at its path is refused;
 * - nothing else may appear, and nothing may appear twice. The reader already
 *   refuses a repeated path; this counts repeats again, so the comparison does
 *   not depend on that.
 *
 * The detail gives counts only. A path is never put in it.
 */
export async function verifyArchiveAgainstTree(
  request: GitSourceRequest,
  archive: Pick<AcquiredSnapshot, "files" | "rejected" | "blobIds">,
): Promise<ArchiveVerification> {
  const refuse = (reason: AcquisitionRefusal["reason"], detail: string): ArchiveVerification => ({
    matches: false,
    refusal: { reason, detail },
  });
  let tree: PinnedTree;
  try {
    tree = await openPinnedTree(request);
  } catch {
    return refuse("reader_failed", "The local git reader failed while checking the archive.");
  }
  if (!tree.ok) {
    const refusal = tree.outcome.status === "blocked" ? tree.outcome.refusals[0] : null;
    return refusal
      ? { matches: false, refusal }
      : refuse("reader_failed", "The pinned commit could not be opened to check the archive.");
  }

  const treeBudget = new SnapshotBudget(false);
  const expectedFiles = new Map<string, string>();
  /** Every blob in the tree, read or not, by canonical path: files and symlinks. */
  const expectedBlobs = new Map<string, string>();
  const submodules = new Set<string>();
  try {
    for (const entry of tree.entries) {
      const type = entryTypeForMode(entry.mode, entry.objectType);
      const readAs = treeBudget.admit({ path: entry.path, type, declaredBytes: entry.declaredBytes });
      if (readAs !== null) expectedFiles.set(readAs, entry.objectId);
      else if (entry.objectType === "commit") submodules.add(canonicalEntryPath(entry.path));
      if (entry.objectType === "blob") expectedBlobs.set(canonicalEntryPath(entry.path), entry.objectId);
    }
  } catch (error) {
    if (error instanceof SnapshotRefused) return { matches: false, refusal: error.refusal };
    return refuse("reader_failed", "The pinned tree could not be classified to check the archive.");
  }
  const expectedUnread = new Map(treeBudget.rejected.map((entry) => [entry.path, entry.reason]));

  let missing = 0;
  let differing = 0;
  let extra = 0;
  let repeated = 0;
  const seen = new Set<string>();

  const seenFiles = new Set<string>();
  for (const file of archive.files) {
    const path = canonicalEntryPath(file.path);
    if (seen.has(path)) {
      repeated += 1;
      continue;
    }
    seen.add(path);
    seenFiles.add(path);
    const id = expectedFiles.get(path);
    if (id === undefined) extra += 1;
    else if (blobId(file.bytes) !== id) differing += 1;
  }
  for (const path of expectedFiles.keys()) if (!seenFiles.has(path)) missing += 1;

  const seenUnread = new Set<string>();
  for (const entry of archive.rejected) {
    const path = canonicalEntryPath(entry.path);
    if (seen.has(path)) {
      repeated += 1;
      continue;
    }
    seen.add(path);
    seenUnread.add(path);
    const reason = expectedUnread.get(path);
    if (reason === undefined) extra += 1;
    // `git archive` writes a submodule as a directory, never as an entry.
    else if (reason !== entry.reason || submodules.has(path)) differing += 1;
    // Its content is not read, but it is compared: a file's bytes, a symlink's target.
    else if (expectedBlobs.has(path) && archive.blobIds?.get(path) !== expectedBlobs.get(path)) differing += 1;
  }
  for (const path of expectedUnread.keys()) {
    if (!seenUnread.has(path) && !submodules.has(path)) missing += 1;
  }

  if (missing === 0 && differing === 0 && extra === 0 && repeated === 0) {
    return {
      matches: true,
      treeRejected: treeBudget.rejected,
      treeCounts: { entryCount: treeBudget.totals.entryCount, rejectedCount: treeBudget.totals.rejectedCount },
    };
  }
  return refuse(
    "archive_commit_unverified",
    `The archive is not the pinned commit of the allowlisted clone: ${missing} of the commit's entries are missing, ${differing} differ, ${extra} are not in the commit and ${repeated} are repeated.`,
  );
}

/** The commit a checkout's branch points at, for pre-filling the pin. Read-only. */
export async function resolveCheckoutHead(checkoutPath: string, branch: string): Promise<string | null> {
  if (!isAbsolute(checkoutPath) || !existsSync(checkoutPath)) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..")) return null;
  // The same vetting as a run: this is called on every dashboard load.
  if ((await checkoutConfigProblem(resolve(checkoutPath))) !== null) return null;
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`, "HEAD"]) {
    const result = await runGit(checkoutPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    const value = result.stdout.toString("utf8").trim();
    if (result.code === 0 && /^[0-9a-f]{40}$/.test(value)) return value;
  }
  return null;
}
