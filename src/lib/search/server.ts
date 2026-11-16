/**
 * Server side of workspace search: loads the signed-in student's workspaces
 * (owner-scoped, never the trash), keeps their flattened search entries in a
 * small in-process cache keyed by owner + id + saved version, and ranks them.
 *
 * Handwritten notebooks are searched the same way (titles, recognised
 * handwriting, imported PDF text), cached per notebook by its version, its
 * updatedAt and the latest change to any of its pages (a recognition stores
 * a page's text without bumping the notebook's version, so the newest page
 * change is part of the stamp). Only the first MAX_SEARCH_TEXT characters of
 * each page text are read from the database.
 *
 * Why no search infrastructure: a student has about a dozen workspaces. The
 * first query of a cold instance parses each one once (a few ms each); after
 * that a query only reads the id/version list and re-parses workspaces that
 * changed since. The cache is bounded and per instance; losing it costs one
 * re-parse, never a wrong result, because the version check runs every query.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/ops/report-error";
import { NOT_TRASHED, parseStoredWorkspace } from "@/lib/workspace/store";
import {
  buildNotebookEntries,
  buildSearchEntries,
  searchEntries,
  type NotebookSearchSource,
  type SearchEntry,
  type SearchResults,
} from "./index";
import { MAX_SEARCH_TEXT } from "./text";

/** Most workspaces considered per query (most recently updated first). */
export const MAX_SEARCHED_WORKSPACES = 60;
/** Most notebooks considered per query (most recently changed first). */
export const MAX_SEARCHED_NOTEBOOKS = 60;
/** Cached workspaces across all students on this instance. */
const CACHE_CAPACITY = 400;
/**
 * Estimated memory the cache may hold across all students on this instance.
 * Entries take a few times the workspace JSON (each text is kept as written
 * and folded), so a count bound alone let 400 large workspaces reach
 * gigabytes. The least recently used workspaces are dropped first.
 */
export const CACHE_MAX_BYTES = 192 * 1024 * 1024;
let cacheMaxBytes = CACHE_MAX_BYTES;

interface CacheItem {
  stamp: string;
  entries: SearchEntry[];
  bytes: number;
}

const cache = new Map<string, CacheItem>();
let cachedBytes = 0;

/** Rough heap size of a workspace's entries: UTF-16 text plus per-object overhead. */
export function estimateEntryBytes(entries: readonly SearchEntry[]): number {
  let n = 64;
  for (const e of entries) {
    n += 160 + 2 * (e.title.length + e.body.length + e.fTitle.length + e.fBody.length + e.context.length);
  }
  return n;
}

function forget(key: string) {
  const old = cache.get(key);
  if (!old) return;
  cache.delete(key);
  cachedBytes -= old.bytes;
}

function remember(key: string, item: Omit<CacheItem, "bytes">) {
  forget(key);
  const bytes = estimateEntryBytes(item.entries);
  cache.set(key, { ...item, bytes });
  cachedBytes += bytes;
  while (cache.size > CACHE_CAPACITY || (cachedBytes > cacheMaxBytes && cache.size > 1)) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    forget(oldest);
  }
}

/** Test hook: forget every cached workspace (and optionally set the byte bound). */
export function clearSearchCache(maxBytes = CACHE_MAX_BYTES) {
  cache.clear();
  cachedBytes = 0;
  cacheMaxBytes = maxBytes;
}

/** Test hook: what the cache holds now. */
export function searchCacheStats(): { items: number; bytes: number } {
  return { items: cache.size, bytes: cachedBytes };
}

/** Search every non-trashed workspace and notebook owned by `ownerId`. */
export async function searchForOwner(ownerId: string, query: string): Promise<SearchResults> {
  const [workspaceEntries, notebookEntries] = await Promise.all([
    workspaceSearchEntries(ownerId),
    // Notebook search never takes workspace search down with it.
    notebookSearchEntries(ownerId).catch((error) => {
      reportError(error, { source: "search", route: "notebookSearchEntries", userId: ownerId });
      return [] as SearchEntry[];
    }),
  ]);
  return searchEntries(workspaceEntries.concat(notebookEntries), query);
}

async function workspaceSearchEntries(ownerId: string): Promise<SearchEntry[]> {
  const rows = await prisma.workspace.findMany({
    where: { ownerId, ...NOT_TRASHED },
    orderBy: { updatedAt: "desc" },
    take: MAX_SEARCHED_WORKSPACES,
    select: { id: true, version: true, updatedAt: true },
  });

  const stampOf = (r: { version: number; updatedAt: Date }) =>
    `${r.version}:${r.updatedAt.getTime()}`;
  const keyOf = (id: string) => `${ownerId}\u0000${id}`;

  const stale = rows.filter((r) => cache.get(keyOf(r.id))?.stamp !== stampOf(r));
  // Built this query: used directly, so a workspace the byte bound evicted
  // again at once still counts in these results.
  const fresh = new Map<string, SearchEntry[]>();
  if (stale.length > 0) {
    const docs = await prisma.workspace.findMany({
      // Owner and trash are checked again: the list above may be a moment old.
      where: { id: { in: stale.map((r) => r.id) }, ownerId, ...NOT_TRASHED },
      select: { id: true, name: true, data: true, version: true, updatedAt: true },
    });
    for (const doc of docs) {
      const ws = parseStoredWorkspace(doc);
      const built = ws ? buildSearchEntries({ ...ws, id: doc.id }) : [];
      fresh.set(doc.id, built);
      remember(keyOf(doc.id), { stamp: stampOf(doc), entries: built });
    }
  }

  const entries: SearchEntry[] = [];
  for (const r of rows) {
    const built = fresh.get(r.id);
    if (built) {
      for (const e of built) entries.push(e);
      continue;
    }
    const item = cache.get(keyOf(r.id));
    // Skip a workspace that vanished (trashed) between the two reads.
    if (item && item.stamp === stampOf(r)) for (const e of item.entries) entries.push(e);
  }
  return entries;
}

/**
 * Entries of the student's live notebooks, most recently changed first,
 * built again only for notebooks whose stamp changed (see the header).
 */
async function notebookSearchEntries(ownerId: string): Promise<SearchEntry[]> {
  const rows = await prisma.notebook.findMany({
    where: { ownerId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: MAX_SEARCHED_NOTEBOOKS,
    select: { id: true, version: true, updatedAt: true },
  });
  if (rows.length === 0) return [];
  const latest = await prisma.notebookPage.groupBy({
    by: ["notebookId"],
    where: { ownerId, notebookId: { in: rows.map((r) => r.id) } },
    _max: { updatedAt: true },
  });
  const pageChange = new Map(latest.map((l) => [l.notebookId, l._max.updatedAt?.getTime() ?? 0]));
  const stampOf = (r: { id: string; version: number; updatedAt: Date }) =>
    `${r.version}:${r.updatedAt.getTime()}:${pageChange.get(r.id) ?? 0}`;
  const keyOf = (id: string) => `${ownerId}\u0000notebook\u0000${id}`;

  const stale = rows.filter((r) => cache.get(keyOf(r.id))?.stamp !== stampOf(r));
  const fresh = new Map<string, SearchEntry[]>();
  if (stale.length > 0) {
    for (const source of await loadNotebookSources(ownerId, stale.map((r) => r.id))) {
      const built = buildNotebookEntries(source);
      fresh.set(source.id, built);
      const row = stale.find((r) => r.id === source.id);
      if (row) remember(keyOf(source.id), { stamp: stampOf(row), entries: built });
    }
  }

  const entries: SearchEntry[] = [];
  for (const r of rows) {
    const built = fresh.get(r.id);
    if (built) {
      for (const e of built) entries.push(e);
      continue;
    }
    const item = cache.get(keyOf(r.id));
    if (item && item.stamp === stampOf(r)) for (const e of item.entries) entries.push(e);
  }
  return entries;
}

/** Titles and page texts (each cut to MAX_SEARCH_TEXT in the database) of some notebooks. */
async function loadNotebookSources(ownerId: string, ids: string[]): Promise<NotebookSearchSource[]> {
  const [notebooks, pages] = await Promise.all([
    // Owner and trash are checked again: the list above may be a moment old.
    prisma.notebook.findMany({
      where: { id: { in: ids }, ownerId, deletedAt: null },
      select: { id: true, title: true },
    }),
    prisma.$queryRaw<{ notebookId: string; id: string; n: bigint | number; inkText: string; pdfText: string }[]>`
      SELECT t."notebookId", t."id", t."n", t."inkText", t."pdfText" FROM (
        SELECT p."notebookId", p."id",
          row_number() OVER (PARTITION BY p."notebookId" ORDER BY p."position", p."id") AS "n",
          left(p."inkText", ${MAX_SEARCH_TEXT}) AS "inkText",
          left(p."pdfText", ${MAX_SEARCH_TEXT}) AS "pdfText"
        FROM "NotebookPage" p
        WHERE p."ownerId" = ${ownerId} AND p."notebookId" = ANY(${ids})
      ) t
      WHERE t."inkText" <> '' OR t."pdfText" <> ''
      ORDER BY t."notebookId", t."n"`,
  ]);
  const byNotebook = new Map<string, NotebookSearchSource["pages"]>();
  for (const p of pages) {
    const list = byNotebook.get(p.notebookId) ?? [];
    list.push({ id: p.id, number: Number(p.n), inkText: p.inkText, pdfText: p.pdfText });
    byNotebook.set(p.notebookId, list);
  }
  return notebooks.map((nb) => ({ id: nb.id, title: nb.title, pages: byNotebook.get(nb.id) ?? [] }));
}
