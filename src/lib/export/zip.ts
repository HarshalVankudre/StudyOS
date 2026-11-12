/**
 * Workspace → .zip: every page as Markdown and every database as CSV, plus an
 * index.md listing them. Runs in the browser (fflate is small and sync), so
 * the export includes edits that are not saved yet and needs no server.
 *
 *   <Workspace name>/index.md
 *   <Workspace name>/pages/01 Dashboard.md
 *   <Workspace name>/databases/Assignments.csv
 */
import { strToU8, zipSync, type Zippable } from "fflate";
import type { Workspace } from "@/lib/workspace/types";
import { databaseToCsv } from "./csv";
import { pageToMarkdown, type MarkdownOptions } from "./markdown";

/** Longest file name we write, in UTF-8 bytes (most file systems allow 255). */
const MAX_NAME_BYTES = 200;
const MAX_NAME_CHARS = 80;

/** Invisible direction marks and overrides: they can disguise a name's extension. */
const INVISIBLE = /[‎‏؜‪-‮⁦-⁩﻿]/g;
/** Characters Windows, macOS or Linux refuse in a name, control characters, U+FFFD. */
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f�]/g;

/** User-perceived characters, so a cut never splits an emoji or an accent. */
function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/**
 * A safe file or folder name on Windows, macOS and Linux. Only characters the
 * file systems forbid, control characters and invisible direction marks are
 * replaced; every other character (accents, "·", Arabic, Japanese, emoji) is
 * kept as written, in NFC form. Long names are cut on a character boundary.
 */
export function safeFileName(name: string, fallback = "Untitled"): string {
  const wellFormed = typeof name.toWellFormed === "function" ? name.toWellFormed() : name;
  const cleaned = wellFormed
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(FORBIDDEN, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned);
  const base = !cleaned || reserved ? fallback : cleaned;
  const encoder = new TextEncoder();
  let out = "";
  let bytes = 0;
  let count = 0;
  for (const g of graphemes(base)) {
    const size = encoder.encode(g).length;
    if (count + 1 > MAX_NAME_CHARS || bytes + size > MAX_NAME_BYTES) break;
    out += g;
    bytes += size;
    count++;
  }
  return out.replace(/[.\s]+$/g, "") || fallback;
}

/** Make names unique within one folder: "Notes", "Notes (2)", … */
function uniqueNamer() {
  const used = new Set<string>();
  return (name: string, ext: string) => {
    let candidate = `${name}${ext}`;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
}

/** The files of a workspace export (path → text), in a stable order. */
export function workspaceFiles(ws: Workspace, options: MarkdownOptions = {}): Map<string, string> {
  const root = safeFileName(ws.name, "StudyOS");
  const files = new Map<string, string>();
  const pageName = uniqueNamer();
  const dbName = uniqueNamer();
  const width = String(ws.pages.length).length < 2 ? 2 : String(ws.pages.length).length;

  const index: string[] = [`# ${ws.icon ? `${ws.icon} ` : ""}${ws.name}`.trimEnd(), ""];
  ws.pages.forEach((page, i) => {
    const prefix = String(i + 1).padStart(width, "0");
    const file = pageName(`${prefix} ${safeFileName(page.title)}`, ".md");
    files.set(`${root}/pages/${file}`, pageToMarkdown(page, ws, options));
    index.push(`- [${(page.icon ? `${page.icon} ` : "") + (page.title || file)}](pages/${encodeURI(file)})`);
  });
  if (ws.databases.length > 0) index.push("");
  for (const db of ws.databases) {
    const file = dbName(safeFileName(db.name), ".csv");
    files.set(`${root}/databases/${file}`, databaseToCsv(db, ws));
    index.push(`- [${(db.icon ? `${db.icon} ` : "") + (db.name || file)}](databases/${encodeURI(file)})`);
  }
  return new Map([[`${root}/index.md`, `${index.join("\n")}\n`], ...files]);
}

/** CRC-32 (IEEE), for the Unicode Path extra field. */
function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/**
 * Info-ZIP "Unicode Path" extra field (0x7075): the UTF-8 name once more,
 * for unzip tools that ignore the UTF-8 flag and would otherwise decode the
 * name in an old code page (Info-ZIP's unzip turned "·" into garbage).
 */
export function unicodePathField(path: string): Uint8Array {
  const name = strToU8(path);
  const field = new Uint8Array(5 + name.length);
  field[0] = 1;
  new DataView(field.buffer).setUint32(1, crc32(name), true);
  field.set(name, 5);
  return field;
}

/**
 * Set general purpose bit 11 ("names are UTF-8") on every entry, in both the
 * local and the central headers. fflate sets it only for non-ASCII names.
 */
export function flagUtf8Names(zip: Uint8Array): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return zip;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let n = 0; n < count && at + 46 <= zip.length; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    view.setUint16(at + 8, view.getUint16(at + 8, true) | 0x0800, true);
    const local = view.getUint32(at + 42, true);
    if (local + 30 <= zip.length && view.getUint32(local, true) === 0x04034b50) {
      view.setUint16(local + 6, view.getUint16(local + 6, true) | 0x0800, true);
    }
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return zip;
}

/** Zip the workspace export. `mtime` is fixed in tests for stable bytes. */
export function workspaceToZip(
  ws: Workspace,
  options: MarkdownOptions & { mtime?: Date } = {},
): Uint8Array {
  const data: Zippable = {};
  for (const [path, text] of workspaceFiles(ws, options)) {
    const ascii = !/[^\x20-\x7e]/.test(path);
    data[path] = [
      strToU8(text),
      { mtime: options.mtime, ...(ascii ? {} : { extra: { 0x7075: unicodePathField(path) } }) },
    ];
  }
  return flagUtf8Names(zipSync(data, { level: 6 }));
}
