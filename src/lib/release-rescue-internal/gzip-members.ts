import { createInflateRaw, crc32 } from "node:zlib";
import { SnapshotRefused } from "@/lib/release-rescue-internal/snapshot";

// A gzip reader that decompresses member by member (RFC 1952) and says which
// input bytes were framing rather than compressed data.
//
// `createGunzip` reads the same members but reports only the bytes it consumed
// in total, so a header padded with a 12 MB comment, or a run of empty members,
// counted as compressed data and raised the expansion ratio's threshold until a
// bomb behind it was accepted. Here each member's header is parsed by hand and
// its deflate data goes to `createInflateRaw`, which stops at the data's end, so
// the header, optional fields included, and the 8-byte trailer are counted as
// framing (`onFraming`) exactly, however the input is split into reads.
//
// What gunzip checks is checked here too, and refused as "The archive is not
// valid gzip.": the magic bytes, the compression method, reserved flag bits,
// the header CRC when present, and each member's CRC-32 and length. As with
// gunzip, bytes after a member that begin with a zero byte end the gzip data;
// they are read to the end of the input and reported through `trailing`, for
// the caller to refuse. Any other bytes are read as the next member.
//
// Deflate data that decodes to nothing (an empty stored or fixed block) is
// compressed data, not framing, and is counted as such. That is a recorded
// residual: see docs/RELEASE-RESCUE-INTERNAL.md.

const NOT_GZIP = "The archive is not valid gzip.";
const notGzip = () => new SnapshotRefused("malformed_input", NOT_GZIP);

/**
 * The most members a gzip input may have. `git archive` writes one. Each
 * member costs a fresh inflate stream, about 0.15 ms, so 12 MB of 20-byte empty
 * members took over a minute to read; this bounds that at well under a second.
 * It is above the 3,052 members a BGZF file of 64 KiB blocks needs to reach
 * `maxTotalBytes`, so a blocked gzip that is otherwise within the limits is
 * read. Beside `SNAPSHOT_LIMITS`, not in it, because that is the versioned
 * contract the product's schema stores.
 */
export const MAX_GZIP_MEMBERS = 4096;

const TRAILER_BYTES = 8;
const FLAG_HCRC = 0x02;
const FLAG_EXTRA = 0x04;
const FLAG_NAME = 0x08;
const FLAG_COMMENT = 0x10;
const FLAG_RESERVED = 0xe0;

/** Pulls bytes from an input, and takes back the ones a step did not use. */
class ByteReader {
  private readonly chunks: AsyncIterator<Buffer>;
  private held: Buffer | null = null;
  private done = false;

  constructor(chunks: AsyncIterator<Buffer>) {
    this.chunks = chunks;
  }

  /** The next bytes available, or null at the end of the input. */
  async next(): Promise<Buffer | null> {
    if (this.held) {
      const held = this.held;
      this.held = null;
      return held;
    }
    if (this.done) return null;
    const result = await this.chunks.next();
    if (result.done) {
      this.done = true;
      return null;
    }
    return result.value;
  }

  unread(bytes: Buffer): void {
    if (bytes.length === 0) return;
    this.held = this.held ? Buffer.concat([bytes, this.held]) : bytes;
  }

  /** Exactly `length` bytes; the input ending first is invalid gzip. */
  async take(length: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    let have = 0;
    while (have < length) {
      const chunk = await this.next();
      if (chunk === null) throw notGzip();
      const want = length - have;
      if (chunk.length > want) this.unread(chunk.subarray(want));
      const part = chunk.subarray(0, want);
      parts.push(part);
      have += part.length;
    }
    return Buffer.concat(parts, length);
  }

  /** Reads through the next zero byte without holding what it passes. */
  async skipThroughZero(crc: number): Promise<{ length: number; crc: number }> {
    let length = 0;
    for (;;) {
      const chunk = await this.next();
      if (chunk === null) throw notGzip();
      const zero = chunk.indexOf(0);
      const part = zero < 0 ? chunk : chunk.subarray(0, zero + 1);
      crc = crc32(part, crc);
      length += part.length;
      if (zero >= 0) {
        this.unread(chunk.subarray(zero + 1));
        return { length, crc };
      }
    }
  }
}

/** Reads one member header and returns its length in bytes. */
async function readHeader(reader: ByteReader): Promise<number> {
  const fixed = await reader.take(10);
  if (fixed[0] !== 0x1f || fixed[1] !== 0x8b || fixed[2] !== 8 || (fixed[3] & FLAG_RESERVED) !== 0) throw notGzip();
  const flags = fixed[3];
  let length = fixed.length;
  let crc = crc32(fixed);
  if (flags & FLAG_EXTRA) {
    const size = await reader.take(2);
    const extra = await reader.take(size.readUInt16LE(0));
    crc = crc32(extra, crc32(size, crc));
    length += size.length + extra.length;
  }
  for (const flag of [FLAG_NAME, FLAG_COMMENT]) {
    if (!(flags & flag)) continue;
    const field = await reader.skipThroughZero(crc);
    crc = field.crc;
    length += field.length;
  }
  if (flags & FLAG_HCRC) {
    const stored = await reader.take(2);
    if (stored.readUInt16LE(0) !== (crc & 0xffff)) throw notGzip();
    length += stored.length;
  }
  return length;
}

export type GzipTrailing = { bytes: boolean };

/**
 * The decompressed bytes of every member of a gzip input, in order.
 *
 * `onFraming` is called with each member's framing, its header's length plus
 * its 8-byte trailer, before its data is read. `trailing.bytes` is set when bytes
 * beginning with a zero byte followed the last member; they have then been
 * read to the end of the input.
 */
export async function* gunzipMembers(
  chunks: AsyncIterable<Buffer>,
  onFraming: (bytes: number) => void,
  trailing: GzipTrailing,
): AsyncGenerator<Buffer, void, undefined> {
  const reader = new ByteReader(chunks[Symbol.asyncIterator]());
  for (let members = 1; ; members += 1) {
    if (members > MAX_GZIP_MEMBERS) {
      throw new SnapshotRefused("malformed_input", `The archive has more than ${MAX_GZIP_MEMBERS} gzip members.`);
    }
    // The trailer is counted with the header: a member without one is not
    // valid gzip, so the compressed data is never more than what is left.
    onFraming((await readHeader(reader)) + TRAILER_BYTES);

    // The deflate data. Each chunk is written only once the previous one has
    // been processed, so when the data ends inside a chunk, the bytes zlib did
    // not consume are that chunk's tail, and are given back to the reader.
    const inflate = createInflateRaw();
    let fed = 0;
    const feeding = (async () => {
      for (;;) {
        const chunk = await reader.next();
        if (chunk === null) {
          inflate.end();
          return;
        }
        fed += chunk.length;
        await new Promise<void>((resolve, reject) => {
          inflate.write(chunk, (error) => (error ? reject(error) : resolve()));
        });
        const unused = fed - inflate.bytesWritten;
        if (unused > 0) {
          reader.unread(chunk.subarray(chunk.length - unused));
          return;
        }
      }
    })();
    // An input that fails (a read error, or a budget refusal as it is
    // counted) ends the inflate stream with that error, so the loop below
    // rejects instead of waiting for data that will not come.
    feeding.catch((error: unknown) => inflate.destroy(error as Error));

    let crc = 0;
    let size = 0;
    try {
      for await (const piece of inflate as AsyncIterable<Buffer>) {
        crc = crc32(piece, crc);
        size += piece.length;
        yield piece;
      }
      await feeding;
    } finally {
      inflate.destroy();
    }

    const trailer = await reader.take(TRAILER_BYTES);
    if (trailer.readUInt32LE(0) !== crc >>> 0 || trailer.readUInt32LE(4) !== size % 2 ** 32) throw notGzip();

    const next = await reader.next();
    if (next === null) return;
    reader.unread(next);
    if (next[0] === 0) {
      while ((await reader.next()) !== null) {
        // read to the end, so the input's size is measured whole
      }
      trailing.bytes = true;
      return;
    }
  }
}
