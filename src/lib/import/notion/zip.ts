/**
 * Reading a Notion export zip safely, in process.
 *
 * The upload is untrusted, so nothing in it is believed until measured:
 * - The central directory is read first and every entry checked before any
 *   byte is inflated: how many entries there are (all archives together), that
 *   no name leaves the archive (absolute paths, drive letters, ".."), that no
 *   entry is encrypted, and that the declared sizes stay within the total and
 *   do not claim a ratio only a decompression bomb has.
 * - Inflating never trusts the declared size either: output is counted as it
 *   is produced (in small steps, so one step cannot balloon) and stopped the
 *   moment it passes the entry's declared size or the archive-wide budget.
 * - Zips at the root of the export (Notion splits large exports into
 *   "…-Part-1.zip", "…-Part-2.zip" inside one zip) are opened up to
 *   `maxDepth`, sharing every budget with the outer archive. Zips elsewhere
 *   are a student's attachments and are not opened.
 * - Nothing is ever written to disk, so paths only name entries in memory.
 *
 * Errors carry a code (NotionImportError) and never quote file contents.
 */
import { Inflate } from "fflate";
import { NotionImportError, type NotionImportLimits, type SkipLog } from "./limits";
import { pathParts, safeEntryPath } from "./names";

/** Inflate this much compressed input per step (at most ~1 MB of output each). */
const INFLATE_STEP = 1024;

export interface ArchiveFile {
  /** Path inside the export ("/"-separated, safe). */
  path: string;
  /** Declared uncompressed size. */
  size: number;
  /** The file's bytes (inflated on demand, counted against the shared budget). */
  read(): Uint8Array;
}

interface Budget {
  entries: number;
  declared: number;
  inflated: number;
  readonly limits: NotionImportLimits;
  readonly deadline: number;
}

export interface OpenArchiveOptions {
  limits: NotionImportLimits;
  /** Epoch ms after which reading stops with "timeout". */
  deadline: number;
  skip: SkipLog;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function u16(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8);
}
function u32(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}
/** A little-endian 64-bit value as a number (exact below 2^53, which is all a 25 MB upload can need). */
function u64(b: Uint8Array, at: number): number {
  return u32(b, at) + u32(b, at + 4) * 0x1_0000_0000;
}

/** True when the bytes start like a zip (a local file header or an empty archive). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

interface Directory {
  count: number;
  offset: number;
  size: number;
}

function findDirectory(bytes: Uint8Array): Directory {
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let at = bytes.length - 22; at >= min; at -= 1) {
    if (u32(bytes, at) !== SIG_EOCD) continue;
    const commentLength = u16(bytes, at + 20);
    if (at + 22 + commentLength > bytes.length) continue;
    if (u16(bytes, at + 4) !== 0 || u16(bytes, at + 6) !== 0) {
      throw new NotionImportError("corrupt", "multi-disk archive");
    }
    let count = u16(bytes, at + 10);
    let size = u32(bytes, at + 12);
    let offset = u32(bytes, at + 16);
    if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
      const locator = at - 20;
      if (locator < 0 || u32(bytes, locator) !== SIG_ZIP64_LOCATOR) {
        throw new NotionImportError("corrupt", "zip64 locator missing");
      }
      const record = u64(bytes, locator + 8);
      if (record + 56 > bytes.length || u32(bytes, record) !== SIG_ZIP64_EOCD) {
        throw new NotionImportError("corrupt", "zip64 record missing");
      }
      count = u64(bytes, record + 32);
      size = u64(bytes, record + 40);
      offset = u64(bytes, record + 48);
    }
    if (offset + size > bytes.length) throw new NotionImportError("corrupt", "directory out of range");
    return { count, offset, size };
  }
  throw new NotionImportError("not_zip");
}

interface CentralEntry {
  name: string;
  flags: number;
  method: number;
  compressed: number;
  size: number;
  localOffset: number;
}

const utf8 = new TextDecoder("utf-8");

function readCentral(bytes: Uint8Array, dir: Directory): CentralEntry[] {
  const entries: CentralEntry[] = [];
  let at = dir.offset;
  const end = dir.offset + dir.size;
  for (let i = 0; i < dir.count; i += 1) {
    if (at + 46 > end || u32(bytes, at) !== SIG_CENTRAL) {
      throw new NotionImportError("corrupt", "bad directory entry");
    }
    const flags = u16(bytes, at + 8);
    const method = u16(bytes, at + 10);
    let compressed = u32(bytes, at + 20);
    let size = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    let localOffset = u32(bytes, at + 42);
    const nameStart = at + 46;
    const extraStart = nameStart + nameLength;
    const next = extraStart + extraLength + commentLength;
    if (next > end) throw new NotionImportError("corrupt", "directory entry out of range");
    // Notion and every current tool write UTF-8 names (flag 11 or not).
    const name = utf8.decode(bytes.subarray(nameStart, extraStart));
    if (size === 0xffffffff || compressed === 0xffffffff || localOffset === 0xffffffff) {
      // Zip64 extended information: the 64-bit values of the fields that
      // overflowed, in this order.
      let e = extraStart;
      const extraEnd = extraStart + extraLength;
      let found = false;
      while (e + 4 <= extraEnd) {
        const id = u16(bytes, e);
        const length = u16(bytes, e + 2);
        if (id === 0x0001) {
          let p = e + 4;
          const stop = Math.min(extraEnd, p + length);
          if (size === 0xffffffff && p + 8 <= stop) {
            size = u64(bytes, p);
            p += 8;
          }
          if (compressed === 0xffffffff && p + 8 <= stop) {
            compressed = u64(bytes, p);
            p += 8;
          }
          if (localOffset === 0xffffffff && p + 8 <= stop) localOffset = u64(bytes, p);
          found = true;
          break;
        }
        e += 4 + length;
      }
      if (!found) throw new NotionImportError("corrupt", "zip64 sizes missing");
    }
    entries.push({ name, flags, method, compressed, size, localOffset });
    at = next;
  }
  return entries;
}

function checkDeadline(budget: Budget): void {
  if (Date.now() > budget.deadline) throw new NotionImportError("timeout");
}

/** The entry's raw (still compressed) bytes, after checking its local header. */
function rawData(bytes: Uint8Array, entry: CentralEntry): Uint8Array {
  const at = entry.localOffset;
  if (at + 30 > bytes.length || u32(bytes, at) !== SIG_LOCAL) {
    throw new NotionImportError("corrupt", "bad local header");
  }
  const start = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28);
  const end = start + entry.compressed;
  if (end > bytes.length) throw new NotionImportError("corrupt", "entry out of range");
  return bytes.subarray(start, end);
}

/** Inflate one entry, never producing more than its declared size or the shared budget. */
function inflateEntry(bytes: Uint8Array, entry: CentralEntry, budget: Budget): Uint8Array {
  checkDeadline(budget);
  const raw = rawData(bytes, entry);
  const room = budget.limits.maxTotalBytes - budget.inflated;
  if (entry.size > room) throw new NotionImportError("too_large", "archive expands beyond the limit");
  if (entry.method === 0) {
    if (raw.length !== entry.size) throw new NotionImportError("corrupt", "stored size mismatch");
    budget.inflated += raw.length;
    return raw;
  }
  if (entry.method !== 8) throw new NotionImportError("corrupt", "unsupported compression");

  const out = new Uint8Array(entry.size);
  let produced = 0;
  let overflow = false;
  let ended = false;
  const inflate = new Inflate((chunk, final) => {
    if (produced + chunk.length > entry.size) {
      overflow = true;
      return;
    }
    out.set(chunk, produced);
    produced += chunk.length;
    if (final) ended = true;
  });
  try {
    for (let at = 0; at < raw.length && !overflow && !ended; at += INFLATE_STEP) {
      const stop = Math.min(at + INFLATE_STEP, raw.length);
      inflate.push(raw.subarray(at, stop), stop === raw.length);
      if ((at / INFLATE_STEP) % 256 === 0) checkDeadline(budget);
    }
  } catch (error) {
    if (error instanceof NotionImportError) throw error;
    if (!overflow) throw new NotionImportError("corrupt", "invalid deflate data");
  }
  // Output past the declared size: the directory lies about the entry.
  if (overflow) throw new NotionImportError("unsafe", "entry larger than declared");
  if (produced !== entry.size) throw new NotionImportError("corrupt", "entry shorter than declared");
  budget.inflated += produced;
  return out;
}

function openLevel(
  bytes: Uint8Array,
  depth: number,
  budget: Budget,
  skip: SkipLog,
  out: ArchiveFile[],
  seen: Set<string>,
): void {
  checkDeadline(budget);
  const { limits } = budget;
  const dir = findDirectory(bytes);
  if (budget.entries + dir.count > limits.maxEntries) {
    throw new NotionImportError("too_many_files", `more than ${limits.maxEntries} entries`);
  }
  budget.entries += dir.count;
  const entries = readCentral(bytes, dir);

  // Everything is checked before anything is inflated.
  const files: { path: string; entry: CentralEntry }[] = [];
  for (const entry of entries) {
    const path = safeEntryPath(entry.name, limits.maxPathLength);
    if (path === "unsafe") throw new NotionImportError("unsafe", "entry path leaves the archive");
    if (path === null) continue;
    if (entry.flags & 0x1) throw new NotionImportError("encrypted");
    budget.declared += entry.size;
    if (budget.declared > limits.maxTotalBytes) {
      throw new NotionImportError("too_large", "archive expands beyond the limit");
    }
    if (entry.size >= limits.ratioMinBytes && entry.size > Math.max(1, entry.compressed) * limits.maxRatio) {
      throw new NotionImportError("unsafe", "compression ratio of a decompression bomb");
    }
    files.push({ path, entry });
  }

  for (const { path, entry } of files) {
    const { dir: folder, ext } = pathParts(path);
    if (ext === "zip" && folder === "") {
      if (depth >= limits.maxDepth) {
        skip.add("nested_zip", path);
        continue;
      }
      const inner = inflateEntry(bytes, entry, budget);
      openLevel(inner, depth + 1, budget, skip, out, seen);
      continue;
    }
    // A path two parts both hold (a split export repeats its folders): the first wins.
    if (seen.has(path)) continue;
    seen.add(path);
    let cached: Uint8Array | null = null;
    out.push({
      path,
      size: entry.size,
      read: () => (cached ??= inflateEntry(bytes, entry, budget)),
    });
  }
}

/**
 * The files of an export (nested part zips opened and merged), each readable
 * on demand. Throws NotionImportError for an archive that must be refused.
 */
export function openArchive(bytes: Uint8Array, options: OpenArchiveOptions): ArchiveFile[] {
  const { limits, deadline, skip } = options;
  if (bytes.length > limits.maxUploadBytes) throw new NotionImportError("too_large", "upload over the limit");
  if (!looksLikeZip(bytes)) throw new NotionImportError("not_zip");
  const budget: Budget = { entries: 0, declared: 0, inflated: 0, limits, deadline };
  const out: ArchiveFile[] = [];
  openLevel(bytes, 1, budget, skip, out, new Set());
  return out;
}
