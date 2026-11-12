/**
 * Server side of workspace search: loads the signed-in student's workspaces
 * (owner-scoped, never the trash), keeps their flattened search entries in a
 * small in-process cache keyed by owner + id + saved version, and ranks them.
 *
 * Why no search infrastructure: a student has about a dozen workspaces. The
 * first query of a cold instance parses each one once (a few ms each); after
 * that a query only reads the id/version list and re-parses workspaces that
 * changed since. The cache is bounded and per instance; losing it costs one
 * re-parse, never a wrong result, because the version check runs every query.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { NOT_TRASHED, parseStoredWorkspace } from "@/lib/workspace/store";
import { buildSearchEntries, searchEntries, type SearchEntry, type SearchResults } from "./index";

/** Most workspaces considered per query (most recently updated first). */
export const MAX_SEARCHED_WORKSPACES = 60;
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

/** Search every non-trashed workspace owned by `ownerId`. */
export async function searchForOwner(ownerId: string, query: string): Promise<SearchResults> {
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
  return searchEntries(entries, query);
}
