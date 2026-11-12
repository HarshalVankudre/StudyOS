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

interface CacheItem {
  stamp: string;
  entries: SearchEntry[];
}

const cache = new Map<string, CacheItem>();

function remember(key: string, item: CacheItem) {
  cache.delete(key);
  cache.set(key, item);
  while (cache.size > CACHE_CAPACITY) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test hook: forget every cached workspace. */
export function clearSearchCache() {
  cache.clear();
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
  const fresh = new Set<string>();
  if (stale.length > 0) {
    const docs = await prisma.workspace.findMany({
      // Owner and trash are checked again: the list above may be a moment old.
      where: { id: { in: stale.map((r) => r.id) }, ownerId, ...NOT_TRASHED },
      select: { id: true, name: true, data: true, version: true, updatedAt: true },
    });
    for (const doc of docs) {
      const ws = parseStoredWorkspace(doc);
      fresh.add(doc.id);
      remember(keyOf(doc.id), {
        stamp: stampOf(doc),
        entries: ws ? buildSearchEntries({ ...ws, id: doc.id }) : [],
      });
    }
  }

  const entries: SearchEntry[] = [];
  for (const r of rows) {
    const item = cache.get(keyOf(r.id));
    // Skip a workspace that vanished (trashed) between the two reads.
    if (item && (fresh.has(r.id) || item.stamp === stampOf(r))) entries.push(...item.entries);
  }
  return searchEntries(entries, query);
}
