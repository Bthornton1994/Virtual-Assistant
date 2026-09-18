import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_LIMITS,
  SNAPSHOT_LIMITS_VERSION,
  evaluateSnapshot,
  evaluateSnapshotEntry,
  summarizeRejections,
  type SnapshotEntry,
} from "@/lib/release-rescue-snapshot-limits";

function file(path: string, sizeBytes = 100): SnapshotEntry {
  return { path, type: "file", sizeBytes };
}

function manyFiles(count: number, sizeBytes = 100): SnapshotEntry[] {
  return Array.from({ length: count }, (_, index) => file(`src/file-${index}.ts`, sizeBytes));
}

function reasonOf(candidate: unknown): string {
  const decision = evaluateSnapshotEntry(candidate);
  return decision.accepted ? "accepted" : decision.reason;
}

describe("snapshot entry limits", () => {
  it("accepts an ordinary source file", () => {
    const decision = evaluateSnapshotEntry(file("src/app/page.tsx", 4_000));

    expect(decision.accepted).toBe(true);
  });

  it("never follows a symlink", () => {
    // Resolving one means deciding whether its target is inside the snapshot,
    // which is where archive-extractor traversal bugs live.
    expect(reasonOf({ path: "linked.ts", type: "symlink", sizeBytes: 12 })).toBe("symlink_not_followed");
    expect(reasonOf({ path: "evil", type: "symlink", sizeBytes: 0 })).toBe("symlink_not_followed");
  });

  it("refuses entry types it cannot classify", () => {
    expect(reasonOf({ path: "dev/null", type: "other", sizeBytes: 0 })).toBe("unsupported_entry_type");
    expect(reasonOf({ path: "src", type: "directory", sizeBytes: 0 })).toBe("unsupported_entry_type");
  });

  it("refuses paths that leave the snapshot root", () => {
    expect(reasonOf(file("/etc/passwd"))).toBe("absolute_path");
    expect(reasonOf(file("../../.ssh/id_rsa"))).toBe("path_traversal");
    expect(reasonOf(file("src/../../etc/shadow"))).toBe("path_traversal");
  });

  it("refuses drive-qualified paths and lookalike separators", () => {
    // Neither is caught by startsWith("/") or by splitting on "/".
    expect(reasonOf(file("C:/Windows/system32/x.txt"))).toBe("absolute_path");
    expect(reasonOf(file("d:/secrets/key.txt"))).toBe("absolute_path");
    expect(reasonOf(file("\uff0fetc/passwd"))).toBe("illegal_path_character");
    expect(reasonOf(file("src\u2215..\u2215etc/passwd"))).toBe("illegal_path_character");
  });

  it("refuses paths carrying control characters or backslashes", () => {
    // Built rather than written as a literal: a real NUL byte in a source file
    // confuses editors, diffs, and grep.
    const nul = String.fromCharCode(0);
    expect(reasonOf(file(`src/a${nul}b.ts`))).toBe("illegal_path_character");
    expect(reasonOf(file("src/a\nb.ts"))).toBe("illegal_path_character");
    expect(reasonOf(file("src\\windows\\path.ts"))).toBe("illegal_path_character");
  });

  it("refuses paths that are too long or too deep", () => {
    expect(reasonOf(file(`src/${"a".repeat(SNAPSHOT_LIMITS.maxPathLength)}.ts`))).toBe("path_too_long");
    expect(reasonOf(file(`${"a/".repeat(SNAPSHOT_LIMITS.maxPathDepth + 1)}x.ts`))).toBe("path_too_deep");
  });

  it("refuses a file over the per-file limit at the boundary", () => {
    expect(evaluateSnapshotEntry(file("big.ts", SNAPSHOT_LIMITS.maxFileBytes)).accepted).toBe(true);
    expect(reasonOf(file("big.ts", SNAPSHOT_LIMITS.maxFileBytes + 1))).toBe("file_too_large");
  });

  it("records a credential file as present without reading it", () => {
    expect(reasonOf(file(".env.production", 200))).toBe("credential_file_not_read");
    expect(reasonOf(file("deploy/id_ed25519", 400))).toBe("credential_file_not_read");
    // The template is ordinary source and stays readable.
    expect(evaluateSnapshotEntry(file(".env.example", 200)).accepted).toBe(true);
  });

  it("refuses a malformed entry rather than guessing", () => {
    expect(reasonOf({ path: "a.ts" })).toBe("malformed_entry");
    expect(reasonOf({ path: "a.ts", type: "file", sizeBytes: -1 })).toBe("malformed_entry");
    expect(reasonOf({ path: "a.ts", type: "fifo", sizeBytes: 1 })).toBe("malformed_entry");
    expect(reasonOf(null)).toBe("malformed_entry");
    expect(reasonOf({ path: "a.ts", type: "file", sizeBytes: 1, extra: true })).toBe("malformed_entry");
  });
});

describe("whole-snapshot limits", () => {
  it("accepts an ordinary repository and reports what it skipped", () => {
    const decision = evaluateSnapshot([
      file("src/app/page.tsx", 4_000),
      file("package.json", 900),
      { path: "node_modules/link", type: "symlink", sizeBytes: 0 },
      file(".env", 120),
    ]);

    expect(decision.accepted).toBe(true);
    if (!decision.accepted) return;
    expect(decision.totals.acceptedFileCount).toBe(2);
    expect(decision.totals.symlinkCount).toBe(1);
    expect(decision.totals.credentialFileCount).toBe(1);
    expect(decision.limitsVersion).toBe(SNAPSHOT_LIMITS_VERSION);
    expect(summarizeRejections(decision)).toEqual([
      { path: "node_modules/link", reason: "symlink_not_followed" },
      { path: ".env", reason: "credential_file_not_read" },
    ]);
  });

  it("refuses the whole snapshot rather than truncating it", () => {
    // A truncated review that reports "no findings" is worse than no review,
    // because the customer believes it.
    const decision = evaluateSnapshot(manyFiles(SNAPSHOT_LIMITS.maxFileCount + 1));

    expect(decision.accepted).toBe(false);
    if (decision.accepted) return;
    expect(decision.refusals.map((r) => r.reason)).toContain("too_many_files");
  });

  it("accepts exactly the file-count boundary", () => {
    expect(evaluateSnapshot(manyFiles(SNAPSHOT_LIMITS.maxFileCount)).accepted).toBe(true);
  });

  it("refuses a snapshot over the total byte limit", () => {
    // Each file is exactly at the per-file limit, so none is rejected on its own
    // and the whole-snapshot limit is the thing under test.
    const count = Math.floor(SNAPSHOT_LIMITS.maxTotalBytes / SNAPSHOT_LIMITS.maxFileBytes) + 1;
    const decision = evaluateSnapshot(manyFiles(count, SNAPSHOT_LIMITS.maxFileBytes));

    expect(count).toBeLessThanOrEqual(SNAPSHOT_LIMITS.maxFileCount);
    expect(decision.accepted).toBe(false);
    if (decision.accepted) return;
    expect(decision.refusals.map((r) => r.reason)).toEqual(["snapshot_too_large"]);
  });

  it("refuses a decompression bomb from its declared index, before expansion", () => {
    const decision = evaluateSnapshot([file("payload.txt", 1_000)], {
      archiveBytes: 1_000,
      declaredExpandedBytes: 1_000_000_000,
    });

    expect(decision.accepted).toBe(false);
    if (decision.accepted) return;
    const reasons = decision.refusals.map((r) => r.reason);
    expect(reasons).toContain("expansion_ratio_exceeded");
    expect(reasons).toContain("snapshot_too_large");
  });

  it("leaves an ordinarily compressed archive alone", () => {
    const decision = evaluateSnapshot([file("src/app.ts", 40_000)], {
      archiveBytes: 1_000_000,
      declaredExpandedBytes: 4_000_000,
    });

    expect(decision.accepted).toBe(true);
  });

  it("refuses an archive over the upload limit", () => {
    const decision = evaluateSnapshot([file("src/app.ts", 1_000)], {
      archiveBytes: SNAPSHOT_LIMITS.maxArchiveBytes + 1,
      declaredExpandedBytes: SNAPSHOT_LIMITS.maxArchiveBytes + 2,
    });

    expect(decision.accepted).toBe(false);
    if (decision.accepted) return;
    expect(decision.refusals.map((r) => r.reason)).toContain("archive_too_large");
  });

  it("refuses unusable archive size facts rather than comparing against them", () => {
    // NaN defeats every ">" comparison, so an unvalidated NaN made the module
    // fail OPEN against its own stated posture. These must all be refused.
    for (const archive of [
      { archiveBytes: Number.NaN, declaredExpandedBytes: Number.NaN },
      { archiveBytes: Number.NaN, declaredExpandedBytes: 1_000_000_000_000 },
      { archiveBytes: 1_000, declaredExpandedBytes: Number.NaN },
      { archiveBytes: Number.POSITIVE_INFINITY, declaredExpandedBytes: 1_000 },
      { archiveBytes: -1_000, declaredExpandedBytes: 1_000 },
      { archiveBytes: 1_000, declaredExpandedBytes: -1 },
    ]) {
      const decision = evaluateSnapshot([file("src/app.ts", 1_000)], archive);
      expect(decision.accepted, JSON.stringify(archive)).toBe(false);
      if (decision.accepted) continue;
      expect(decision.refusals.map((r) => r.reason)).toContain("archive_too_large");
    }
  });

  it("refuses a zero-byte archive rather than dividing by it", () => {
    // The ratio would be Infinity or NaN; neither should decide a gate.
    const decision = evaluateSnapshot([file("src/app.ts", 1_000)], {
      archiveBytes: 0,
      declaredExpandedBytes: 1_000,
    });

    expect(decision.accepted).toBe(false);
    if (decision.accepted) return;
    expect(decision.refusals.map((r) => r.reason)).toContain("archive_too_large");
  });

  it("refuses a snapshot where nothing readable survived", () => {
    const decision = evaluateSnapshot([
      { path: "a", type: "symlink", sizeBytes: 0 },
      file(".env", 10),
    ]);

    expect(decision.accepted).toBe(false);
    if (decision.accepted) return;
    expect(decision.refusals.map((r) => r.reason)).toContain("empty_snapshot");
  });

  it("refuses an empty snapshot", () => {
    expect(evaluateSnapshot([]).accepted).toBe(false);
  });

  it("is deterministic", () => {
    const entries = [file("a.ts", 10), { path: "b", type: "symlink", sizeBytes: 0 }, file("../c.ts", 10)];

    expect(evaluateSnapshot(entries)).toEqual(evaluateSnapshot(entries));
  });
});
