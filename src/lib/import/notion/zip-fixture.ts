/**
 * Test helpers: small synthetic Notion exports and hand-damaged zips.
 * (Used by the tests only.)
 */
import { strToU8, zipSync, type Zippable } from "fflate";

/** A Notion-style 32-hex id, distinct per `n`. */
export function nid(n: number): string {
  return `${n.toString(16)}`.padStart(32, "a");
}

/** A zip of `files` (text is UTF-8 encoded). */
export function makeZip(files: Record<string, string | Uint8Array>, level: 0 | 6 | 9 = 6): Uint8Array {
  const data: Zippable = {};
  for (const [name, content] of Object.entries(files)) {
    data[name] = [typeof content === "string" ? strToU8(content) : content, { level }];
  }
  return zipSync(data);
}

function centralOffsets(zip: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 4 <= zip.length; i += 1) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x01 && zip[i + 3] === 0x02) out.push(i);
  }
  return out;
}

function writeU32(b: Uint8Array, at: number, value: number) {
  b[at] = value & 0xff;
  b[at + 1] = (value >>> 8) & 0xff;
  b[at + 2] = (value >>> 16) & 0xff;
  b[at + 3] = (value >>> 24) & 0xff;
}

/** A copy whose central directory declares `size` as the first entry's uncompressed size. */
export function withDeclaredSize(zip: Uint8Array, size: number): Uint8Array {
  const copy = zip.slice();
  const [first] = centralOffsets(copy);
  writeU32(copy, first + 24, size);
  return copy;
}

/** A copy whose first entry is flagged as encrypted. */
export function withEncryptedFlag(zip: Uint8Array): Uint8Array {
  const copy = zip.slice();
  const [first] = centralOffsets(copy);
  copy[first + 8] |= 0x1;
  return copy;
}
