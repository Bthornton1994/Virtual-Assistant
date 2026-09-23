import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_LIMITS } from "@/lib/release-rescue-snapshot-limits";
import { readGitCommit, parseLsTree } from "@/lib/release-rescue-internal/git-source";
import { SnapshotBudget, SnapshotRefused } from "@/lib/release-rescue-internal/snapshot";
import { readTarStream } from "@/lib/release-rescue-internal/tar-source";
import {
  FIXTURE_REPOSITORY,
  buildTar,
  gzip,
  makeFixtureRepo,
  tarHeader,
} from "@/lib/__tests__/release-rescue-internal-fixtures";

// Source acquisition for the internal workflow, against hostile input.
//
// Each case is an input a hostile repository or archive could present, and the
// assertion is what the reader does with it: refuse the whole snapshot, or
// reject the one entry and not read its content. The limits are the documented
// `SNAPSHOT_LIMITS`, enforced on bytes actually read.

const SHA = "0123456789abcdef0123456789abcdef01234567";

function tarStream(buffer: Buffer): Readable {
  // Delivered in small chunks, so a reader that only works on whole buffers
  // would fail here rather than in production.
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += 700) chunks.push(buffer.subarray(offset, offset + 700));
  return Readable.from(chunks);
}

function withCommit(entries: Parameters<typeof buildTar>[0]): Parameters<typeof buildTar>[0] {
  return [{ kind: "pax", global: true, records: { comment: SHA } }, ...entries];
}

describe("the tar reader reads what the archive contains, and nothing it only claims", () => {
  it("reads a well-formed archive that records the pinned commit", async () => {
    const tar = buildTar(withCommit([{ kind: "file", name: "src/index.ts", data: "export const a = 1;\n" }]));
    const outcome = await readTarStream(tarStream(tar), SHA, { gzip: false });
    expect(outcome.status).toBe("acquired");
    if (outcome.status !== "acquired") return;
    expect(outcome.files.map((file) => file.path)).toEqual(["src/index.ts"]);
    expect(outcome.files[0].bytes.toString("utf8")).toBe("export const a = 1;\n");
    expect(outcome.totals.streamBytes).toBe(tar.length);
  });

  it("refuses an archive that does not record the pinned commit", async () => {
    const tar = buildTar([{ kind: "pax", global: true, records: { comment: "f".repeat(40) } }, { kind: "file", name: "a.ts", data: "x" }]);
    const outcome = await readTarStream(tarStream(tar), SHA, { gzip: false });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.refusals[0].reason).toBe("archive_commit_unverified");
  });

  it("does not follow a symlink, and does not read a hard link", async () => {
    const tar = buildTar(
      withCommit([
        { kind: "file", name: "ok.ts", data: "ok" },
        { kind: "file", name: "escape", data: "", typeflag: "2" },
        { kind: "file", name: "linked", data: "", typeflag: "1" },
      ]),
    );
    const outcome = await readTarStream(tarStream(tar), SHA, { gzip: false });
    expect(outcome.status).toBe("acquired");
    if (outcome.status !== "acquired") return;
    expect(outcome.files.map((file) => file.path)).toEqual(["ok.ts"]);
    expect(outcome.rejected.map((entry) => entry.reason).sort()).toEqual(["symlink_not_followed", "unsupported_entry_type"]);
  });

  it("rejects traversal and absolute paths, including a traversal hidden in a pax path record", async () => {
    const tar = buildTar(
      withCommit([
        { kind: "file", name: "ok.ts", data: "ok" },
        { kind: "file", name: "../escape.ts", data: "no" },
        { kind: "file", name: "/etc/passwd", data: "no" },
        { kind: "pax", records: { path: "../../outside.ts" } },
        { kind: "file", name: "harmless.ts", data: "no" },
      ]),
    );
    const outcome = await readTarStream(tarStream(tar), SHA, { gzip: false });
    expect(outcome.status).toBe("acquired");
    if (outcome.status !== "acquired") return;
    expect(outcome.files.map((file) => file.path)).toEqual(["ok.ts"]);
    expect(outcome.rejected.map((entry) => entry.reason).sort()).toEqual(["absolute_path", "path_traversal", "path_traversal"]);
    // The pax path decided, not the harmless ustar name.
    expect(outcome.rejected.map((entry) => entry.path)).toContain("../../outside.ts");
  });

  it("refuses a header whose checksum does not match", async () => {
    const corrupt = Buffer.concat([tarHeader("a.ts", 1, "0", { corruptChecksum: true }), Buffer.alloc(512, 0x61)]);
    const tar = buildTar(withCommit([{ kind: "raw", block: corrupt }]));
    const outcome = await readTarStream(tarStream(tar), SHA, { gzip: false });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.refusals[0].reason).toBe("malformed_input");
  });

  it("refuses an archive that ends inside an entry, rather than trusting its declared size", async () => {
    const tar = buildTar(withCommit([{ kind: "file", name: "a.ts", data: "short", declaredSize: 5000 }]), {
      terminate: false,
    });
    const outcome = await readTarStream(tarStream(tar), SHA, { gzip: false });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.refusals[0].reason).toBe("malformed_input");
  });

  it("does not read a file over the per-file limit", async () => {
    const big = Buffer.alloc(SNAPSHOT_LIMITS.maxFileBytes + 1, 0x61);
    const tar = buildTar(withCommit([{ kind: "file", name: "ok.ts", data: "ok" }, { kind: "file", name: "big.txt", data: big }]));
    const outcome = await readTarStream(tarStream(tar), SHA, { gzip: false });
    expect(outcome.status).toBe("acquired");
    if (outcome.status !== "acquired") return;
    expect(outcome.files.map((file) => file.path)).toEqual(["ok.ts"]);
    expect(outcome.rejected[0].reason).toBe("file_too_large");
    expect(outcome.totals.acceptedBytes).toBe(2);
  });

  it("refuses more files than the limit, instead of reading a partial snapshot", async () => {
    const entries = Array.from({ length: SNAPSHOT_LIMITS.maxFileCount + 1 }, (_, index) => ({
      kind: "file" as const,
      name: `f/${index}.ts`,
      data: "x",
    }));
    const outcome = await readTarStream(tarStream(buildTar(withCommit(entries))), SHA, { gzip: false });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.refusals[0].reason).toBe("too_many_files");
  });

  it("stops a decompression bomb at the ratio, from the bytes it actually produced", async () => {
    // Twenty megabytes of zeros, declared as one entry, compress to a few
    // kilobytes. The ratio is enforced as the bytes arrive, so the reader stops
    // long before it would have read them all.
    const payload = Buffer.alloc(20_000_000, 0);
    const tar = buildTar(withCommit([{ kind: "file", name: "zeros.bin", data: payload }]));
    const compressed = gzip(tar);
    expect(tar.length / compressed.length).toBeGreaterThan(SNAPSHOT_LIMITS.maxExpansionRatio);
    const outcome = await readTarStream(tarStream(compressed), SHA, { gzip: true });
    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.refusals[0].reason).toBe("expansion_ratio_exceeded");
    expect(outcome.totals.expandedBytes).toBeLessThan(tar.length);
  });

  it("refuses input that is not gzip when gzip is expected", async () => {
    const outcome = await readTarStream(tarStream(Buffer.from("not gzip at all")), SHA, { gzip: true });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.refusals[0].reason).toBe("malformed_input");
  });

  it("refuses a malformed commit sha before reading anything", async () => {
    const outcome = await readTarStream(tarStream(buildTar([])), "HEAD", { gzip: false });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.refusals[0].reason).toBe("commit_sha_malformed");
  });
});

describe("the measured budget enforces the whole-snapshot limits on real bytes", () => {
  it("refuses once the input read passes the archive limit", () => {
    const budget = new SnapshotBudget(true);
    expect(() => budget.countStream(SNAPSHOT_LIMITS.maxArchiveBytes + 1)).toThrow(SnapshotRefused);
  });

  it("refuses once the bytes produced pass the total limit", () => {
    const budget = new SnapshotBudget(false);
    expect(() => {
      for (let step = 0; step < 3; step += 1) budget.countExpanded(SNAPSHOT_LIMITS.maxTotalBytes / 2 + 1);
    }).toThrow(/snapshot_too_large/);
  });

  it("refuses content whose measured length differs from what was declared", () => {
    const budget = new SnapshotBudget(false);
    expect(budget.admit({ path: "a.ts", type: "file", declaredBytes: 10 })).toBe(true);
    expect(() => budget.accept("a.ts", 10, Buffer.from("short"))).toThrow(/declared_size_mismatch/);
  });
});

describe("the git reader reads the pinned commit from the object database, read-only", () => {
  it("reads committed bytes, not the working tree", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "committed\n" });
    writeFileSync(join(repo.path, "src/a.ts"), "edited in the working tree\n");
    const outcome = await readGitCommit({ checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha: repo.commitSha });
    expect(outcome.status).toBe("acquired");
    if (outcome.status === "acquired") expect(outcome.files[0].bytes.toString("utf8")).toBe("committed\n");
  });

  it("does not follow a committed symlink, even one pointing outside the repository", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "a\n" }, { symlinks: { "escape": "/etc/passwd" } });
    const outcome = await readGitCommit({ checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha: repo.commitSha });
    expect(outcome.status).toBe("acquired");
    if (outcome.status !== "acquired") return;
    expect(outcome.files.map((file) => file.path)).toEqual(["src/a.ts"]);
    expect(outcome.rejected).toEqual([expect.objectContaining({ path: "escape", reason: "symlink_not_followed" })]);
  });

  it("is not hidden from by export-ignore, because it applies no attributes", async () => {
    const repo = makeFixtureRepo({ ".gitattributes": "hidden.ts export-ignore\n", "hidden.ts": "still reviewed\n" });
    const outcome = await readGitCommit({ checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha: repo.commitSha });
    expect(outcome.status).toBe("acquired");
    if (outcome.status === "acquired") expect(outcome.files.map((file) => file.path)).toContain("hidden.ts");
  });

  it("does not read a committed credential file", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "a\n", ".env": "SHOULD_NOT_BE_READ=1\n" });
    const outcome = await readGitCommit({ checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha: repo.commitSha });
    expect(outcome.status).toBe("acquired");
    if (outcome.status !== "acquired") return;
    expect(outcome.files.map((file) => file.path)).toEqual(["src/a.ts"]);
    expect(outcome.rejected[0].reason).toBe("credential_file_not_read");
  });

  it("refuses a checkout that is a clone of a different repository", async () => {
    const repo = makeFixtureRepo({ "a.ts": "a\n" }, { remoteRef: "someone-else/other" });
    const outcome = await readGitCommit({ checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha: repo.commitSha });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.refusals[0].reason).toBe("checkout_remote_mismatch");
  });

  it("refuses a commit the checkout does not have, and a sha that is not a sha", async () => {
    const repo = makeFixtureRepo({ "a.ts": "a\n" });
    const missing = await readGitCommit({ checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha: "f".repeat(40) });
    expect(missing.status === "blocked" && missing.refusals[0].reason).toBe("commit_not_found");
    const malformed = await readGitCommit({ checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha: "main" });
    expect(malformed.status === "blocked" && malformed.refusals[0].reason).toBe("commit_sha_malformed");
    const relative = await readGitCommit({ checkoutPath: "relative/path", repositoryRef: FIXTURE_REPOSITORY, commitSha: repo.commitSha });
    expect(relative.status === "blocked" && relative.refusals[0].reason).toBe("checkout_not_configured");
  });

  it("refuses a malformed tree listing rather than guessing", () => {
    expect(parseLsTree(Buffer.from("100644 blob nothex 1\tfile\0"))).toBeNull();
    expect(parseLsTree(Buffer.from("no tab here\0"))).toBeNull();
  });
});
