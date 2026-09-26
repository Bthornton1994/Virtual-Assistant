import { createHash } from "node:crypto";
import {
  SNAPSHOT_LIMITS,
  SNAPSHOT_LIMITS_VERSION,
  evaluateSnapshot,
  evaluateSnapshotEntry,
  type EntryRejectionReason,
  type SnapshotEntryType,
} from "@/lib/release-rescue-snapshot-limits";

// The in-memory snapshot the internal workflow reads, and the accounting that
// enforces the documented limits against the bytes ACTUALLY read.
//
// `release-rescue-snapshot-limits.ts` decides from declared metadata and says
// so: "this function bounds the claim, the extractor bounds the reality". This
// is the reality half. Every reader streams bytes through a `SnapshotBudget`,
// which counts what arrived rather than what an index claimed, stops the moment
// a limit is crossed, and then hands the measured sizes to the same
// `evaluateSnapshot` the claim half uses, so the entry and whole-snapshot rules
// are one rule for both. The expansion ratio is the exception: here it is the
// whole archive's, over its compressed data rather than its gzip framing, with
// a floor (`MEASURED_RATIO_FLOOR_BYTES`), which the claim half's rule is not.
//
// `limitsVersion` on every outcome is `SNAPSHOT_LIMITS_VERSION`, the shared
// contract the SQL schema stores: the `SNAPSHOT_LIMITS` values and the
// `evaluateSnapshot` rules, both unchanged. It does not name how this reader
// measures the ratio, and a record does not say which ratio rule it was read
// under.
//
// Source lives in memory only, for the length of one run. Nothing here writes a
// file, and nothing here returns bytes to a caller that persists them.

export type SnapshotSourceKind = "git_objects" | "tar_archive";

export const ACQUISITION_REFUSAL_REASONS = [
  "repository_not_allowlisted",
  "checkout_not_configured",
  "checkout_not_a_git_repository",
  "checkout_remote_mismatch",
  "checkout_config_not_allowed",
  "commit_sha_malformed",
  "commit_not_found",
  "archive_commit_unverified",
  "duplicate_entry_path",
  "malformed_input",
  "declared_size_mismatch",
  "too_many_files",
  "snapshot_too_large",
  "archive_too_large",
  "expansion_ratio_exceeded",
  "empty_snapshot",
  "reader_failed",
] as const;
export type AcquisitionRefusalReason = (typeof ACQUISITION_REFUSAL_REASONS)[number];

export type AcquisitionRefusal = { reason: AcquisitionRefusalReason; detail: string };

export type SnapshotFile = { path: string; bytes: Buffer };

export type RejectedEntry = { path: string; reason: EntryRejectionReason; detail: string };

export type MeasuredTotals = {
  entryCount: number;
  acceptedFileCount: number;
  rejectedCount: number;
  /** Bytes actually received from the reader, before any decompression. */
  streamBytes: number;
  /** Bytes actually produced once decompressed. Equal to `streamBytes` for an uncompressed source. */
  expandedBytes: number;
  /** Bytes of accepted file content actually read. */
  acceptedBytes: number;
};

export type AcquiredSnapshot = {
  status: "acquired";
  source: SnapshotSourceKind;
  commitSha: string;
  limitsVersion: typeof SNAPSHOT_LIMITS_VERSION;
  files: SnapshotFile[];
  rejected: RejectedEntry[];
  totals: MeasuredTotals;
  /**
   * The git blob id of every file and symlink the source carried, read or not,
   * by canonical path: a file's content, a symlink's target. Set by the tar
   * reader, so an archive can be compared with the pinned tree entry by entry.
   */
  blobIds?: ReadonlyMap<string, string>;
};

export type BlockedSnapshot = {
  status: "blocked";
  source: SnapshotSourceKind;
  commitSha: string | null;
  limitsVersion: typeof SNAPSHOT_LIMITS_VERSION;
  refusals: AcquisitionRefusal[];
  totals: MeasuredTotals;
};

export type SnapshotOutcome = AcquiredSnapshot | BlockedSnapshot;

/** Thrown inside a reader to stop it at once; converted to a blocked outcome. */
export class SnapshotRefused extends Error {
  readonly refusal: AcquisitionRefusal;
  constructor(reason: AcquisitionRefusalReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.refusal = { reason, detail };
  }
}

/**
 * The one spelling of an entry's path that every rule and every comparison
 * keys on.
 *
 * A tar archive can spell one path several ways (`./a.ts`, `a.ts/`,
 * `src//a.ts`, `src/./a.ts`), and a hostile git tree can carry a name that
 * prints like another path. Empty and `.` segments name nothing, so they are
 * dropped. `..` is kept, and an absolute or drive-qualified path is returned
 * unchanged, so the entry rules still refuse it: `C:/.` must not become `C:`.
 */
export function canonicalEntryPath(path: string): string {
  if (path.startsWith("/") || /^[A-Za-z]:(?:[/\\]|$)/.test(path)) return path;
  return path
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * A name's bytes as text, exactly: two different byte strings never give the
 * same text.
 *
 * A lossy decode turns every invalid byte into U+FFFD, so `k\xff.ts` and
 * `k\xfe.ts` were one path, and an archive could rename a committed file to
 * other bytes and still match it. Valid UTF-8 is decoded as it is (a byte-order
 * mark included). Anything else is written byte by byte, with every byte from
 * 0x80 up as `\xHH`. A backslash is written as `\x5c` in both, so an escape
 * can only come from here. Every such name holds a backslash, which the entry
 * rules refuse, so its content is recorded as not read.
 */
export function exactText(bytes: Uint8Array): string {
  let text: string | null;
  try {
    text = STRICT_UTF8.decode(bytes);
  } catch {
    text = null;
  }
  if (text !== null) return text.includes("\\") ? text.replaceAll("\\", "\\x5c") : text;
  let escaped = "";
  for (const byte of bytes) {
    escaped += byte >= 0x80 || byte === 0x5c ? `\\x${byte.toString(16).padStart(2, "0")}` : String.fromCharCode(byte);
  }
  return escaped;
}

/** Git's own object id for a blob with these bytes. */
export function blobId(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/**
 * The ancestors of a canonical path that could be a file the review reads:
 * `a/b/c` gives `a` and `a/b`.
 *
 * A file that is read is at most `maxPathLength` characters and
 * `maxPathDepth` segments, so only the first `maxPathDepth` ancestors, of at
 * most `maxPathLength` characters, can be one. None beyond them is built. They
 * are found in one pass and sliced from the path, so a hostile 64 KB path costs
 * at most `maxPathDepth` short strings, not every prefix of itself.
 */
export function readableAncestorsOf(canonical: string): string[] {
  const ancestors: string[] = [];
  let slash = canonical.indexOf("/");
  while (slash !== -1 && slash <= SNAPSHOT_LIMITS.maxPathLength && ancestors.length < SNAPSHOT_LIMITS.maxPathDepth) {
    if (slash > 0) ancestors.push(canonical.slice(0, slash));
    slash = canonical.indexOf("/", slash + 1);
  }
  return ancestors;
}

export function emptyTotals(): MeasuredTotals {
  return {
    entryCount: 0,
    acceptedFileCount: 0,
    rejectedCount: 0,
    streamBytes: 0,
    expandedBytes: 0,
    acceptedBytes: 0,
  };
}

/**
 * Below this many expanded bytes the expansion ratio is not applied.
 *
 * Tar framing alone compresses far past the ratio: every entry takes a 512-byte
 * header and pads its data to 512 bytes, and `git archive` pads the whole
 * archive to 10 KiB. So a small repository, or one of many small files,
 * expands 12x to 80x without being a bomb. Sixteen MiB is harmless to expand
 * and covers that framing for `maxFileCount` small files with short paths
 * (about 5 MB). It does not cover every shape at that count: 5,000 files each
 * in its own directory, with paths long enough to need pax records, is about
 * 18 MB of framing at nearly 30x and is refused, and has to be supplied as a
 * plain `.tar`. Both are pinned by a test. The absolute limits,
 * `maxArchiveBytes` and `maxTotalBytes`, still apply at every size.
 */
export const MEASURED_RATIO_FLOOR_BYTES = 16 * 1024 * 1024;

/**
 * Enforces the snapshot limits on measured bytes, as they arrive.
 *
 * `compressed` says whether `streamBytes` and `expandedBytes` differ. For a
 * compressed source the expansion ratio is the whole archive's: expanded bytes
 * over its compressed data, which is the input's total size less the gzip
 * framing (`countFraming`), refused only past `MEASURED_RATIO_FLOOR_BYTES`.
 *
 * When the input's size is known before reading (`inputBytes`, a file's size),
 * the reader stops as soon as the bytes produced pass the threshold. Expanded
 * bytes only grow and framing only grows, so the threshold only falls, and
 * stopping early is the decision the finished archive would get anyway: it
 * does not depend on the order of the entries or on how the input is split
 * into reads. A bomb whose framing comes first (a padded header, or empty
 * members in front) is stopped at the threshold its compressed data allows.
 * Framing that comes after the data is only known once it is read, so until
 * then the bomb is held to the higher threshold the file's size allows, and
 * never past `maxTotalBytes`. The input must be exactly `inputBytes` long, so a
 * file that changes while it is read is refused.
 *
 * Without `inputBytes`, the same rule is applied once, at the end.
 */
export class SnapshotBudget {
  readonly totals: MeasuredTotals = emptyTotals();
  readonly rejected: RejectedEntry[] = [];
  readonly files: SnapshotFile[] = [];
  private readonly acceptedSizes: Array<{ path: string; type: SnapshotEntryType; sizeBytes: number }> = [];
  private admittedFiles = 0;
  /** Paths of entries that are not directories: files, symlinks, submodules, anything refused. */
  private readonly entryPaths = new Set<string>();
  /** Paths of explicit directory entries (tar only). */
  private readonly directoryEntries = new Set<string>();
  /** Every path some entry lives under, and every explicit directory. */
  private readonly directoryPaths = new Set<string>();
  private readonly compressed: boolean;
  private readonly inputBytes: number | undefined;
  /** Input bytes known to be gzip framing, not compressed data: see `countFraming`. */
  private framingBytes = 0;
  private readonly blobIds = new Map<string, string>();

  constructor(compressed: boolean, inputBytes?: number) {
    this.compressed = compressed;
    this.inputBytes = inputBytes;
  }

  /** Bytes received from the reader, before decompression. */
  countStream(bytes: number): void {
    this.totals.streamBytes += bytes;
    if (this.totals.streamBytes > SNAPSHOT_LIMITS.maxArchiveBytes) {
      throw new SnapshotRefused(
        "archive_too_large",
        `Read ${this.totals.streamBytes} bytes of input, over the ${SNAPSHOT_LIMITS.maxArchiveBytes} limit.`,
      );
    }
    if (this.inputBytes !== undefined && this.totals.streamBytes > this.inputBytes) throw this.sizeChanged();
    if (!this.compressed) this.countExpanded(bytes);
  }

  /** Bytes produced by decompression. For an uncompressed source, `countStream` calls this. */
  countExpanded(bytes: number): void {
    this.totals.expandedBytes += bytes;
    if (this.totals.expandedBytes > SNAPSHOT_LIMITS.maxTotalBytes) {
      throw new SnapshotRefused(
        "snapshot_too_large",
        `Expanded to ${this.totals.expandedBytes} bytes, over the ${SNAPSHOT_LIMITS.maxTotalBytes} limit.`,
      );
    }
    if (this.inputBytes !== undefined) {
      const refusal = this.ratioRefusal(this.inputBytes);
      if (refusal) throw new SnapshotRefused(refusal.reason, refusal.detail);
    }
  }

  /**
   * Input bytes that are gzip framing rather than compressed data: a member's
   * header, optional fields included, and its 8-byte trailer. They produce no
   * output, so they are not counted in the ratio's denominator, and a header
   * padded with a long comment, or a run of empty members, cannot raise the
   * threshold. Framing only grows, so the threshold only falls: the next
   * expanded byte is judged against it, and `finish` against the final one.
   */
  countFraming(bytes: number): void {
    this.framingBytes += bytes;
  }

  private sizeChanged(): SnapshotRefused {
    return new SnapshotRefused("malformed_input", "The archive changed size while it was read.");
  }

  /**
   * The ratio rule over an input of `inputBytes`, or null when it holds. The
   * denominator is the compressed data: the input less the framing read so far.
   */
  private ratioRefusal(inputBytes: number): AcquisitionRefusal | null {
    if (!this.compressed) return null;
    const compressedBytes = inputBytes - this.framingBytes;
    const threshold = Math.max(MEASURED_RATIO_FLOOR_BYTES, SNAPSHOT_LIMITS.maxExpansionRatio * compressedBytes);
    if (this.totals.expandedBytes <= threshold) return null;
    return {
      reason: "expansion_ratio_exceeded",
      detail: `The archive's ${compressedBytes} bytes of compressed data expand past ${threshold} bytes, more than ${SNAPSHOT_LIMITS.maxExpansionRatio}x their size. A plain .tar is not subject to this limit.`,
    };
  }

  /**
   * Claims one entry's path, in its canonical spelling, and returns that
   * spelling. Refused, whatever the spelling:
   *
   * - the same path listed twice: which copy belongs to the commit cannot be
   *   decided, and a repeated file could stand in for one that was left out;
   * - a path the entry rules would read used as a directory too, whether the
   *   directory is an explicit tar entry or only implied by an entry under it.
   *   A git tree lists no directories, so on the git path the directories are
   *   the ones the listed paths imply, and a hostile tree that names a blob
   *   `x` beside a subtree `x` holding a path is refused. A subtree that holds
   *   no path implies nothing: an empty subtree beside a blob of its name, or
   *   one name used for two subtrees, is not refused, and each file under them
   *   is still claimed once under its own path. Implied directories are only
   *   tracked within `maxPathLength` and `maxPathDepth` (see
   *   `readableAncestorsOf`), so two entries that are BOTH refused as too long
   *   or too deep may share a path as file and directory; neither is read, and
   *   each already leaves the text checks BLOCKED.
   */
  claimPath(path: string, kind: "entry" | "directory" = "entry"): string {
    const canonical = canonicalEntryPath(path);
    const repeated = kind === "directory" ? this.directoryEntries.has(canonical) : this.entryPaths.has(canonical);
    if (repeated) throw new SnapshotRefused("duplicate_entry_path", "The source lists the same path more than once.");
    const ancestors = readableAncestorsOf(canonical);
    const fileAndDirectory =
      (kind === "directory" ? this.entryPaths.has(canonical) : this.directoryPaths.has(canonical)) ||
      ancestors.some((ancestor) => this.entryPaths.has(ancestor));
    if (fileAndDirectory) {
      throw new SnapshotRefused("duplicate_entry_path", "The source uses one path as both a file and a directory.");
    }
    if (kind === "directory") {
      this.directoryEntries.add(canonical);
      this.directoryPaths.add(canonical);
    } else {
      this.entryPaths.add(canonical);
    }
    for (const ancestor of ancestors) this.directoryPaths.add(ancestor);
    return canonical;
  }

  /**
   * Claims the entry's path and classifies the entry by the documented
   * per-entry rules. Returns the canonical path to read its content under, or
   * null when its content is not read.
   */
  admit(entry: { path: string; type: SnapshotEntryType; declaredBytes: number }): string | null {
    this.totals.entryCount += 1;
    const path = this.claimPath(entry.path);
    const decision = evaluateSnapshotEntry({ path, type: entry.type, sizeBytes: entry.declaredBytes });
    if (!decision.accepted) {
      this.rejected.push({ path: decision.path, reason: decision.reason, detail: decision.detail });
      this.totals.rejectedCount += 1;
      return null;
    }
    if (entry.type !== "file") return null;
    // Counted on admission, not on acceptance: the git reader admits every
    // entry before it reads any blob, and must stop before reading them.
    this.admittedFiles += 1;
    if (this.admittedFiles > SNAPSHOT_LIMITS.maxFileCount) {
      throw new SnapshotRefused(
        "too_many_files",
        `More than ${SNAPSHOT_LIMITS.maxFileCount} files; the review stops rather than reads a partial snapshot.`,
      );
    }
    return path;
  }

  /**
   * Records the content of an admitted file. The MEASURED length must equal the
   * declared one: a reader that promised N bytes and delivered a different
   * number is malformed, and a limit decided on the promise would be void.
   */
  accept(path: string, declaredBytes: number, bytes: Buffer): void {
    if (bytes.length !== declaredBytes) {
      throw new SnapshotRefused(
        "declared_size_mismatch",
        `An entry declared ${declaredBytes} bytes and ${bytes.length} were read.`,
      );
    }
    if (bytes.length > SNAPSHOT_LIMITS.maxFileBytes) {
      throw new SnapshotRefused("declared_size_mismatch", `An entry read ${bytes.length} bytes, over the per-file limit.`);
    }
    this.files.push({ path, bytes });
    this.acceptedSizes.push({ path, type: "file", sizeBytes: bytes.length });
    this.totals.acceptedFileCount += 1;
    this.totals.acceptedBytes += bytes.length;
  }

  /**
   * Records the git blob id of an entry the source carried, under its
   * canonical path: a file's content, read or not, or a symlink's target.
   */
  recordBlobId(path: string, id: string): void {
    this.blobIds.set(canonicalEntryPath(path), id);
  }

  /**
   * The final decision. The archive limits were enforced on the measured
   * stream as it was read, and the ratio is decided here over the whole input.
   * The entry and whole-snapshot rules are the same `evaluateSnapshot` the claim
   * half uses, over the measured sizes. It is given no archive facts: its ratio
   * rule has no floor, which is right for a declared index and wrong for tar
   * framing (see `MEASURED_RATIO_FLOOR_BYTES`).
   */
  finish(source: SnapshotSourceKind, commitSha: string): SnapshotOutcome {
    if (this.inputBytes !== undefined && this.totals.streamBytes !== this.inputBytes) {
      return this.blocked(source, commitSha, this.sizeChanged().refusal);
    }
    const ratio = this.ratioRefusal(this.totals.streamBytes);
    if (ratio) return this.blocked(source, commitSha, ratio);
    const decision = evaluateSnapshot(this.acceptedSizes);
    if (!decision.accepted) {
      return {
        status: "blocked",
        source,
        commitSha,
        limitsVersion: SNAPSHOT_LIMITS_VERSION,
        refusals: decision.refusals.map((refusal) => ({ reason: refusal.reason, detail: refusal.detail })),
        totals: this.totals,
      };
    }
    return {
      status: "acquired",
      source,
      commitSha,
      limitsVersion: SNAPSHOT_LIMITS_VERSION,
      files: [...this.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      rejected: this.rejected,
      totals: this.totals,
      blobIds: this.blobIds,
    };
  }

  blocked(source: SnapshotSourceKind, commitSha: string | null, refusal: AcquisitionRefusal): BlockedSnapshot {
    return {
      status: "blocked",
      source,
      commitSha,
      limitsVersion: SNAPSHOT_LIMITS_VERSION,
      refusals: [refusal],
      totals: this.totals,
    };
  }
}

export function blockedBeforeReading(
  source: SnapshotSourceKind,
  commitSha: string | null,
  reason: AcquisitionRefusalReason,
  detail: string,
): BlockedSnapshot {
  return {
    status: "blocked",
    source,
    commitSha,
    limitsVersion: SNAPSHOT_LIMITS_VERSION,
    refusals: [{ reason, detail }],
    totals: emptyTotals(),
  };
}
