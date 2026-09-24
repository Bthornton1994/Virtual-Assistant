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
// a limit is crossed, and then hands the measured figures to the same
// `evaluateSnapshot` the claim half uses, so one rule decides both.
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
 * dropped. `..` is kept, and an absolute path is left absolute, so the entry
 * rules still refuse them.
 */
export function canonicalEntryPath(path: string): string {
  if (path.startsWith("/")) return path;
  return path
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
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
 * Enforces the snapshot limits on measured bytes, as they arrive.
 *
 * `compressed` says whether `streamBytes` and `expandedBytes` differ. The
 * expansion ratio only means something for a compressed source, and is checked
 * continuously there, so a decompression bomb is stopped at the byte that
 * crosses the ratio rather than after it has filled memory.
 */
export class SnapshotBudget {
  readonly totals: MeasuredTotals = emptyTotals();
  readonly rejected: RejectedEntry[] = [];
  readonly files: SnapshotFile[] = [];
  private readonly acceptedSizes: Array<{ path: string; type: SnapshotEntryType; sizeBytes: number }> = [];
  private admittedFiles = 0;
  private readonly claimedPaths = new Set<string>();
  private readonly compressed: boolean;

  constructor(compressed: boolean) {
    this.compressed = compressed;
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
    if (this.compressed && this.totals.streamBytes > 0) {
      const ratio = this.totals.expandedBytes / this.totals.streamBytes;
      // A tiny prefix can legitimately expand a lot (a header block of zeros), so
      // the ratio is only enforced once there is enough input to mean anything.
      if (this.totals.expandedBytes > 1_000_000 && ratio > SNAPSHOT_LIMITS.maxExpansionRatio) {
        throw new SnapshotRefused(
          "expansion_ratio_exceeded",
          `Input expands ${ratio.toFixed(1)}x, over the ${SNAPSHOT_LIMITS.maxExpansionRatio}x limit.`,
        );
      }
    }
  }

  /**
   * Claims one entry's path, in its canonical spelling, and returns that
   * spelling. A source that lists the same path twice, however it spells it,
   * is refused: which copy belongs to the commit cannot be decided, and a
   * repeated file could stand in for one that was left out. Every entry claims
   * its path, directories included, so a file cannot share a path with one.
   */
  claimPath(path: string): string {
    const canonical = canonicalEntryPath(path);
    if (this.claimedPaths.has(canonical)) {
      throw new SnapshotRefused("duplicate_entry_path", "The source lists the same path more than once.");
    }
    this.claimedPaths.add(canonical);
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
   * The final decision, made by the same `evaluateSnapshot` the claim half
   * uses, over the measured sizes and the measured stream.
   */
  finish(source: SnapshotSourceKind, commitSha: string): SnapshotOutcome {
    const decision = evaluateSnapshot(this.acceptedSizes, {
      archiveBytes: Math.max(1, this.totals.streamBytes),
      declaredExpandedBytes: this.totals.expandedBytes,
    });
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
