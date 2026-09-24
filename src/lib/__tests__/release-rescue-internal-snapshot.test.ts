import { execFileSync, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_LIMITS } from "@/lib/release-rescue-snapshot-limits";
import { gitArgs, gitEnv, parseLsTree, readGitCommit, resolveCheckoutHead } from "@/lib/release-rescue-internal/git-source";
import {
  MEASURED_RATIO_FLOOR_BYTES,
  SnapshotBudget,
  SnapshotRefused,
  canonicalEntryPath,
  readableAncestorsOf,
} from "@/lib/release-rescue-internal/snapshot";
import { parsePax, readTarArchive, readTarStream } from "@/lib/release-rescue-internal/tar-source";
import {
  FAKE_AWS_KEY,
  FIXTURE_REPOSITORY,
  buildTar,
  editTarEntry,
  gzip,
  makeFixtureRepo,
  tarHeader,
  tempDir,
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
    const outcome = await readTarStream(tarStream(compressed), SHA, { gzip: true, inputBytes: compressed.length });
    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.refusals[0].reason).toBe("expansion_ratio_exceeded");
    expect(outcome.totals.expandedBytes).toBeLessThan(tar.length);
  });

  it.each([
    ["a directory", "5", "A directory entry carries data."],
    ["a symlink", "2", "A symlink entry carries data."],
    ["a hard link", "1", "A link or special entry carries data."],
    ["a FIFO", "6", "A link or special entry carries data."],
  ])("refuses %s entry that carries data, rather than skip it unread", async (_name, typeflag, detail) => {
    const tar = buildTar(
      withCommit([
        { kind: "file", name: "a.ts", data: "a\n" },
        { kind: "file", name: "x", typeflag, data: `k = "${FAKE_AWS_KEY}"\n` },
      ]),
    );
    const outcome = await readTarStream(tarStream(tar), SHA, { gzip: false });
    expect(outcome.status === "blocked" && outcome.refusals[0]).toEqual({ reason: "malformed_input", detail });
  });

  it("names tar paths that are not valid UTF-8 exactly, so two such names stay two entries", async () => {
    const tar = buildTar(
      withCommit([
        { kind: "file", name: "a.ts", data: "a\n" },
        { kind: "file", name: "kX.ts", data: "one\n" },
        { kind: "file", name: "kY.ts", data: "two\n" },
      ]),
    );
    const edited = editTarEntry(editTarEntry(tar, "kX.ts", { name: Buffer.from([0x6b, 0xfe, 0x2e, 0x74, 0x73]) }), "kY.ts", {
      name: Buffer.from([0x6b, 0xff, 0x2e, 0x74, 0x73]),
    });
    const outcome = await readTarStream(tarStream(edited), SHA, { gzip: false });
    expect(outcome.status).toBe("acquired");
    if (outcome.status !== "acquired") return;
    expect(outcome.rejected.map((entry) => [entry.path, entry.reason])).toEqual([
      ["k\\xfe.ts", "illegal_path_character"],
      ["k\\xff.ts", "illegal_path_character"],
    ]);
  });

  it("names a pax path that is not valid UTF-8 exactly, as it does a ustar name", async () => {
    const paxEntry = (path: Buffer): Parameters<typeof buildTar>[0] => {
      const body = Buffer.concat([Buffer.from(" path="), path, Buffer.from("\n")]);
      let length = body.length + 1;
      while (String(length).length + body.length !== length) length = String(length).length + body.length;
      const data = Buffer.concat([Buffer.from(String(length)), body]);
      const padded = Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512, 0)]);
      return [{ kind: "raw", block: tarHeader("PaxHeader", data.length, "x") }, { kind: "raw", block: padded }];
    };
    const tar = buildTar(
      withCommit([
        { kind: "file", name: "a.ts", data: "a\n" },
        ...paxEntry(Buffer.from([0x6b, 0xfe, 0x2e, 0x74, 0x73])),
        { kind: "file", name: "placeholder-1", data: "one\n" },
        ...paxEntry(Buffer.from([0x6b, 0xff, 0x2e, 0x74, 0x73])),
        { kind: "file", name: "placeholder-2", data: "two\n" },
      ]),
    );
    const outcome = await readTarStream(tarStream(tar), SHA, { gzip: false });
    expect(outcome.status).toBe("acquired");
    if (outcome.status !== "acquired") return;
    expect(outcome.rejected.map((entry) => entry.path)).toEqual(["k\\xfe.ts", "k\\xff.ts"]);
  });

  it("reads a pax length only as plain decimal digits that end exactly at the record's newline", () => {
    expect(parsePax(Buffer.from("13 path=a.ts\n"))?.get("path")?.toString()).toBe("a.ts");
    for (const record of ["0xe path=a.ts\n", "+14 path=a.ts\n", "014 path=a.ts\n", "1e1 x=abc\n", "12 path=a.ts\n", "99 path=a.ts\n", "13 =patha.ts\n", "13 path=a.tsx"]) {
      expect(parsePax(Buffer.from(record)), JSON.stringify(record)).toBeNull();
    }
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
    expect(budget.admit({ path: "a.ts", type: "file", declaredBytes: 10 })).toBe("a.ts");
    expect(() => budget.accept("a.ts", 10, Buffer.from("short"))).toThrow(/declared_size_mismatch/);
  });
});

// --- The expansion ratio ---------------------------------------------------------

function chunked(buffer: Buffer, size: number): Readable {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += size) chunks.push(buffer.subarray(offset, offset + size));
  return Readable.from(chunks);
}

/** Deterministic bytes that do not compress: xorshift32 from `seed`. */
function incompressible(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let x = seed >>> 0 || 1;
  for (let index = 0; index < length; index += 1) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[index] = x & 0xff;
  }
  return out;
}

/**
 * The reported archive: 1.6 MB of generated JSON first, which compresses about
 * 19x on its own, then 60 files of base64 noise. About 2.4 MB, and 4.6x overall.
 */
function reportedEntries(): Parameters<typeof buildTar>[0] {
  let json = "[";
  for (let index = 0; index < 30_000; index += 1) {
    json += `${JSON.stringify({ id: index, name: `item-${index}`, active: index % 2 === 0, tags: ["a", "b"] })},`;
  }
  const entries: Parameters<typeof buildTar>[0] = [{ kind: "file", name: "data/fixtures.json", data: `${json}{}]` }];
  for (let index = 1; index <= 60; index += 1) {
    entries.push({ kind: "file", name: `src/f${index}.txt`, data: incompressible(6000, index).toString("base64") });
  }
  return entries;
}

/** gzip of a tar holding one file of `bytes` zeros beside `ok.ts`, built without holding the tar in memory. */
async function zeroBomb(bytes: number): Promise<Buffer> {
  const gz = createGzip();
  const out: Buffer[] = [];
  gz.on("data", (chunk: Buffer) => out.push(chunk));
  const ended = once(gz, "end");
  const write = async (chunk: Buffer) => {
    if (!gz.write(chunk)) await once(gz, "drain");
  };
  await write(buildTar(withCommit([{ kind: "file", name: "ok.ts", data: "ok\n" }]), { terminate: false }));
  await write(tarHeader("zeros.bin", bytes, "0"));
  const zeros = Buffer.alloc(1 << 20, 0);
  for (let left = bytes; left > 0; left -= zeros.length) await write(zeros.subarray(0, Math.min(zeros.length, left)));
  await write(Buffer.alloc((512 - (bytes % 512)) % 512 + 1024, 0));
  gz.end();
  await ended;
  return Buffer.concat(out);
}

describe("the expansion ratio is the whole archive's, whatever the order of its entries or the size of its reads", () => {
  const LIMIT = SNAPSHOT_LIMITS.maxExpansionRatio;

  it("acquires the reported 2.4 MB archive, 4.6x overall though its first file alone is over 12x, at every read size", async () => {
    const tar = buildTar(withCommit(reportedEntries()));
    const compressed = gzip(tar);
    expect(tar.length).toBeGreaterThan(2_400_000);
    expect(tar.length / compressed.length).toBeLessThan(6);
    const first = buildTar(withCommit(reportedEntries().slice(0, 1)));
    expect(first.length / gzip(first).length).toBeGreaterThan(LIMIT);
    for (const size of [512, 700, 64 * 1024, compressed.length]) {
      const outcome = await readTarStream(chunked(compressed, size), SHA, { gzip: true, inputBytes: compressed.length });
      expect(outcome.status, `read in ${size}-byte chunks`).toBe("acquired");
      if (outcome.status === "acquired") expect(outcome.files).toHaveLength(61);
    }
  });

  it("acquires it from a file, and with its entries in the reverse order", async () => {
    const dir = tempDir("rr-internal-ratio-");
    for (const [name, entries] of [
      ["forward.tar.gz", reportedEntries()],
      ["reverse.tar.gz", reportedEntries().reverse()],
    ] as const) {
      const path = join(dir, name);
      writeFileSync(path, gzip(buildTar(withCommit([...entries]))));
      const outcome = await readTarArchive({ archivePath: path, commitSha: SHA });
      expect(outcome.status, name).toBe("acquired");
    }
  });

  it("acquires a small `git archive` .tar.gz, which tar padding pushes far past 12x", async () => {
    const repo = makeFixtureRepo({ "src/a.ts": "export const a = 1;\n" });
    const path = join(tempDir("rr-internal-ratio-"), "small.tar.gz");
    execFileSync("git", ["-C", repo.path, "archive", "--format=tar.gz", "-o", path, repo.commitSha], {
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    const outcome = await readTarArchive({ archivePath: path, commitSha: repo.commitSha });
    expect(outcome.status).toBe("acquired");
    expect(outcome.totals.expandedBytes / outcome.totals.streamBytes).toBeGreaterThan(LIMIT);
  });

  it("refuses a 150 MB bomb early, with the same decision and the same words at every read size", async () => {
    const compressed = await zeroBomb(150_000_000);
    const details = new Set<string>();
    for (const size of [700, 64 * 1024, compressed.length]) {
      const outcome = await readTarStream(chunked(compressed, size), SHA, { gzip: true, inputBytes: compressed.length });
      expect(outcome.status).toBe("blocked");
      if (outcome.status !== "blocked") return;
      expect(outcome.refusals[0].reason).toBe("expansion_ratio_exceeded");
      details.add(outcome.refusals[0].detail);
      // Stopped near the threshold, not after expanding 150 MB.
      expect(outcome.totals.expandedBytes).toBeLessThan(MEASURED_RATIO_FLOOR_BYTES + 2 * 1024 * 1024);
    }
    expect([...details]).toEqual([
      `The archive's ${compressed.length} bytes expand past ${MEASURED_RATIO_FLOOR_BYTES} bytes, more than ${LIMIT}x its size. A plain .tar is not subject to this limit.`,
    ]);
  });

  it("stops a bomb read from a file early, using the file's size", async () => {
    const path = join(tempDir("rr-internal-ratio-"), "bomb.tar.gz");
    writeFileSync(path, await zeroBomb(150_000_000));
    const outcome = await readTarArchive({ archivePath: path, commitSha: SHA });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.refusals[0].reason).toBe("expansion_ratio_exceeded");
    expect(outcome.totals.expandedBytes).toBeLessThan(MEASURED_RATIO_FLOOR_BYTES + 2 * 1024 * 1024);
  });

  it("refuses an input over the archive limit before reading any of it", async () => {
    const outcome = await readTarStream(chunked(gzip(buildTar(withCommit([]))), 700), SHA, {
      gzip: true,
      inputBytes: SNAPSHOT_LIMITS.maxArchiveBytes + 1,
    });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.refusals[0].reason).toBe("archive_too_large");
    expect(outcome.totals.streamBytes).toBe(0);
  });

  it("does not apply the ratio below the floor, and does above it", async () => {
    const under = await zeroBomb(MEASURED_RATIO_FLOOR_BYTES - 64 * 1024);
    const over = await zeroBomb(MEASURED_RATIO_FLOOR_BYTES + 64 * 1024);
    const accepted = await readTarStream(chunked(under, 64 * 1024), SHA, { gzip: true, inputBytes: under.length });
    expect(accepted.status).toBe("acquired");
    if (accepted.status === "acquired") expect(accepted.rejected.map((entry) => entry.reason)).toEqual(["file_too_large"]);
    const refused = await readTarStream(chunked(over, 64 * 1024), SHA, { gzip: true, inputBytes: over.length });
    expect(refused.status).toBe("blocked");
    if (refused.status === "blocked") expect(refused.refusals[0].reason).toBe("expansion_ratio_exceeded");
  });

  it("refuses a stream that is longer or shorter than the size it was read at", async () => {
    const compressed = gzip(buildTar(withCommit([{ kind: "file", name: "a.ts", data: "a\n" }])));
    for (const inputBytes of [compressed.length - 1, compressed.length + 1]) {
      const outcome = await readTarStream(chunked(compressed, 700), SHA, { gzip: true, inputBytes });
      expect(outcome.status, `stated ${inputBytes}`).toBe("blocked");
      if (outcome.status === "blocked") {
        expect(outcome.refusals[0]).toEqual({ reason: "malformed_input", detail: "The archive changed size while it was read." });
      }
    }
    // Longer than stated is refused as soon as it is, not after reading the rest.
    const long = gzip(buildTar(withCommit([{ kind: "file", name: "a.bin", data: incompressible(50_000, 7) }])));
    const early = await readTarStream(chunked(long, 700), SHA, { gzip: true, inputBytes: 1_000 });
    expect(early.status).toBe("blocked");
    if (early.status === "blocked") expect(early.refusals[0].detail).toBe("The archive changed size while it was read.");
    expect(early.totals.streamBytes).toBeLessThan(long.length);
  });

  it("decides at the limit exactly: the floor, then twelve times the input", () => {
    const small = new SnapshotBudget(true, 1_000);
    small.countStream(1_000);
    small.countExpanded(MEASURED_RATIO_FLOOR_BYTES);
    expect(() => small.countExpanded(1)).toThrow(/expansion_ratio_exceeded/);

    const input = 2_000_000;
    const large = new SnapshotBudget(true, input);
    large.countStream(input);
    large.countExpanded(LIMIT * input);
    expect(() => large.countExpanded(1)).toThrow(/expansion_ratio_exceeded/);
  });

  it("makes the same decision at the end when the input size was not known in advance", () => {
    const budget = new SnapshotBudget(true);
    budget.countStream(1_000);
    budget.countExpanded(MEASURED_RATIO_FLOOR_BYTES + 1);
    const outcome = budget.finish("tar_archive", SHA);
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.refusals[0].reason).toBe("expansion_ratio_exceeded");
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

describe("a clone's own git configuration cannot make the reader run anything", () => {
  // The review finding this guards: a promisor remote with an `ext::` url and
  // `protocol.ext.allow=always` in the clone's local config made git run a
  // shell command while lazily fetching a missing object. The command here
  // only creates a marker file in a temporary directory.
  function hostileClone(missing: "blob" | "commit") {
    const repo = makeFixtureRepo({ "a.ts": "a\n", "b.ts": "b\n" });
    const marker = join(tempDir("rr-internal-marker-"), "RAN");
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo.path, ...args], {
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      }).trim();
    const object = missing === "blob" ? git("rev-parse", "HEAD:b.ts") : repo.commitSha;
    rmSync(join(repo.path, ".git", "objects", object.slice(0, 2), object.slice(2)));
    git("config", "core.repositoryformatversion", "1");
    git("config", "extensions.partialClone", "evil");
    git("config", "remote.evil.promisor", "true");
    git("config", "remote.evil.url", `ext::sh -c touch% ${marker}% >&2`);
    git("config", "protocol.ext.allow", "always");
    return { repo, marker };
  }

  it("refuses the checkout before git reads a single object, and runs nothing", async () => {
    const { repo, marker } = hostileClone("blob");
    const outcome = await readGitCommit({
      checkoutPath: repo.path,
      repositoryRef: FIXTURE_REPOSITORY,
      commitSha: repo.commitSha,
    });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") {
      expect(outcome.refusals[0].reason).toBe("checkout_config_not_allowed");
      expect(outcome.refusals[0].detail).toContain("remote.<name>.promisor");
      expect(outcome.refusals[0].detail).not.toContain("sh -c");
    }
    expect(existsSync(marker)).toBe(false);
  });

  it("does not run it when the dashboard looks up the clone's head", async () => {
    const control = hostileClone("commit");
    spawnSync("git", ["-C", control.repo.path, "rev-parse", "--verify", "--quiet", "HEAD^{commit}"], {
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    expect(existsSync(control.marker), "control: the head lookup reaches the lazy fetch").toBe(true);

    const { repo, marker } = hostileClone("commit");
    expect(await resolveCheckoutHead(repo.path, "main")).toBeNull();
    expect(existsSync(marker)).toBe(false);
  });

  function catFile(repo: { path: string }, env: NodeJS.ProcessEnv): void {
    const blob = execFileSync("git", ["-C", repo.path, "ls-tree", "HEAD", "b.ts"], {
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_ALLOW_PROTOCOL: "none" },
    }).split(/\s+/)[2];
    spawnSync("git", gitArgs(repo.path, ["cat-file", "--batch"]), { env, input: `${blob}\n` });
  }

  function without(env: NodeJS.ProcessEnv, ...names: string[]): NodeJS.ProcessEnv {
    const copy = { ...env };
    for (const name of names) delete copy[name];
    return copy;
  }

  it("control: with neither environment guard, the hostile config does run its command", () => {
    // Without this, the tests below could pass because the attack never fired.
    const { repo, marker } = hostileClone("blob");
    catFile(repo, without(gitEnv(), "GIT_ALLOW_PROTOCOL", "GIT_NO_LAZY_FETCH"));
    expect(existsSync(marker)).toBe(true);
  });

  it("GIT_ALLOW_PROTOCOL alone stops it, on any git version, even where the config check did not run", () => {
    const { repo, marker } = hostileClone("blob");
    catFile(repo, without(gitEnv(), "GIT_NO_LAZY_FETCH"));
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses a clone that borrows objects from another repository", async () => {
    const other = makeFixtureRepo({ "elsewhere.ts": "x\n" });
    const repo = makeFixtureRepo({ "a.ts": "a\n" });
    writeFileSync(join(repo.path, ".git", "objects", "info", "alternates"), `${join(other.path, ".git", "objects")}\n`);
    const outcome = await readGitCommit({ checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha: repo.commitSha });
    expect(outcome.status === "blocked" && outcome.refusals[0].reason).toBe("checkout_config_not_allowed");
  });

  it("accepts a plain clone", async () => {
    const repo = makeFixtureRepo({ "a.ts": "a\n" });
    const outcome = await readGitCommit({ checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha: repo.commitSha });
    expect(outcome.status).toBe("acquired");
    expect(await resolveCheckoutHead(repo.path, "main")).toBe(repo.commitSha);
  });
});

describe("limits stop the reader before it reads, and nothing hides past the end", () => {
  it("refuses a commit with too many files before reading a single blob", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index <= SNAPSHOT_LIMITS.maxFileCount; index += 1) files[`f/${index}.txt`] = "x\n";
    const repo = makeFixtureRepo(files);
    const outcome = await readGitCommit({ checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha: repo.commitSha });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") {
      expect(outcome.refusals[0].reason).toBe("too_many_files");
      expect(outcome.totals.streamBytes).toBe(0);
      expect(outcome.totals.acceptedFileCount).toBe(0);
    }
  }, 120_000);

  it("refuses an entry hidden after the end-of-archive marker", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const hidden = buildTar([{ kind: "file", name: "hidden.ts", data: "secret\n" }]);
    const archive = Buffer.concat([
      buildTar([{ kind: "pax", global: true, records: { comment: sha } }, { kind: "file", name: "a.ts", data: "a\n" }]),
      hidden,
    ]);
    const outcome = await readTarStream(Readable.from([archive]), sha, { gzip: false });
    expect(outcome.status === "blocked" && outcome.refusals[0].detail).toBe("Data followed an end-of-archive marker.");
  });

  it("accepts the zero padding tar writes after the marker", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const archive = Buffer.concat([
      buildTar([{ kind: "pax", global: true, records: { comment: sha } }, { kind: "file", name: "a.ts", data: "a\n" }]),
      Buffer.alloc(10_240, 0),
    ]);
    expect((await readTarStream(Readable.from([archive]), sha, { gzip: false })).status).toBe("acquired");
  });
});

describe("a source lists each path once, however it spells it", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const commit = { kind: "pax" as const, global: true, records: { comment: SHA } };
  const read = (entries: Parameters<typeof buildTar>[0]) =>
    readTarStream(Readable.from([buildTar([commit, ...entries])]), SHA, { gzip: false });
  const refusalOf = async (entries: Parameters<typeof buildTar>[0]) => {
    const outcome = await read(entries);
    return outcome.status === "blocked" ? outcome.refusals[0] : null;
  };

  it("spells a path one way: empty and `.` segments dropped, `..` and absolute paths left for the rules", () => {
    expect(canonicalEntryPath("./a.ts")).toBe("a.ts");
    expect(canonicalEntryPath("././a.ts")).toBe("a.ts");
    expect(canonicalEntryPath("a.ts/")).toBe("a.ts");
    expect(canonicalEntryPath("src//a.ts")).toBe("src/a.ts");
    expect(canonicalEntryPath("src/./a.ts")).toBe("src/a.ts");
    expect(canonicalEntryPath("src/../a.ts")).toBe("src/../a.ts");
    expect(canonicalEntryPath("/etc/passwd")).toBe("/etc/passwd");
    // A drive-qualified path is left as it is, so `C:/.` cannot become an accepted `C:`.
    for (const path of ["C:/.", "C:/", "C:/./", "c:/.", "c:\\x"]) expect(canonicalEntryPath(path)).toBe(path);
  });

  it("does not let canonicalisation turn a refused path into an accepted one", async () => {
    for (const name of ["C:/.", "C:/./", "c:/.", "/./etc/passwd", "a/./../../b"]) {
      const outcome = await read([{ kind: "file", name, data: "x\n" }, { kind: "file", name: "ok.ts", data: "ok\n" }]);
      expect(outcome.status === "acquired" && outcome.files.map((file) => file.path)).toEqual(["ok.ts"]);
    }
  });

  it("refuses a file listed twice", async () => {
    expect(
      await refusalOf([
        { kind: "file", name: "a.ts", data: "a\n" },
        { kind: "file", name: "a.ts", data: "a\n" },
      ]),
    ).toEqual({ reason: "duplicate_entry_path", detail: "The source lists the same path more than once." });
  });

  it.each([
    ["./a.ts", "a.ts"],
    ["a.ts/", "a.ts"],
    ["src//a.ts", "src/a.ts"],
    ["src/./a.ts", "src/a.ts"],
    ["./src//./a.ts", "src/a.ts"],
  ])("refuses %s alongside %s: two spellings of one path", async (first, second) => {
    const refusal = await refusalOf([
      { kind: "file", name: first, data: "a\n" },
      { kind: "file", name: second, data: "a\n" },
    ]);
    expect(refusal?.reason).toBe("duplicate_entry_path");
  });

  it("refuses a pax path that repeats another entry's path", async () => {
    const refusal = await refusalOf([
      { kind: "pax", records: { path: "src/a.ts" } },
      { kind: "file", name: "harmless-looking-name", data: "a\n" },
      { kind: "file", name: "src/a.ts", data: "a\n" },
    ]);
    expect(refusal?.reason).toBe("duplicate_entry_path");
  });

  it("refuses a file that shares its path with a directory", async () => {
    const refusal = await refusalOf([
      { kind: "file", name: "a.ts/", data: "", typeflag: "5" },
      { kind: "file", name: "a.ts", data: "a\n" },
    ]);
    expect(refusal?.reason).toBe("duplicate_entry_path");
  });

  const BOTH = { reason: "duplicate_entry_path", detail: "The source uses one path as both a file and a directory." };
  const TWICE = { reason: "duplicate_entry_path", detail: "The source lists the same path more than once." };

  it.each([
    ["file then a file under it", [["file", "x"], ["file", "x/y.ts"]], BOTH],
    ["a file under it then the file", [["file", "x/y.ts"], ["file", "x"]], BOTH],
    ["a file spelled as a directory, then a file under it", [["file", "src/a.ts/"], ["file", "src/a.ts/inner.ts"]], BOTH],
    ["a file then a directory entry with its path", [["file", "x"], ["dir", "x/"]], BOTH],
    ["a directory entry then a file with its path", [["dir", "x/"], ["file", "x"]], BOTH],
    ["a directory entry listed twice", [["dir", "src/"], ["dir", "src/"]], TWICE],
  ])("refuses %s, and says which", async (_name, pairs, expected) => {
    const entries = (pairs as Array<[string, string]>).map(([kind, name]) =>
      kind === "dir"
        ? { kind: "file" as const, name, data: "", typeflag: "5" }
        : { kind: "file" as const, name, data: "a\n" },
    );
    expect(await refusalOf(entries)).toEqual(expected);
  });

  it("builds at most maxPathDepth ancestors of at most maxPathLength characters, however long the path", () => {
    expect(readableAncestorsOf("a/b/c")).toEqual(["a", "a/b"]);
    expect(readableAncestorsOf("/etc/passwd")).toEqual(["/etc"]);
    expect(readableAncestorsOf("a.ts")).toEqual([]);
    expect(readableAncestorsOf(`${"x".repeat(SNAPSHOT_LIMITS.maxPathLength + 1)}/a.ts`)).toEqual([]);
    const hostile = `z/${"a/".repeat(32_000)}z`;
    const ancestors = readableAncestorsOf(hostile);
    expect(ancestors.length).toBe(SNAPSHOT_LIMITS.maxPathDepth);
    expect(Math.max(...ancestors.map((ancestor) => ancestor.length))).toBeLessThanOrEqual(SNAPSHOT_LIMITS.maxPathLength);
    expect(ancestors[0]).toBe("z");
  });

  it.each([
    ["exactly maxPathLength characters", "f".repeat(SNAPSHOT_LIMITS.maxPathLength)],
    ["exactly maxPathDepth segments", `${"s/".repeat(SNAPSHOT_LIMITS.maxPathDepth - 1)}f`],
    ["a non-ASCII name", "\u{1F600}".repeat(200)],
  ])("refuses a readable file of %s used as a directory too, in either order", async (_name, file) => {
    const alone = await read([{ kind: "pax", records: { path: file } }, { kind: "file", name: "placeholder", data: "x\n" }]);
    expect(alone.status === "acquired" && alone.files.map((entry) => entry.path)).toEqual([file]);
    const fileEntry = [{ kind: "pax" as const, records: { path: file } }, { kind: "file" as const, name: "placeholder", data: "x\n" }];
    for (const under of [
      [{ kind: "pax" as const, records: { path: `${file}/inner.ts` } }, { kind: "file" as const, name: "placeholder", data: "x\n" }],
      [{ kind: "pax" as const, records: { path: `${file}/link.ts` } }, { kind: "file" as const, name: "placeholder", data: "", typeflag: "2" }],
      [{ kind: "pax" as const, records: { path: `${file}/` } }, { kind: "file" as const, name: "placeholder", data: "", typeflag: "5" }],
    ]) {
      expect(await refusalOf([...fileEntry, ...under])).toEqual(BOTH);
      expect(await refusalOf([...under, ...fileEntry])).toEqual(BOTH);
    }
  });

  it("reads an archive of very deep paths without building every prefix, and still finds a conflict within the limits", async () => {
    // Eight distinct 60 KB paths. Building every prefix of each, as an earlier
    // version did, is quadratic and exhausts the heap; the bounded ancestors
    // make this an ordinary read. The deep entries are refused as too long.
    const deep = Array.from({ length: 8 }, (_, index) => ({
      kind: "pax" as const,
      records: { path: `deep${index}/${"a/".repeat(30_000)}z` },
    }));
    const entries = deep.flatMap((pax, index) => [pax, { kind: "file" as const, name: `placeholder-${index}`, data: "x\n" }]);
    const outcome = await read([...entries, { kind: "file", name: "ok.ts", data: "ok\n" }]);
    expect(outcome.status === "acquired" && outcome.files.map((file) => file.path)).toEqual(["ok.ts"]);

    const conflict = await refusalOf([
      { kind: "file", name: "x", data: "x\n" },
      { kind: "pax", records: { path: `x/${"a/".repeat(30_000)}z` } },
      { kind: "file", name: "placeholder", data: "x\n" },
    ]);
    expect(conflict).toEqual(BOTH);
  });

  it("accepts files under a directory entry, in either order", async () => {
    for (const entries of [
      [{ kind: "file" as const, name: "src/", data: "", typeflag: "5" }, { kind: "file" as const, name: "src/a.ts", data: "a\n" }],
      [{ kind: "file" as const, name: "src/a.ts", data: "a\n" }, { kind: "file" as const, name: "src/", data: "", typeflag: "5" }],
    ]) {
      expect((await read(entries)).status).toBe("acquired");
    }
  });

  it("refuses an entry it does not read listed twice", async () => {
    const refusal = await refusalOf([
      { kind: "file", name: "a.ts", data: "a\n" },
      { kind: "file", name: ".env", data: "X=1\n" },
      { kind: "file", name: ".env", data: "X=1\n" },
    ]);
    expect(refusal?.reason).toBe("duplicate_entry_path");
  });

  it("records a single aliased entry under its canonical path", async () => {
    const outcome = await read([{ kind: "file", name: "./src//./a.ts", data: "a\n" }]);
    expect(outcome.status === "acquired" && outcome.files.map((file) => file.path)).toEqual(["src/a.ts"]);
  });

  it.each(["L", "K"])("refuses GNU long-name records (typeflag %s) rather than read an entry under a truncated path", async (typeflag) => {
    const refusal = await refusalOf([
      { kind: "file", name: "././@LongLink", data: "src/a-very-long-name.ts\0", typeflag },
      { kind: "file", name: "src/a-very-long-n", data: "a\n" },
    ]);
    expect(refusal).toEqual({ reason: "malformed_input", detail: "GNU long-name records are not supported; use git archive." });
  });

  it("records a BLOCKED read, promptly and without its text, when a gzip archive's stream fails", async () => {
    const failing = new Readable({
      read() {
        this.destroy(Object.assign(new Error(`EIO while reading src/payments.ts ${FAKE_AWS_KEY}`), { code: "EIO" }));
      },
    });
    const outcome = await Promise.race([
      readTarStream(failing, SHA, { gzip: true }),
      new Promise<"unsettled">((settle) => setTimeout(() => settle("unsettled"), 5_000)),
    ]);
    expect(outcome).not.toBe("unsettled");
    if (outcome !== "unsettled") {
      expect(outcome.status).toBe("blocked");
      if (outcome.status === "blocked") {
        expect(outcome.refusals).toEqual([{ reason: "reader_failed", detail: "The archive reader failed." }]);
        expect(JSON.stringify(outcome)).not.toContain(FAKE_AWS_KEY);
      }
    }
  });

  function hostileTree() {
    const repo = makeFixtureRepo({ "a.ts": "a\n" });
    const env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    };
    const git = (args: string[], input?: Buffer) =>
      execFileSync("git", ["-C", repo.path, ...args], { env, input }).toString("utf8").trim();
    const blob = Buffer.from(git(["rev-parse", "HEAD:a.ts"]), "hex");
    const tree = (...entries: Buffer[]) =>
      git(["hash-object", "-t", "tree", "--literally", "-w", "--stdin"], Buffer.concat(entries));
    const entry = (mode: string, name: string, id: Buffer) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), id]);
    const commit = (root: string) => git(["commit-tree", root, "-m", "hostile"]);
    const read = (commitSha: string) => readGitCommit({ checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha });
    return { git, blob, tree, entry, commit, read };
  }

  it.each([".", "..", "./a.ts", "a.ts/", "x/y.ts", "x//y.ts"])(
    "refuses a git tree with an entry named %j, which git itself refuses, rather than read it under another name",
    async (name) => {
      const t = hostileTree();
      const commitSha = t.commit(t.tree(t.entry("100644", "b.ts", t.blob), t.entry("100644", name, t.blob)));
      const outcome = await t.read(commitSha);
      expect(outcome.status === "blocked" && outcome.refusals[0]).toEqual({
        reason: "malformed_input",
        detail: "The commit's tree holds a name git itself refuses (empty, `.`, `..`, or containing `/`).",
      });
    },
  );

  it("refuses such a name inside a subtree as well", async () => {
    const t = hostileTree();
    const sub = Buffer.from(t.tree(t.entry("100644", "c/d.ts", t.blob)), "hex");
    const outcome = await t.read(t.commit(t.tree(t.entry("40000", "src", sub))));
    expect(outcome.status === "blocked" && outcome.refusals[0].reason).toBe("malformed_input");
  });

  it("records the one such name it does not see: a name holding `/` beside a real subtree of that directory", async () => {
    // Documented in docs/RELEASE-RESCUE-INTERNAL.md. If this starts being
    // refused, the documented limitation is overstated and should be removed.
    const t = hostileTree();
    const sub = Buffer.from(t.tree(t.entry("100644", "z.ts", t.blob)), "hex");
    const outcome = await t.read(t.commit(t.tree(t.entry("40000", "x", sub), t.entry("100644", "x/y.ts", t.blob))));
    expect(outcome.status === "acquired" && outcome.files.map((file) => file.path)).toEqual(["x/y.ts", "x/z.ts"]);
  });

  it("names a path that is not valid UTF-8 exactly, so two such names stay two entries, and reads neither", async () => {
    const t = hostileTree();
    const key = t.git(["hash-object", "-w", "--stdin"], Buffer.from(`k = "${FAKE_AWS_KEY}"\n`));
    const raw = (bytes: number[], id: Buffer) => Buffer.concat([Buffer.from("100644 "), Buffer.from(bytes), Buffer.from([0]), id]);
    const commitSha = t.commit(
      t.tree(
        t.entry("100644", "b.ts", t.blob),
        raw([0x6b, 0xfe, 0x2e, 0x74, 0x73], Buffer.from(key, "hex")),
        raw([0x6b, 0xff, 0x2e, 0x74, 0x73], Buffer.from(key, "hex")),
      ),
    );
    const outcome = await t.read(commitSha);
    expect(outcome.status).toBe("acquired");
    if (outcome.status !== "acquired") return;
    expect(outcome.files.map((file) => file.path)).toEqual(["b.ts"]);
    expect(outcome.rejected.map((entry) => [entry.path, entry.reason])).toEqual([
      ["k\\xfe.ts", "illegal_path_character"],
      ["k\\xff.ts", "illegal_path_character"],
    ]);
  });

  it("writes a backslash in a name the same way, so no spelling can stand for another", () => {
    const listing = (name: Buffer) =>
      Buffer.concat([Buffer.from(`100644 blob ${"a".repeat(40)}       1\t`), name, Buffer.from([0])]);
    expect(parseLsTree(listing(Buffer.from("k\\xff.ts")))?.[0].path).toBe("k\\x5cxff.ts");
    expect(parseLsTree(listing(Buffer.from([0x6b, 0xff, 0x2e, 0x74, 0x73])))?.[0].path).toBe("k\\xff.ts");
    expect(parseLsTree(listing(Buffer.from("caf\u00e9.ts")))?.[0].path).toBe("caf\u00e9.ts");
    // A leading byte-order mark is part of the name, not dropped, or it would be `a.ts`.
    expect(parseLsTree(listing(Buffer.from("\ufeffa.ts")))?.[0].path).toBe("\ufeffa.ts");
  });

  it("refuses a git tree that uses one name for a file and a directory, in either order", async () => {
    const t = hostileTree();
    const sub = Buffer.from(t.tree(t.entry("100644", "y.ts", t.blob)), "hex");
    const treeBesideBlob = t.commit(t.tree(t.entry("40000", "x", sub), t.entry("100644", "x", t.blob)));
    const reversed = await t.read(treeBesideBlob);
    expect(reversed.status === "blocked" && reversed.refusals[0]).toEqual({
      reason: "duplicate_entry_path",
      detail: "The source uses one path as both a file and a directory.",
    });
    const blobBesideTree = t.commit(t.tree(t.entry("100644", "x", t.blob), t.entry("40000", "x", sub)));
    expect(t.git(["ls-tree", "-r", "--name-only", blobBesideTree]).split("\n"), "control: git lists both").toEqual(["x", "x/y.ts"]);
    const outcome = await t.read(blobBesideTree);
    expect(outcome.status === "blocked" && outcome.refusals[0]).toEqual({
      reason: "duplicate_entry_path",
      detail: "The source uses one path as both a file and a directory.",
    });

    const gitlinkBesideTree = t.commit(t.tree(t.entry("160000", "sub", t.blob), t.entry("40000", "sub", sub)));
    const gitlinkOutcome = await t.read(gitlinkBesideTree);
    expect(gitlinkOutcome.status === "blocked" && gitlinkOutcome.refusals[0].reason).toBe("duplicate_entry_path");
  });

  it("refuses a git blob at the depth limit beside a subtree of the same name, in either order", async () => {
    const t = hostileTree();
    const under = Buffer.from(t.tree(t.entry("100644", "y.ts", t.blob)), "hex");
    for (const order of ["blob-first", "tree-first"] as const) {
      const pair =
        order === "blob-first"
          ? [t.entry("100644", "f", t.blob), t.entry("40000", "f", under)]
          : [t.entry("40000", "f", under), t.entry("100644", "f", t.blob)];
      let level = t.tree(...pair);
      for (let depth = 1; depth < SNAPSHOT_LIMITS.maxPathDepth; depth += 1) {
        level = t.tree(t.entry("40000", "s", Buffer.from(level, "hex")));
      }
      const commitSha = t.commit(level);
      const listed = t.git(["ls-tree", "-r", "--name-only", commitSha]).split("\n");
      expect(listed.some((path) => path.split("/").length === SNAPSHOT_LIMITS.maxPathDepth), "control: a blob at the limit").toBe(true);
      const outcome = await t.read(commitSha);
      expect(outcome.status === "blocked" && outcome.refusals[0]).toEqual({
        reason: "duplicate_entry_path",
        detail: "The source uses one path as both a file and a directory.",
      });
    }
  });

  it("refuses a git tree that names one path twice", async () => {
    // `git mktree` refuses this, so the tree object is written byte by byte, as
    // a hostile repository could.
    const repo = makeFixtureRepo({ "a.ts": "a\n" });
    const env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    };
    const git = (args: string[], input?: Buffer) =>
      execFileSync("git", ["-C", repo.path, ...args], { env, input }).toString("utf8").trim();
    const blob = Buffer.from(git(["rev-parse", "HEAD:a.ts"]), "hex");
    const entry = Buffer.concat([Buffer.from("100644 a.ts\0"), blob]);
    const tree = git(["hash-object", "-t", "tree", "--literally", "-w", "--stdin"], Buffer.concat([entry, entry]));
    const commitSha = git(["commit-tree", tree, "-m", "duplicate entry"]);
    expect(git(["ls-tree", "-r", "--name-only", commitSha]).split("\n"), "control: git lists both").toEqual(["a.ts", "a.ts"]);

    const outcome = await readGitCommit({ checkoutPath: repo.path, repositoryRef: FIXTURE_REPOSITORY, commitSha });
    expect(outcome.status === "blocked" && outcome.refusals[0].reason).toBe("duplicate_entry_path");
    expect(outcome.totals.streamBytes).toBe(0);
  });
});
