/**
 * Notion's export names and the paths inside the archive.
 *
 * Notion names every exported file and folder after its page and appends the
 * page's 32-hex id: "Lecture notes 1a2b…7f.md", with the page's subpages,
 * images and inline databases in a folder of the same name ("Lecture notes
 * 1a2b…7f/"). A database is "Tasks <id>.csv" (and, in newer exports,
 * "Tasks <id>_all.csv" with every row regardless of the view's filter), with
 * one Markdown file per row in the folder "Tasks <id>/". Older exports and
 * some workspaces leave the id out; both forms are understood.
 *
 * Paths here are always "/"-separated, relative to the archive root, without
 * "." or ".." segments (see `safeEntryPath`, which refuses the rest).
 */

const ID_SUFFIX = /^(.*?)[\s_-]+([0-9a-f]{32})$/i;

export interface NotionName {
  /** The title as the export wrote it (without the id). */
  title: string;
  /** Notion's page id (32 lower-case hex), when the name carries one. */
  id?: string;
}

/** "Lecture notes 1a2b…7f" -> { title: "Lecture notes", id: "1a2b…7f" }. */
export function splitNotionName(base: string): NotionName {
  const match = ID_SUFFIX.exec(base.trim());
  if (match && match[1].trim()) return { title: match[1].trim(), id: match[2].toLowerCase() };
  return { title: base.trim() };
}

export interface PathParts {
  /** Folder of the file ("" at the root), without a trailing slash. */
  dir: string;
  /** File name with its extension. */
  name: string;
  /** File name without its extension. */
  base: string;
  /** Lower-case extension without the dot ("" when there is none). */
  ext: string;
}

export function pathParts(path: string): PathParts {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0;
  return {
    dir,
    name,
    base: hasExt ? name.slice(0, dot) : name,
    ext: hasExt ? name.slice(dot + 1).toLowerCase() : "",
  };
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/**
 * The archive path of a zip entry name, or "unsafe" when the name tries to
 * leave the archive (an absolute path, a drive letter, a ".." segment, a NUL
 * byte), or null for an entry to ignore (a folder, an empty name). Backslashes
 * count as separators: some Windows tools write them.
 */
export function safeEntryPath(name: string, maxLength = 1_024): string | null | "unsafe" {
  if (name.includes("\u0000")) return "unsafe";
  const slashed = name.replace(/\\/g, "/");
  if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) return "unsafe";
  const segments: string[] = [];
  for (const segment of slashed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return "unsafe";
    segments.push(segment);
  }
  if (segments.length === 0 || slashed.endsWith("/")) return null;
  const path = segments.join("/");
  return path.length > maxLength ? "unsafe" : path;
}

/** decodeURIComponent that never throws (a stray "%" stays as it is). */
export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text.replace(/%([0-9A-Fa-f]{2})/g, (whole, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code < 0x80 ? String.fromCharCode(code) : whole;
    });
  }
}

/**
 * Resolve a relative link of a file in `fromDir` to an archive path. Returns
 * null for links that are not relative paths (web links, anchors) or that
 * climb out of the archive.
 */
export function resolveRelative(fromDir: string, href: string): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("/") || raw.startsWith("\\")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  const cut = raw.search(/[?#]/);
  const decoded = safeDecode(cut === -1 ? raw : raw.slice(0, cut)).replace(/\\/g, "/");
  const segments = fromDir ? fromDir.split("/") : [];
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length ? segments.join("/") : null;
}

/** The Notion page id in a notion.so / notion.site link, if any. */
export function notionUrlId(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!/(^|\.)notion\.(so|site)$/i.test(url.hostname)) return null;
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const compact = last.replace(/-/g, "");
  const match = /([0-9a-f]{32})$/i.exec(compact);
  return match ? match[1].toLowerCase() : null;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic", "heif", "avif", "tif", "tiff"]);

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}

/** macOS and Windows clutter that is never part of an export. */
export function isJunkPath(path: string): boolean {
  if (path.startsWith("__MACOSX/") || path.includes("/__MACOSX/")) return true;
  const { name } = pathParts(path);
  return name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini" || name.startsWith("._");
}
