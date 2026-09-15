import { z } from "zod";
import { isForbiddenEvidenceFilename } from "@/lib/release-rescue-redaction";

// Fail-closed limits on what a review will ingest.
//
// The reviewed repository is hostile input. It arrives from someone we have not
// met, it is not ours, and on the archive path it may not even belong to the
// person who sent it. Three things can go wrong before a single line is read:
//
//   * A decompression bomb: a small archive that expands until the host dies.
//   * A symlink pointing outside the snapshot, turning "read the repository"
//     into "read whatever the reviewer's machine can reach" — an SSH key, the CI
//     token, another customer's checkout.
//   * Sheer volume: a monorepo with a million files, priced as one repository.
//
// Every rule here fails CLOSED. An entry we cannot classify is rejected rather
// than assumed safe, and a snapshot that breaches a whole-snapshot limit is
// refused entirely rather than quietly truncated — a truncated review reporting
// "no findings" is worse than no review, because the customer believes it.
//
// Pure and deterministic: this module decides, it does not touch a filesystem.
// The caller enumerates entries, so the limits apply BEFORE anything is read.

export const SNAPSHOT_LIMITS_VERSION = "release-rescue-snapshot-limits/v1" as const;

export const SNAPSHOT_LIMITS = {
  /** Files in the snapshot. A repository larger than this is a different engagement. */
  maxFileCount: 5_000,
  /** One file. Anything larger is generated, vendored, or binary, and is not read. */
  maxFileBytes: 2_000_000,
  /** The whole snapshot once expanded. */
  maxTotalBytes: 200_000_000,
  /** The archive as uploaded, before expansion. */
  maxArchiveBytes: 100_000_000,
  /**
   * Expanded bytes divided by archive bytes. Ordinary source compresses about
   * 3-5x; a decompression bomb is thousands. Twelve leaves real repositories alone.
   */
  maxExpansionRatio: 12,
  maxPathDepth: 24,
  maxPathLength: 400,
} as const;

export const SNAPSHOT_ENTRY_TYPES = ["file", "directory", "symlink", "other"] as const;
export type SnapshotEntryType = (typeof SNAPSHOT_ENTRY_TYPES)[number];

export const snapshotEntrySchema = z
  .object({
    path: z.string(),
    type: z.enum(SNAPSHOT_ENTRY_TYPES),
    sizeBytes: z.number().int().min(0),
  })
  .strict();

export type SnapshotEntry = z.infer<typeof snapshotEntrySchema>;

export const ENTRY_REJECTION_REASONS = [
  "symlink_not_followed",
  "unsupported_entry_type",
  "absolute_path",
  "path_traversal",
  "path_too_long",
  "path_too_deep",
  "illegal_path_character",
  "file_too_large",
  "credential_file_not_read",
  "malformed_entry",
] as const;
export type EntryRejectionReason = (typeof ENTRY_REJECTION_REASONS)[number];

export const SNAPSHOT_REFUSAL_REASONS = [
  "too_many_files",
  "snapshot_too_large",
  "archive_too_large",
  "expansion_ratio_exceeded",
  "empty_snapshot",
] as const;
export type SnapshotRefusalReason = (typeof SNAPSHOT_REFUSAL_REASONS)[number];

export type EntryDecision =
  | { accepted: true; entry: SnapshotEntry }
  | { accepted: false; path: string; reason: EntryRejectionReason; detail: string };

/**
 * Control characters and backslashes in a path.
 *
 * Written as a character-code scan rather than a regex: a path carrying a NUL or
 * a newline is usually an attempt to confuse something downstream that splits on
 * one, and the check reads more plainly than the escape sequences would.
 */
function hasIllegalPathCharacter(path: string): boolean {
  if (path.includes("\\")) return true;
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Classifies one entry.
 *
 * Symlinks are rejected rather than resolved. Resolving one means deciding
 * whether its target is inside the snapshot, and that decision is where every
 * traversal bug in every archive extractor has ever lived. Not following them at
 * all has no such failure mode, and the review loses almost nothing: the target,
 * if it is in the snapshot, is read under its real path.
 */
export function evaluateSnapshotEntry(candidate: unknown): EntryDecision {
  const parsed = snapshotEntrySchema.safeParse(candidate);
  if (!parsed.success) {
    const rawPath = (candidate as { path?: unknown } | null)?.path;
    return {
      accepted: false,
      path: typeof rawPath === "string" ? rawPath : "(unknown)",
      reason: "malformed_entry",
      detail: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }

  const entry = parsed.data;
  const reject = (reason: EntryRejectionReason, detail: string): EntryDecision => ({
    accepted: false,
    path: entry.path,
    reason,
    detail,
  });

  if (entry.type === "symlink") return reject("symlink_not_followed", "Symlinks are recorded and never followed.");
  if (entry.type !== "file") return reject("unsupported_entry_type", `Entry type "${entry.type}" is not read.`);

  if (entry.path.length === 0) return reject("malformed_entry", "Entry has no path.");
  if (entry.path.length > SNAPSHOT_LIMITS.maxPathLength) {
    return reject("path_too_long", `Path exceeds ${SNAPSHOT_LIMITS.maxPathLength} characters.`);
  }
  if (hasIllegalPathCharacter(entry.path)) {
    return reject("illegal_path_character", "Path contains a control character or a backslash.");
  }
  if (entry.path.startsWith("/")) return reject("absolute_path", "Path is absolute.");
  // A drive-qualified path is absolute too, and a fullwidth solidus is not the
  // separator we split on, so neither is caught by the checks above.
  if (/^[A-Za-z]:[/\\]/.test(entry.path)) return reject("absolute_path", "Path is drive-qualified.");
  if (/[\uff0f\uff3c\u2215\u29f5]/.test(entry.path)) {
    return reject("illegal_path_character", "Path contains a lookalike separator.");
  }

  const segments = entry.path.split("/");
  if (segments.includes("..")) return reject("path_traversal", "Path escapes the snapshot root.");
  if (segments.length > SNAPSHOT_LIMITS.maxPathDepth) {
    return reject("path_too_deep", `Path is deeper than ${SNAPSHOT_LIMITS.maxPathDepth} segments.`);
  }
  if (entry.sizeBytes > SNAPSHOT_LIMITS.maxFileBytes) {
    return reject("file_too_large", `File exceeds ${SNAPSHOT_LIMITS.maxFileBytes} bytes.`);
  }
  // A file whose whole content is a credential is not evidence, and reading it
  // would copy the secret into our pipeline. That it exists is the finding.
  if (isForbiddenEvidenceFilename(entry.path)) {
    return reject("credential_file_not_read", "Credential file recorded as present and not read.");
  }

  return { accepted: true, entry };
}

export type SnapshotTotals = {
  entryCount: number;
  acceptedFileCount: number;
  acceptedBytes: number;
  rejectedCount: number;
  symlinkCount: number;
  credentialFileCount: number;
};

export type SnapshotDecision =
  | {
      accepted: true;
      limitsVersion: typeof SNAPSHOT_LIMITS_VERSION;
      acceptedFiles: SnapshotEntry[];
      rejected: Array<{ path: string; reason: EntryRejectionReason; detail: string }>;
      totals: SnapshotTotals;
    }
  | {
      accepted: false;
      limitsVersion: typeof SNAPSHOT_LIMITS_VERSION;
      refusals: Array<{ reason: SnapshotRefusalReason; detail: string }>;
      totals: SnapshotTotals;
    };

export const archiveFactsSchema = z
  .object({
    /** Bytes as uploaded, before expansion. */
    archiveBytes: z.number(),
    /** Total uncompressed size the archive DECLARES, read from its index. */
    declaredExpandedBytes: z.number(),
  })
  .strict();

export type ArchiveFacts = z.infer<typeof archiveFactsSchema>;

/**
 * Archive facts we are willing to reason about.
 *
 * NaN is the dangerous case: every `>` comparison against it is false, so a
 * NaN-carrying archive slid past the size and ratio limits and the module failed
 * OPEN — against its own header, which promises the opposite. Negative and
 * non-integer values are refused for the same reason: a number we cannot compare
 * meaningfully is not a number we should gate on.
 */
function archiveFactsAreUsable(archive: ArchiveFacts): boolean {
  return (
    Number.isFinite(archive.archiveBytes) &&
    Number.isFinite(archive.declaredExpandedBytes) &&
    archive.archiveBytes > 0 &&
    archive.declaredExpandedBytes >= 0
  );
}

/**
 * Applies the whole-snapshot limits.
 *
 * Archive limits are checked against the archive's own declared index, which is
 * the only point at which a decompression bomb can still be refused cheaply. A
 * declared size is attacker-controlled, so the caller must ALSO stop extracting
 * once `maxTotalBytes` is actually reached: this function bounds the claim, the
 * extractor bounds the reality. Neither is sufficient alone.
 */
export function evaluateSnapshot(candidates: readonly unknown[], archive?: ArchiveFacts): SnapshotDecision {
  const acceptedFiles: SnapshotEntry[] = [];
  const rejected: Array<{ path: string; reason: EntryRejectionReason; detail: string }> = [];
  let acceptedBytes = 0;
  let symlinkCount = 0;
  let credentialFileCount = 0;

  for (const candidate of candidates) {
    const decision = evaluateSnapshotEntry(candidate);
    if (decision.accepted) {
      acceptedFiles.push(decision.entry);
      acceptedBytes += decision.entry.sizeBytes;
      continue;
    }
    rejected.push({ path: decision.path, reason: decision.reason, detail: decision.detail });
    if (decision.reason === "symlink_not_followed") symlinkCount += 1;
    if (decision.reason === "credential_file_not_read") credentialFileCount += 1;
  }

  const totals: SnapshotTotals = {
    entryCount: candidates.length,
    acceptedFileCount: acceptedFiles.length,
    acceptedBytes,
    rejectedCount: rejected.length,
    symlinkCount,
    credentialFileCount,
  };

  const refusals: Array<{ reason: SnapshotRefusalReason; detail: string }> = [];

  if (archive) {
    if (!archiveFactsAreUsable(archive)) {
      // Refused before any comparison, because the comparisons themselves are
      // what NaN defeats.
      refusals.push({
        reason: "archive_too_large",
        detail: `Archive reports unusable size facts (archiveBytes=${archive.archiveBytes}, declaredExpandedBytes=${archive.declaredExpandedBytes}).`,
      });
      return { accepted: false, limitsVersion: SNAPSHOT_LIMITS_VERSION, refusals, totals };
    }
    if (archive.archiveBytes > SNAPSHOT_LIMITS.maxArchiveBytes) {
      refusals.push({
        reason: "archive_too_large",
        detail: `Archive is ${archive.archiveBytes} bytes, over the ${SNAPSHOT_LIMITS.maxArchiveBytes} limit.`,
      });
    }
    if (archive.declaredExpandedBytes > SNAPSHOT_LIMITS.maxTotalBytes) {
      refusals.push({
        reason: "snapshot_too_large",
        detail: `Archive declares ${archive.declaredExpandedBytes} expanded bytes, over the ${SNAPSHOT_LIMITS.maxTotalBytes} limit.`,
      });
    }
    // The divisor is known positive and finite by archiveFactsAreUsable above.
    const ratio = archive.declaredExpandedBytes / archive.archiveBytes;
    if (ratio > SNAPSHOT_LIMITS.maxExpansionRatio) {
      refusals.push({
        reason: "expansion_ratio_exceeded",
        detail: `Archive expands ${ratio.toFixed(1)}x, over the ${SNAPSHOT_LIMITS.maxExpansionRatio}x limit.`,
      });
    }
  }

  if (acceptedFiles.length > SNAPSHOT_LIMITS.maxFileCount) {
    refusals.push({
      reason: "too_many_files",
      detail: `${acceptedFiles.length} files, over the ${SNAPSHOT_LIMITS.maxFileCount} limit.`,
    });
  }
  if (acceptedBytes > SNAPSHOT_LIMITS.maxTotalBytes) {
    refusals.push({
      reason: "snapshot_too_large",
      detail: `${acceptedBytes} bytes, over the ${SNAPSHOT_LIMITS.maxTotalBytes} limit.`,
    });
  }
  if (acceptedFiles.length === 0) {
    refusals.push({ reason: "empty_snapshot", detail: "No readable file survived the limits." });
  }

  if (refusals.length > 0) {
    return { accepted: false, limitsVersion: SNAPSHOT_LIMITS_VERSION, refusals, totals };
  }
  return { accepted: true, limitsVersion: SNAPSHOT_LIMITS_VERSION, acceptedFiles, rejected, totals };
}

/**
 * The rejected-path record stored with the engagement.
 *
 * Paths and reasons only, never contents. A report has to be able to say what it
 * did not look at, or "no findings" is an unbounded claim.
 */
export function summarizeRejections(decision: SnapshotDecision): Array<{ path: string; reason: string }> {
  if (!decision.accepted) return [];
  return decision.rejected.map((entry) => ({ path: entry.path, reason: entry.reason }));
}
