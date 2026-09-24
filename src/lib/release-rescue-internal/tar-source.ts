import { createHash, type Hash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createGunzip } from "node:zlib";
import type { Readable } from "node:stream";
import { commitShaSchema } from "@/lib/release-rescue-intake";
import {
  SnapshotBudget,
  SnapshotRefused,
  blobId,
  blockedBeforeReading,
  exactText,
  type SnapshotOutcome,
} from "@/lib/release-rescue-internal/snapshot";
import { SNAPSHOT_LIMITS, type SnapshotEntryType } from "@/lib/release-rescue-snapshot-limits";

// Reads a tar archive produced by `git archive`, plain or gzip-compressed,
// without extracting anything to disk.
//
// This is the path for a snapshot supplied as a file rather than read from a
// checkout. Every limit is enforced on what arrives:
//
// - the compressed bytes are counted as they are read, against `maxArchiveBytes`;
// - the decompressed bytes are counted as they are produced, against
//   `maxTotalBytes` and the expansion ratio over the file's whole size (see
//   `SnapshotBudget`), so a decompression bomb stops near the line rather than
//   after it has filled memory, and the decision does not depend on the order
//   of the entries or the size of the reads;
// - each header's size is the size the parser then consumes, and a stream that
//   ends inside an entry is malformed, never "probably fine".
//
// Symlinks, hard links, devices and anything else that is not a regular file or
// a directory are rejected by the shared snapshot rules and their content is
// skipped unread. Paths come from the pax `path` record when present, so a pax
// header cannot smuggle a traversal past a harmless-looking ustar name. Every
// entry, directories included, claims its canonical path with the budget, so an
// archive that lists one path twice, however it spells it, is refused.
//
// The archive must say which commit it is. `git archive` records the commit in
// a global pax header; an archive whose recorded commit does not match the pin
// is refused, so the review cannot quietly be of a different tree.

const BLOCK = 512;
const MAX_PAX_BYTES = 64 * 1024;

type Header = {
  name: string;
  size: number;
  typeflag: string;
  /** The ustar link target, as bytes: a symlink's target is committed content. */
  linkname: Buffer;
};

function parseOctal(field: Buffer): number | null {
  // GNU base-256 sizes (high bit set) are refused rather than decoded: no source
  // file this review reads is large enough to need them.
  if (field[0] & 0x80) return null;
  const nul = field.indexOf(0);
  const text = field.subarray(0, nul < 0 ? field.length : nul).toString("ascii").trim();
  if (text.length === 0) return 0;
  if (!/^[0-7]+$/.test(text)) return null;
  const value = Number.parseInt(text, 8);
  return Number.isSafeInteger(value) ? value : null;
}

function checksumMatches(block: Buffer): boolean {
  const stored = parseOctal(block.subarray(148, 156));
  if (stored === null) return false;
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : block[index];
  }
  return sum === stored;
}

function cBytes(field: Buffer): Buffer {
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end);
}

export function parseHeader(block: Buffer): Header | null {
  if (!checksumMatches(block)) return null;
  const size = parseOctal(block.subarray(124, 136));
  if (size === null) return null;
  const typeflag = String.fromCharCode(block[156] || 0x30);
  const name = cBytes(block.subarray(0, 100));
  const magic = block.subarray(257, 263).toString("ascii");
  const prefix = magic.startsWith("ustar") ? cBytes(block.subarray(345, 500)) : Buffer.alloc(0);
  const full = prefix.length > 0 ? Buffer.concat([prefix, Buffer.from("/"), name]) : name;
  return { name: exactText(full), size, typeflag, linkname: Buffer.from(cBytes(block.subarray(157, 257))) };
}

/**
 * Parses pax records (`<len> <key>=<value>\n`), keeping each value as bytes.
 * Null when malformed: the length must be plain decimal digits with no leading
 * zero, and must end exactly at the record's newline.
 */
export function parsePax(data: Buffer): Map<string, Buffer> | null {
  const records = new Map<string, Buffer>();
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) return null;
    const digits = data.subarray(offset, space).toString("latin1");
    if (!/^[1-9][0-9]{0,9}$/.test(digits)) return null;
    const length = Number(digits);
    if (offset + length > data.length || data[offset + length - 1] !== 0x0a) return null;
    const record = data.subarray(space + 1, offset + length - 1);
    const equals = record.indexOf(0x3d);
    if (equals <= 0) return null;
    records.set(record.subarray(0, equals).toString("latin1"), Buffer.from(record.subarray(equals + 1)));
    offset += length;
  }
  return records;
}

function entryTypeForFlag(flag: string): SnapshotEntryType {
  if (flag === "0" || flag === "7") return "file";
  if (flag === "5") return "directory";
  if (flag === "2") return "symlink";
  return "other";
}

/**
 * The tar parser, over a stream of already-decompressed bytes.
 *
 * `onBytes` is called for every chunk so the caller's budget can count it
 * before the parser acts on it.
 */
async function parseTar(
  chunks: AsyncIterable<Buffer>,
  budget: SnapshotBudget,
  countDecompressed: (bytes: number) => void,
): Promise<{ recordedCommit: string | null }> {
  let buffered: Buffer = Buffer.alloc(0);
  let recordedCommit: string | null = null;
  let pending: Map<string, Buffer> | null = null;
  let zeroBlocks = 0;
  let ended = false;

  type State =
    | { kind: "header" }
    | {
        kind: "data";
        remaining: number;
        padding: number;
        collect: Buffer[] | null;
        hash: Hash | null;
        onDone: (data: Buffer) => void;
      };
  let state: State = { kind: "header" };

  const step = (): boolean => {
    if (state.kind === "header") {
      if (buffered.length < BLOCK) return false;
      const block = buffered.subarray(0, BLOCK);
      buffered = buffered.subarray(BLOCK);
      if (block.every((byte) => byte === 0)) {
        zeroBlocks += 1;
        if (zeroBlocks >= 2) ended = true;
        return true;
      }
      if (zeroBlocks > 0) throw new SnapshotRefused("malformed_input", "Data followed an end-of-archive marker.");
      const header = parseHeader(block);
      if (!header) throw new SnapshotRefused("malformed_input", "A tar header failed its checksum or size field.");
      const padding = (BLOCK - (header.size % BLOCK)) % BLOCK;

      if (header.typeflag === "x" || header.typeflag === "g") {
        if (header.size > MAX_PAX_BYTES) throw new SnapshotRefused("malformed_input", "A pax header is oversized.");
        state = {
          kind: "data",
          remaining: header.size,
          padding,
          collect: [],
          hash: null,
          onDone: (data) => {
            const records = parsePax(data);
            if (!records) throw new SnapshotRefused("malformed_input", "A pax header is malformed.");
            if (header.typeflag === "g") {
              const comment = records.get("comment");
              if (comment !== undefined) recordedCommit = exactText(comment);
            } else {
              pending = records;
            }
          },
        };
        return true;
      }

      // GNU long-name records name the NEXT entry, and this reader does not
      // apply them, so that entry's path would be a truncated one. `git archive`
      // never writes them; it uses pax.
      if (header.typeflag === "L" || header.typeflag === "K") {
        throw new SnapshotRefused("malformed_input", "GNU long-name records are not supported; use git archive.");
      }
      const pax = pending;
      pending = null;
      // The budget canonicalises the path (`./a.ts`, `a.ts/`, `src//a.ts` are
      // one path) and refuses a second claim on it.
      const paxPath = pax?.get("path");
      const path = paxPath !== undefined ? exactText(paxPath) : header.name;
      const paxSize = pax?.get("size")?.toString("latin1");
      if (paxSize !== undefined && !/^[0-9]{1,15}$/.test(paxSize)) {
        throw new SnapshotRefused("malformed_input", "An entry size is malformed.");
      }
      const size = paxSize !== undefined ? Number(paxSize) : header.size;
      if (!Number.isSafeInteger(size) || size < 0) throw new SnapshotRefused("malformed_input", "An entry size is malformed.");
      const dataPadding = (BLOCK - (size % BLOCK)) % BLOCK;
      const type = entryTypeForFlag(header.typeflag);

      // Only a file holds data. `git archive` writes every other entry with
      // none, and data on one would be skipped unread while the archive still
      // matched the commit, so it is refused.
      if (type !== "file" && size > 0) {
        throw new SnapshotRefused(
          "malformed_input",
          type === "directory"
            ? "A directory entry carries data."
            : type === "symlink"
              ? "A symlink entry carries data."
              : "A link or special entry carries data.",
        );
      }

      if (type === "directory") {
        // A directory holds no content and the files under it are judged on
        // their own paths, so it is skipped rather than recorded as a
        // rejection. It still claims its path.
        budget.claimPath(path, "directory");
        state = { kind: "data", remaining: 0, padding: 0, collect: null, hash: null, onDone: () => undefined };
        return true;
      }
      const readAs = budget.admit({ path, type, declaredBytes: type === "file" ? size : 0 });
      if (type === "symlink") {
        // Not followed and not scanned, but compared: its target is a blob in the commit.
        budget.recordBlobId(path, blobId(pax?.get("linkpath") ?? header.linkname));
      }
      // A file's content is hashed as it streams, read or not, so an unread
      // file is compared with the commit as exactly as a read one.
      const hash = type === "file" ? createHash("sha1").update(`blob ${size}\0`) : null;
      state = {
        kind: "data",
        remaining: size,
        padding: dataPadding,
        collect: readAs !== null ? [] : null,
        hash,
        onDone: (data) => {
          if (hash) budget.recordBlobId(path, hash.digest("hex"));
          if (readAs !== null) budget.accept(readAs, size, data);
        },
      };
      return true;
    }

    // Data, then padding.
    if (state.remaining > 0) {
      if (buffered.length === 0) return false;
      const take = Math.min(state.remaining, buffered.length);
      if (state.collect) state.collect.push(Buffer.from(buffered.subarray(0, take)));
      state.hash?.update(buffered.subarray(0, take));
      buffered = buffered.subarray(take);
      state.remaining -= take;
      if (state.remaining > 0) return false;
    }
    if (state.padding > 0) {
      if (buffered.length === 0) return false;
      const take = Math.min(state.padding, buffered.length);
      buffered = buffered.subarray(take);
      state.padding -= take;
      if (state.padding > 0) return false;
    }
    const done = state;
    state = { kind: "header" };
    done.onDone(done.collect ? Buffer.concat(done.collect) : Buffer.alloc(0));
    return true;
  };

  // After the end-of-archive marker only zero padding may follow (tar pads to
  // its record size). Anything else is an entry hidden past the end, refused
  // rather than silently dropped.
  const assertOnlyPadding = (bytes: Buffer) => {
    if (!bytes.every((byte) => byte === 0)) {
      throw new SnapshotRefused("malformed_input", "Data followed an end-of-archive marker.");
    }
  };
  for await (const chunk of chunks) {
    countDecompressed(chunk.length);
    if (ended) {
      assertOnlyPadding(chunk);
      continue;
    }
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
    while (!ended && step()) {
      // keep parsing what is buffered
    }
    if (ended) assertOnlyPadding(buffered);
  }
  if (!ended || state.kind !== "header") {
    throw new SnapshotRefused("malformed_input", "The archive ended before its end-of-archive marker.");
  }
  return { recordedCommit };
}

export type TarSourceRequest = {
  archivePath: string;
  commitSha: string;
};

/**
 * Reads a tar or tar.gz from a readable stream. Exposed for tests.
 *
 * `inputBytes` is the stream's total size when it is known in advance, as a
 * file's is. It lets the expansion ratio stop a bomb as it expands, and the
 * stream must then be exactly that long.
 */
export async function readTarStream(
  input: Readable,
  commitSha: string,
  options: { gzip: boolean; inputBytes?: number },
): Promise<SnapshotOutcome> {
  const source = "tar_archive" as const;
  const sha = commitShaSchema.safeParse(commitSha);
  if (!sha.success) {
    input.destroy();
    return blockedBeforeReading(source, null, "commit_sha_malformed", "A full 40-character lowercase commit sha is required.");
  }
  const budget = new SnapshotBudget(options.gzip, options.inputBytes);
  if (options.inputBytes !== undefined && options.inputBytes > SNAPSHOT_LIMITS.maxArchiveBytes) {
    input.destroy();
    return budget.blocked(source, sha.data, {
      reason: "archive_too_large",
      detail: `The archive is ${options.inputBytes} bytes, over the ${SNAPSHOT_LIMITS.maxArchiveBytes} limit.`,
    });
  }
  try {
    let stream: AsyncIterable<Buffer>;
    if (options.gzip) {
      const gunzip = createGunzip();
      input.on("data", (chunk: Buffer) => {
        try {
          budget.countStream(chunk.length);
        } catch (error) {
          input.destroy();
          gunzip.destroy(error as Error);
        }
      });
      // `pipe` does not pass a read error on, so a failing file would leave the
      // gunzip stream, and the run, waiting forever. Forward it, so the loop
      // below rejects and the catch records the run as BLOCKED.
      input.on("error", (error) => gunzip.destroy(error));
      input.pipe(gunzip);
      stream = gunzip;
    } else {
      stream = input;
    }
    const { recordedCommit } = await parseTar(
      stream,
      budget,
      options.gzip ? (bytes) => budget.countExpanded(bytes) : (bytes) => budget.countStream(bytes),
    );
    if (recordedCommit !== sha.data) {
      return budget.blocked(source, sha.data, {
        reason: "archive_commit_unverified",
        detail: "The archive does not record the pinned commit, so the review cannot say which tree it read.",
      });
    }
    return budget.finish(source, sha.data);
  } catch (error) {
    input.destroy();
    if (error instanceof SnapshotRefused) return budget.blocked(source, sha.data, error.refusal);
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "Z_DATA_ERROR" || code === "Z_BUF_ERROR") {
      return budget.blocked(source, sha.data, { reason: "malformed_input", detail: "The archive is not valid gzip." });
    }
    return budget.blocked(source, sha.data, { reason: "reader_failed", detail: "The archive reader failed." });
  }
}

export async function readTarArchive(request: TarSourceRequest): Promise<SnapshotOutcome> {
  if (!isAbsolute(request.archivePath) || !existsSync(request.archivePath) || !statSync(request.archivePath).isFile()) {
    return blockedBeforeReading("tar_archive", null, "checkout_not_configured", "The archive path must be an existing absolute file.");
  }
  // The name decides the format: `.tar.gz` or `.tgz` is read as gzip, anything
  // else as a plain tar.
  const gzip = /\.(?:tgz|tar\.gz)$/i.test(request.archivePath);
  const inputBytes = statSync(request.archivePath).size;
  return readTarStream(createReadStream(request.archivePath), request.commitSha, { gzip, inputBytes });
}
