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

/** A safe file or folder name on Windows, macOS and Linux (keeps Unicode). */
export function safeFileName(name: string, fallback = "Untitled"): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned);
  const base = !cleaned || reserved ? fallback : cleaned;
  return Array.from(base).slice(0, 80).join("").trim() || fallback;
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

/** Zip the workspace export. `mtime` is fixed in tests for stable bytes. */
export function workspaceToZip(
  ws: Workspace,
  options: MarkdownOptions & { mtime?: Date } = {},
): Uint8Array {
  const data: Zippable = {};
  for (const [path, text] of workspaceFiles(ws, options)) {
    data[path] = [strToU8(text), { mtime: options.mtime }];
  }
  return zipSync(data, { level: 6 });
}
