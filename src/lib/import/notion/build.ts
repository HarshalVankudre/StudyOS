/**
 * A Notion "Markdown & CSV" export → one new StudyOS workspace.
 *
 * Deterministic (no AI, no randomness: every id is derived from the export's
 * paths), and bounded: the archive limits refuse a hostile upload, and the
 * content caps import what fits and report the rest (NotionImportSummary).
 *
 * How Notion maps to StudyOS:
 * - Every page (.md) becomes a page. StudyOS pages have no hierarchy, so the
 *   tree is kept as order (each page followed by its subpages) and as links:
 *   Notion writes a link where each subpage sits in its parent, and subpages
 *   the parent never links get a "Subpages" list at its end.
 * - A database (.csv, the _all.csv when both exist) becomes a database with a
 *   table view (plus a board on its first select column and a calendar on its
 *   first date column), shown where its page linked it, or at the end of its
 *   parent page, or on a page of its own for a top-level database.
 * - A database row's own page (Notion exports one .md per row) becomes a
 *   page of its own when it has content beyond the row's fields (which are
 *   already in the table), listed under the table ("Pages in …"). StudyOS
 *   rows hold only fields, and a page keeps the full formatting.
 * - Links between exported pages become StudyOS page links; links to a
 *   database go to the page that shows it; notion.so links to an exported
 *   page are rewritten too.
 * - Markdown tables become small databases; images become media blocks when
 *   `storeImage` stores them (PNG, JPEG, GIF or WebP, when asset storage is
 *   configured), else a short "image not imported" note; other attachments
 *   are named, not kept.
 */
import { workspaceHref } from "@/lib/workspace/deep-link";
import { stableId } from "@/lib/workspace/stable-id";
import type { Block, Database, Page, Workspace } from "@/lib/workspace/types";
import { buildDatabase, parseCsv, type BuiltDatabase, type Table } from "./csv";
import {
  NOTION_IMPORT_LIMITS,
  NotionImportError,
  SkipLog,
  type NotionImportLimits,
  type NotionImportSummary,
  type SkipReason,
} from "./limits";
import { extractTitle, parseMarkdown, plainText, rewriteInline, type InlineLink, type MdNode } from "./markdown";
import {
  isImageExt,
  isJunkPath,
  joinPath,
  notionUrlId,
  pathParts,
  resolveRelative,
  safeDecode,
  splitNotionName,
} from "./names";
import { openArchive, type ArchiveFile } from "./zip";

/** Words the import writes into the workspace, in the student's language. */
export interface NotionImportLabels {
  /** The workspace (and its home page) when the export has several top-level pages. */
  workspaceName: string;
  /** First line of that home page. */
  homeIntro: string;
  untitled: string;
  /** Heading over subpages the parent page did not link. */
  subpages: string;
  /** Heading over a database's row pages, with {name}. */
  rowPages: string;
  /** Name of a database made from a Markdown table, with {page}. */
  tableName: string;
  /** A column without a name, with {n}. */
  column: string;
  viewTable: string;
  viewBoard: string;
  viewCalendar: string;
  /** Link text for an image on the web. */
  image: string;
  /** Note in place of an image, with {name}. */
  imageNotImported: string;
  /** Note after the name of an attachment (“Syllabus.pdf (file not imported)”). */
  fileNotImported: string;
  /** Last line of a page cut at the length limit. */
  truncated: string;
}

export const ENGLISH_IMPORT_LABELS: NotionImportLabels = {
  workspaceName: "Notion import",
  homeIntro: "Imported from Notion.",
  untitled: "Untitled",
  subpages: "Subpages",
  rowPages: "Pages in {name}",
  tableName: "Table from {page}",
  column: "Column {n}",
  viewTable: "Table",
  viewBoard: "Board",
  viewCalendar: "Calendar",
  image: "Image",
  imageNotImported: "Image not imported: {name}",
  fileNotImported: "file not imported",
  truncated: "The rest of this page was too long to import.",
};

export interface ImageInput {
  bytes: Uint8Array;
  /** Sniffed from the bytes (never the file name). */
  mime: string;
  name: string;
}

/** Store an image as an asset; its id, or null when it is not stored. */
export type StoreImage = (image: ImageInput) => Promise<string | null>;

export interface NotionImportOptions {
  /** Id the workspace will be saved under (page links include it). */
  workspaceId: string;
  labels?: Partial<NotionImportLabels>;
  limits?: Partial<NotionImportLimits>;
  /** Read ambiguous "03/04/2024" dates day first (most of the world) instead of month first. */
  dayFirst?: boolean;
  storeImage?: StoreImage;
  /** Clock (tests). */
  now?: () => number;
}

export interface NotionImportResult {
  workspace: Workspace;
  summary: NotionImportSummary;
}

// ---------------------------------------------------------------------------
// The export's structure
// ---------------------------------------------------------------------------

interface PageNode {
  kind: "page";
  file: ArchiveFile;
  path: string;
  dir: string;
  fileTitle: string;
  notionId?: string;
  parent: PageNode | DbNode | null;
  children: (PageNode | DbNode)[];
  // Planning:
  title: string;
  body: string;
  pageId: string;
  cut: boolean;
}

interface DbNode {
  kind: "db";
  file: ArchiveFile;
  aliases: string[];
  base: string;
  dir: string;
  title: string;
  notionId?: string;
  parent: PageNode | null;
  rowPages: PageNode[];
  databaseId: string;
  // Planning:
  built: BuiltDatabase | null;
  hostPageId: string;
  /** Row pages with content (the rest only repeat the row). */
  pageRows: PageNode[];
}

type Node = PageNode | DbNode;

type Planned =
  | { kind: "page"; node: PageNode }
  | { kind: "dbhost"; db: DbNode; pageId: string }
  | { kind: "home"; pageId: string; roots: Node[] };

const utf8 = new TextDecoder("utf-8");

function bytesOf(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

/** Escape text for use inside Markdown (titles in links, names in notes). */
function escapeMd(text: string): string {
  return text.replace(/\s+/g, " ").replace(/([\\`*_[\]<>#|~$])/g, "\\$1");
}

const byTitle = (a: { title: string }, b: { title: string }) =>
  a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

/** The image type of `bytes` from its signature, or null. */
export function sniffImage(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

/** Width and height from a PNG header. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const read = (at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  const width = read(16);
  const height = read(20);
  return width > 0 && height > 0 && width < 100_000 && height < 100_000 ? { width, height } : null;
}

/** Lines "Key: value" at the top of a row page that only repeat the row's fields. */
function stripRowFields(body: string, columns: ReadonlySet<string>): string {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  let j = i;
  while (j < lines.length) {
    const t = lines[j].trim();
    const colon = t.indexOf(":");
    if (colon <= 0 || colon > 200 || !columns.has(t.slice(0, colon).trim())) break;
    j += 1;
  }
  return j > i ? lines.slice(j).join("\n") : body;
}

// ---------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------

/** Turn a Notion export zip into a workspace (not yet saved) and a summary. */
export async function importNotionExport(bytes: Uint8Array, options: NotionImportOptions): Promise<NotionImportResult> {
  const limits: NotionImportLimits = { ...NOTION_IMPORT_LIMITS, ...options.limits };
  const labels: NotionImportLabels = { ...ENGLISH_IMPORT_LABELS, ...options.labels };
  const now = options.now ?? Date.now;
  const started = now();
  const deadline = started + limits.timeoutMs;
  // Storing images is network work: it stops early enough that slow storage
  // turns the remaining images into notes instead of failing the import.
  const imagesUntil = started + limits.timeoutMs * 0.6;
  const skip = new SkipLog();
  const checkTime = () => {
    if (now() > deadline) throw new NotionImportError("timeout");
  };
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const files = openArchive(bytes, { limits, deadline, skip }).filter((f) => !isJunkPath(f.path));
  const byPath = new Map(files.map((f) => [f.path, f]));

  /** A file's text, or null when it cannot be read (reported). */
  const readText = (file: ArchiveFile): { text: string; cut: boolean } | null => {
    checkTime();
    let data: Uint8Array;
    try {
      data = file.read();
    } catch (error) {
      if (error instanceof NotionImportError && error.code === "corrupt") {
        skip.add("unreadable", pathParts(file.path).name);
        return null;
      }
      throw error;
    }
    const text = utf8.decode(data).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    if (text.length <= limits.maxSourceChars) return { text, cut: false };
    return { text: text.slice(0, limits.maxSourceChars), cut: true };
  };

  // ---- Databases --------------------------------------------------------
  const dbs = new Map<string, DbNode>();
  for (const file of files) {
    const { dir, base, ext } = pathParts(file.path);
    if (ext !== "csv") continue;
    const all = base.endsWith("_all");
    const core = all ? base.slice(0, -4) : base;
    const key = joinPath(dir, core);
    const existing = dbs.get(key);
    if (existing) {
      existing.aliases.push(file.path);
      if (all) existing.file = file;
      continue;
    }
    const name = splitNotionName(core);
    dbs.set(key, {
      kind: "db",
      file,
      aliases: [file.path],
      base: key,
      dir,
      title: name.title || labels.untitled,
      notionId: name.id,
      parent: null,
      rowPages: [],
      databaseId: stableId("notion-db", key),
      built: null,
      hostPageId: "",
      pageRows: [],
    });
  }
  const rowFolders = new Map<string, DbNode>();
  for (const db of dbs.values()) rowFolders.set(db.base, db);
  for (const db of dbs.values()) {
    const plain = joinPath(db.dir, db.title);
    if (!rowFolders.has(plain)) rowFolders.set(plain, db);
  }

  // ---- Pages ------------------------------------------------------------
  const pages: PageNode[] = [];
  const pageFolders = new Map<string, PageNode>();
  for (const file of files) {
    const { dir, base, ext } = pathParts(file.path);
    if (ext !== "md" && ext !== "markdown") continue;
    const name = splitNotionName(base);
    const node: PageNode = {
      kind: "page",
      file,
      path: file.path,
      dir,
      fileTitle: name.title,
      notionId: name.id,
      parent: null,
      children: [],
      title: "",
      body: "",
      pageId: stableId("notion-page", file.path),
      cut: false,
    };
    pages.push(node);
    pageFolders.set(joinPath(dir, base), node);
  }
  for (const node of pages) {
    // Exports without ids name the folder after the bare title.
    const plain = joinPath(node.dir, node.fileTitle);
    if (!pageFolders.has(plain)) pageFolders.set(plain, node);
  }
  if (pages.length === 0 && dbs.size === 0) throw new NotionImportError("not_notion");

  // Notion shortens long names, so a folder can differ from its page's file
  // name; the id both carry still matches (and must sit in the same folder).
  const idOwners = new Map<string, PageNode | DbNode>();
  for (const node of [...pages, ...dbs.values()]) if (node.notionId && !idOwners.has(node.notionId)) idOwners.set(node.notionId, node);
  const folderOwner = (folder: string): PageNode | DbNode | undefined => {
    const direct = rowFolders.get(folder) ?? pageFolders.get(folder);
    if (direct) return direct;
    const { dir, name } = pathParts(folder);
    const id = splitNotionName(name).id;
    const owner = id ? idOwners.get(id) : undefined;
    return owner && owner.dir === dir ? owner : undefined;
  };

  const roots: Node[] = [];
  for (const node of pages) {
    const owner = folderOwner(node.dir);
    const db = owner?.kind === "db" ? owner : undefined;
    const parent = owner?.kind === "page" ? owner : undefined;
    if (db) {
      node.parent = db;
      db.rowPages.push(node);
    } else if (parent && parent !== node) {
      node.parent = parent;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  for (const db of dbs.values()) {
    const owner = folderOwner(db.dir);
    const parent = owner?.kind === "page" ? owner : undefined;
    if (parent) {
      db.parent = parent;
      parent.children.push(db);
    } else {
      roots.push(db);
    }
  }

  // ---- Links: archive path / Notion id -> where it lives in the workspace
  const byNotionId: ReadonlyMap<string, Node> = idOwners;
  const dbByAlias = new Map<string, DbNode>();
  for (const db of dbs.values()) for (const alias of db.aliases) dbByAlias.set(alias, db);
  const pageByPath = new Map(pages.map((p) => [p.path, p]));

  /** The exported page or database a link points at, if any. */
  const linkTarget = (fromDir: string, href: string): Node | ArchiveFile | null => {
    const urlId = /^https?:/i.test(href) ? notionUrlId(href) : null;
    if (urlId) return byNotionId.get(urlId) ?? null;
    const path = resolveRelative(fromDir, href);
    if (!path) return null;
    const node = pageByPath.get(path) ?? dbByAlias.get(path);
    if (node) return node;
    const file = byPath.get(path);
    if (file) return file;
    // A path the export spelled differently: fall back to the id in its name.
    const id = splitNotionName(pathParts(path).base.replace(/_all$/, "")).id;
    return (id && byNotionId.get(id)) || null;
  };

  // ---- Planning: which pages are imported, in which order ----------------
  let slots = limits.maxPages;
  const planned: Planned[] = [];
  const included = new Set<PageNode>();
  const plannedDbs: DbNode[] = [];

  const homeRoot = roots.length === 1 ? roots[0] : null;
  const homeId = stableId("notion", "home");
  if (!homeRoot) {
    planned.push({ kind: "home", pageId: homeId, roots });
    slots -= 1;
  }

  /** Read a page's title and body. */
  const readPage = (node: PageNode, columns?: ReadonlySet<string>): boolean => {
    const read = readText(node.file);
    if (!read) return false;
    const { title, body } = extractTitle(read.text);
    node.title = plainText(title ?? "") || node.fileTitle || labels.untitled;
    node.body = columns ? stripRowFields(body, columns) : body;
    node.cut = read.cut;
    return true;
  };

  /** Hrefs a page links, in order (to order its children as Notion showed them). */
  const linkedPaths = (node: PageNode): Node[] => {
    const out: Node[] = [];
    const seen = new Set<Node>();
    rewriteInline(node.body, (link) => {
      if (link.kind === "link") {
        const target = linkTarget(node.dir, link.href);
        if (target && "kind" in target && !seen.has(target)) {
          seen.add(target);
          out.push(target);
        }
      }
      return "";
    });
    return out;
  };

  const orderChildren = (node: PageNode): Node[] => {
    const linked = linkedPaths(node).filter((n) => n.parent === node);
    const rest = node.children
      .filter((c) => !linked.includes(c))
      .map((c) => ({ c, title: c.kind === "page" ? c.fileTitle : c.title }))
      .sort(byTitle)
      .map((x) => x.c);
    return [...linked, ...rest];
  };

  const countPages = (node: Node): number =>
    node.kind === "page"
      ? 1 + node.children.reduce((n, c) => n + countPages(c), 0)
      : node.rowPages.reduce((n, c) => n + countPages(c), 0);

  const skipSubtree = (node: Node, reason: SkipReason) => {
    const name = node.kind === "page" ? node.title || node.fileTitle : node.title;
    skip.add(reason, name, Math.max(1, countPages(node)));
  };

  /** Plan a page that has been read, then its subpages and databases. */
  const includePage = (node: PageNode) => {
    slots -= 1;
    included.add(node);
    planned.push({ kind: "page", node });
    for (const child of orderChildren(node)) {
      if (child.kind === "page") visitPage(child);
      else planDatabase(child, node.pageId);
    }
  };

  const visitPage = (node: PageNode) => {
    checkTime();
    if (slots <= 0) {
      skipSubtree(node, "page_limit");
      return;
    }
    if (readPage(node)) includePage(node);
  };

  const planDatabase = (db: DbNode, hostPageId: string | null) => {
    checkTime();
    if (plannedDbs.length >= limits.maxDatabases) {
      // Its row pages are part of the table and stay out with it.
      skip.add("database_limit", db.title, 1);
      return;
    }
    if (hostPageId === null) {
      if (slots <= 0) {
        skipSubtree(db, "page_limit");
        return;
      }
      slots -= 1;
      hostPageId = stableId("notion-db-page", db.base);
      planned.push({ kind: "dbhost", db, pageId: hostPageId });
    }
    db.hostPageId = hostPageId;
    plannedDbs.push(db);
    const read = readText(db.file);
    const table: Table = read ? parseCsv(read.text) : { header: [], rows: [] };
    if (read?.cut) skip.add("truncated", db.title);
    if (table.header.length === 0) {
      if (read) skip.add("unreadable", pathParts(db.file.path).name);
    } else {
      db.built = buildDatabase(db.databaseId, db.title, table, databaseOptions("▦"));
      if (db.built.skippedRows > 0) skip.add("row_limit", db.title, db.built.skippedRows);
      if (db.built.skippedColumns > 0) skip.add("column_limit", db.title, db.built.skippedColumns);
      if (db.built.truncatedCells > 0) skip.add("truncated", db.title, db.built.truncatedCells);
    }
    // Row pages in the table's order (matched by title), then the rest.
    const columns = new Set(table.header.map((h) => h.replace(/^\uFEFF/, "").trim()));
    const order = new Map<string, number[]>();
    (db.built?.rowTitles ?? []).forEach((title, r) => {
      const key = title.trim().toLowerCase();
      order.set(key, [...(order.get(key) ?? []), r]);
    });
    const ranked: { row: PageNode; rank: number; title: string }[] = [];
    for (const row of db.rowPages) {
      checkTime();
      if (!readPage(row, columns)) continue;
      const queue = order.get(row.title.trim().toLowerCase());
      ranked.push({ row, rank: queue?.shift() ?? Number.MAX_SAFE_INTEGER, title: row.title });
    }
    ranked.sort((a, b) => a.rank - b.rank || byTitle(a, b));
    for (const { row } of ranked) {
      // A row page that only repeats the row's fields adds nothing.
      if (row.body.trim() === "" && row.children.length === 0) continue;
      if (slots <= 0) {
        skipSubtree(row, "page_limit");
        continue;
      }
      db.pageRows.push(row);
      includePage(row);
    }
  };

  const databaseOptions = (icon?: string) => ({
    maxRows: limits.maxRowsPerDatabase,
    maxColumns: limits.maxColumns,
    maxCellChars: limits.maxCellChars,
    dayFirst: options.dayFirst,
    columnName: (n: number) => fill(labels.column, { n }),
    viewNames: { table: labels.viewTable, board: labels.viewBoard, calendar: labels.viewCalendar },
    icon,
  });

  const sortedRoots = homeRoot ? roots : [...roots].sort((a, b) => byTitle(rootTitle(a), rootTitle(b)));
  function rootTitle(node: Node) {
    return { title: node.kind === "page" ? node.fileTitle : node.title };
  }
  for (const root of sortedRoots) {
    if (root.kind === "page") visitPage(root);
    else planDatabase(root, null);
  }
  // Nothing in it could be read.
  if (included.size === 0 && plannedDbs.every((db) => !db.built)) throw new NotionImportError("not_notion");

  // ---- Where links go ------------------------------------------------------
  const wsId = options.workspaceId;
  const pageHref = (pageId: string) => workspaceHref({ workspaceId: wsId, pageId });
  const targetPageId = (node: Node): string | null => {
    if (node.kind === "db") return node.hostPageId || null;
    if (included.has(node)) return node.pageId;
    // A row page without content of its own: the table that holds the row.
    if (node.parent?.kind === "db" && node.parent.hostPageId) return node.parent.hostPageId;
    return null;
  };

  // ---- Converting -------------------------------------------------------
  const outPages: Page[] = [];
  const outDbs: Database[] = [];
  const includedDbIds = new Set<string>();
  const keptPageIds = new Set<string>();
  const droppedPageIds = new Set<string>();
  const usedImages = new Set<string>();
  const imageCache = new Map<string, Block | null>();
  let budget = limits.workspaceBytes - bytesOf({ id: wsId, name: "", icon: "", pages: [], databases: [], homePageId: homeId });
  let imagesStored = 0;
  let tableCount = 0;

  /** Inline text: links rewritten, images and attachments named. */
  const rewriteText = (text: string, fromDir: string): string =>
    rewriteInline(text, (link) => rewriteLink(link, fromDir));

  const rewriteLink = (link: InlineLink, fromDir: string): string => {
    const label = link.label;
    const href = link.href.trim();
    if (link.kind === "image") {
      if (/^https?:\/\//i.test(href)) return `[${label || escapeMd(labels.image)}](${href})`;
      const path = resolveRelative(fromDir, href);
      const name = path ? pathParts(path).name : safeDecode(href).split("/").pop() ?? "";
      return `*${escapeMd(fill(labels.imageNotImported, { name: name || label }))}*`;
    }
    if (/^(https?:|mailto:)/i.test(href)) {
      const target = /^https?:/i.test(href) ? linkTarget(fromDir, href) : null;
      if (target && "kind" in target) {
        const id = targetPageId(target);
        if (id) return `[${label}](${pageHref(id)})`;
      }
      return `[${label}](${href})`;
    }
    const target = linkTarget(fromDir, href);
    if (target && "kind" in target) {
      const id = targetPageId(target);
      return id ? `[${label}](${pageHref(id)})` : label;
    }
    if (target) {
      // An attachment (PDF, a file of any kind) or an image linked as a file;
      // the summary counts every such file once, at the end.
      const { name } = pathParts(target.path);
      return `${label.trim() ? label : escapeMd(name)} *(${escapeMd(labels.fileNotImported)})*`;
    }
    // Anchors and links to files the export left out keep their words only.
    return label;
  };

  const imageBlock = async (node: Extract<MdNode, { type: "image" }>, fromDir: string, blockId: string): Promise<Block> => {
    const note = (name: string): Block => ({
      id: blockId,
      type: "paragraph",
      text: `*${escapeMd(fill(labels.imageNotImported, { name }))}*`,
    });
    const src = node.src.trim();
    if (/^https?:\/\//i.test(src)) {
      return { id: blockId, type: "paragraph", text: `[${node.alt || escapeMd(labels.image)}](${src})` };
    }
    const path = resolveRelative(fromDir, src);
    const file = path ? byPath.get(path) : undefined;
    const name = file ? pathParts(file.path).name : node.alt || labels.image;
    if (!file || !options.storeImage) return note(name);
    const cached = imageCache.get(file.path);
    if (cached !== undefined) return cached ? { ...cached, id: blockId } : note(name);
    let block: Block | null = null;
    if (imagesStored < limits.maxImages && file.size <= limits.maxImageBytes && now() < imagesUntil) {
      checkTime();
      let data: Uint8Array | null = null;
      try {
        data = file.read();
      } catch (error) {
        if (!(error instanceof NotionImportError && error.code === "corrupt")) throw error;
      }
      const mime = data ? sniffImage(data) : null;
      if (data && mime) {
        const assetId = await options.storeImage({ bytes: data, mime, name });
        if (assetId) {
          imagesStored += 1;
          usedImages.add(file.path);
          const size = mime === "image/png" ? pngSize(data) : null;
          block = {
            id: blockId,
            type: "media",
            assetId,
            mediaKind: "image",
            mime,
            ...(size ?? {}),
            ...(node.alt && !/^untitled$/i.test(node.alt) ? { alt: plainText(node.alt).slice(0, 500) } : {}),
          };
        }
      }
    }
    imageCache.set(file.path, block);
    return block ?? note(name);
  };

  const dbViewBlock = (db: Database, blockId: string): Block => ({
    id: blockId,
    type: "database_view",
    databaseId: db.id,
    viewId: db.views[0].id,
  });

  /** The row-page list shown under a database on its host page. */
  const rowList = (db: DbNode, ids: () => string): Block[] => {
    const rows = db.pageRows.filter((r) => included.has(r));
    if (rows.length === 0) return [];
    return [
      { id: ids(), type: "heading", level: 3, text: escapeMd(fill(labels.rowPages, { name: db.title })) },
      ...rows.map((r): Block => ({ id: ids(), type: "bulleted_list_item", text: `[${escapeMd(r.title)}](${pageHref(r.pageId)})` })),
    ];
  };

  const linkItem = (node: Node, id: string): Block | null => {
    const pageId = targetPageId(node);
    if (!pageId) return null;
    const title = node.kind === "page" ? node.title || node.fileTitle : node.title;
    return { id, type: "bulleted_list_item", text: `[${escapeMd(title || labels.untitled)}](${pageHref(pageId)})` };
  };

  interface Draft {
    page: Page;
    /** Databases this page shows for the first time (stored with it). */
    newDbs: Database[];
  }

  const convertMarkdownPage = async (node: PageNode): Promise<Draft> => {
    let n = 0;
    const ids = () => stableId(node.pageId, "block", String(n++));
    const blocks: Block[] = [];
    const newDbs: Database[] = [];
    const shown = new Set<string>();
    let chars = 0;
    let pageTables = 0;
    let truncated = node.cut;
    const fitText = (text: string) => {
      if (text.length > limits.maxBlockChars) truncated = true;
      return text.slice(0, limits.maxBlockChars);
    };
    const showDb = (db: DbNode) => {
      if (!db.built) return;
      const database = db.built.database;
      if (!includedDbIds.has(database.id) && !newDbs.includes(database)) newDbs.push(database);
      blocks.push(dbViewBlock(database, ids()));
      if (db.hostPageId === node.pageId && !shown.has(db.databaseId)) blocks.push(...rowList(db, ids));
      shown.add(db.databaseId);
    };

    for (const md of parseMarkdown(node.body)) {
      if (blocks.length >= limits.maxBlocksPerPage || chars >= limits.maxPageChars) {
        truncated = true;
        break;
      }
      switch (md.type) {
        case "heading":
          blocks.push({ id: ids(), type: "heading", level: md.level, text: fitText(rewriteText(md.text, node.dir)) });
          break;
        case "paragraph":
        case "bulleted_list_item":
        case "numbered_list_item":
        case "quote":
          blocks.push({ id: ids(), type: md.type, text: fitText(rewriteText(md.text, node.dir)) });
          break;
        case "todo":
          blocks.push({ id: ids(), type: "todo", text: fitText(rewriteText(md.text, node.dir)), checked: md.checked });
          break;
        case "callout":
          blocks.push({
            id: ids(),
            type: "callout",
            text: fitText(rewriteText(md.text, node.dir)),
            ...(md.emoji ? { emoji: md.emoji } : {}),
          });
          break;
        case "code":
        case "math":
          blocks.push({ id: ids(), type: "paragraph", text: fitText(md.text) });
          break;
        case "divider":
          blocks.push({ id: ids(), type: "divider" });
          break;
        case "table": {
          const total = includedDbIds.size + newDbs.length;
          if (total + 1 > limits.maxDatabases || md.header.length === 0) {
            // Over the database cap: keep the table as Markdown (rendered as a table).
            skip.add("database_limit", fill(labels.tableName, { page: node.title }));
            const lines = [md.header, md.header.map(() => "---"), ...md.rows].map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|").replace(/\n/g, "<br>")).join(" | ")} |`);
            blocks.push({ id: ids(), type: "paragraph", text: fitText(lines.join("\n")) });
            break;
          }
          tableCount += 1;
          pageTables += 1;
          const name = fill(labels.tableName, { page: node.title }) + (pageTables > 1 ? ` ${pageTables}` : "");
          const table: Table = {
            header: md.header.map((h) => plainText(h)),
            rows: md.rows.map((r) => r.map((c) => plainText(c))),
          };
          const built = buildDatabase(stableId("notion-table", node.pageId, String(tableCount)), name, table, databaseOptions());
          if (built.skippedRows > 0) skip.add("row_limit", name, built.skippedRows);
          if (built.skippedColumns > 0) skip.add("column_limit", name, built.skippedColumns);
          newDbs.push(built.database);
          blocks.push(dbViewBlock(built.database, ids()));
          break;
        }
        case "image":
          blocks.push(await imageBlock(md, node.dir, ids()));
          break;
        case "link": {
          const target = linkTarget(node.dir, md.href);
          if (target && "kind" in target && target.kind === "db" && target.built && plannedDbs.includes(target)) {
            showDb(target);
            break;
          }
          if (md.label.trim() === "" && !(target && "kind" in target)) break;
          blocks.push({ id: ids(), type: "paragraph", text: fitText(rewriteLink({ kind: "link", label: md.label, href: md.href }, node.dir)) });
          break;
        }
      }
      const last = blocks[blocks.length - 1];
      if (last && "text" in last && typeof last.text === "string") chars += last.text.length;
    }

    // What the page holds but never linked: its databases, then its subpages.
    for (const child of node.children) {
      if (child.kind === "db" && plannedDbs.includes(child) && child.hostPageId === node.pageId && !shown.has(child.databaseId) && child.built) {
        blocks.push({ id: ids(), type: "heading", level: 2, text: escapeMd(child.title) });
        showDb(child);
      }
    }
    const linked = new Set(linkedPaths(node));
    const unlinked = node.children.filter((c): c is PageNode => c.kind === "page" && included.has(c) && !linked.has(c));
    if (unlinked.length > 0) {
      blocks.push({ id: ids(), type: "heading", level: 3, text: escapeMd(labels.subpages) });
      for (const child of unlinked.sort(byTitle)) {
        const item = linkItem(child, ids());
        if (item) blocks.push(item);
      }
    }
    if (truncated) {
      skip.add("truncated", node.title);
      blocks.push({ id: ids(), type: "paragraph", text: `*${escapeMd(labels.truncated)}*` });
    }
    return { page: { id: node.pageId, title: node.title, blocks }, newDbs };
  };

  const convertHost = (db: DbNode, pageId: string): Draft => {
    let n = 0;
    const ids = () => stableId(pageId, "block", String(n++));
    const blocks: Block[] = [];
    const newDbs: Database[] = [];
    if (db.built) {
      const database = db.built.database;
      if (!includedDbIds.has(database.id)) newDbs.push(database);
      blocks.push(dbViewBlock(database, ids()), ...rowList(db, ids));
    }
    return { page: { id: pageId, title: db.title, icon: "▦", blocks }, newDbs };
  };

  const convertHome = (pageId: string, rootNodes: Node[]): Draft => {
    let n = 0;
    const ids = () => stableId(pageId, "block", String(n++));
    const blocks: Block[] = [{ id: ids(), type: "paragraph", text: escapeMd(labels.homeIntro) }];
    for (const root of [...rootNodes].sort((a, b) => byTitle(rootTitle(a), rootTitle(b)))) {
      const item = linkItem(root, ids());
      if (item) blocks.push(item);
    }
    return { page: { id: pageId, title: labels.workspaceName, icon: "📥", blocks }, newDbs: [] };
  };

  /** Make a database fit in `room` bytes by keeping fewer rows; null when not even its columns fit. */
  const fitDatabase = (db: Database, room: number): Database | null => {
    const whole = bytesOf(db);
    if (whole <= room) return db;
    const empty = { ...db, rows: [] };
    let used = bytesOf(empty);
    if (used > room) return null;
    const rows = [];
    for (const row of db.rows) {
      const size = bytesOf(row) + 1;
      if (used + size > room) break;
      used += size;
      rows.push(row);
    }
    skip.add("size_limit", db.name, db.rows.length - rows.length);
    return { ...db, rows };
  };

  for (const entry of planned) {
    checkTime();
    await pause();
    const draft =
      entry.kind === "page"
        ? await convertMarkdownPage(entry.node)
        : entry.kind === "dbhost"
          ? convertHost(entry.db, entry.pageId)
          : convertHome(entry.pageId, entry.roots);
    const pageBytes = bytesOf(draft.page) + 1;
    if (pageBytes > budget) {
      droppedPageIds.add(draft.page.id);
      skip.add("size_limit", draft.page.title, 1);
      continue;
    }
    let room = budget - pageBytes;
    const fitted: Database[] = [];
    for (const db of draft.newDbs) {
      const fit = fitDatabase(db, room);
      if (!fit) {
        skip.add("size_limit", db.name, 1);
        continue;
      }
      room -= bytesOf(fit) + 1;
      fitted.push(fit);
    }
    // A view of a database that did not fit would show nothing.
    const fittedIds = new Set(fitted.map((d) => d.id));
    const missing = draft.newDbs.filter((d) => !fittedIds.has(d.id)).map((d) => d.id);
    if (missing.length > 0) {
      draft.page.blocks = draft.page.blocks.filter((b) => !(b.type === "database_view" && missing.includes(b.databaseId)));
    }
    budget = room;
    outPages.push(draft.page);
    keptPageIds.add(draft.page.id);
    for (const db of fitted) {
      outDbs.push(db);
      includedDbIds.add(db.id);
    }
  }

  // Links to pages that did not fit keep their words only.
  if (droppedPageIds.size > 0) {
    const dead = new Set([...droppedPageIds].map(pageHref));
    for (const page of outPages) {
      page.blocks = page.blocks.map((b) => {
        if (!("text" in b) || typeof b.text !== "string" || !b.text.includes("](")) return b;
        const text = rewriteInline(b.text, (link) => {
          const markdown = `${link.kind === "image" ? "!" : ""}[${link.label}](${link.href})`;
          return link.kind === "link" && dead.has(link.href) ? link.label : markdown;
        });
        return { ...b, text } as Block;
      });
    }
  }

  // Images and files the export holds that did not become part of the workspace.
  for (const file of files) {
    const { ext, name } = pathParts(file.path);
    if (ext === "md" || ext === "markdown" || ext === "csv") continue;
    if (isImageExt(ext)) {
      if (!usedImages.has(file.path)) skip.add("image", name);
    } else {
      skip.add("attachment", name);
    }
  }

  const home = homeRoot
    ? homeRoot.kind === "page"
      ? homeRoot.pageId
      : homeRoot.hostPageId
    : homeId;
  const name = homeRoot ? (homeRoot.kind === "page" ? homeRoot.title || homeRoot.fileTitle : homeRoot.title) : labels.workspaceName;
  const workspace: Workspace = {
    id: wsId,
    name: name || labels.workspaceName,
    icon: "📥",
    pages: outPages,
    databases: outDbs,
    ...(keptPageIds.has(home) ? { homePageId: home } : outPages[0] ? { homePageId: outPages[0].id } : {}),
  };
  const images = outPages.reduce((n, p) => n + p.blocks.filter((b) => b.type === "media").length, 0);
  return {
    workspace,
    summary: {
      pages: outPages.length,
      databases: outDbs.length,
      rows: outDbs.reduce((n, d) => n + d.rows.length, 0),
      images,
      skipped: skip.list(),
    },
  };
}
