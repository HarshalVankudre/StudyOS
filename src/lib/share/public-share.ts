/**
 * What /s/<token>, its image route and its report action read: the share's
 * public view (public-view.ts) and the asset ids that view shows.
 *
 * Every request checks the link itself with one cheap lookup (the share and
 * its workspace's owner, trash state and version; findLiveShare), so turning
 * sharing off, an operator's "Disable link" or trashing the workspace takes
 * effect at once. The computed view is kept in memory for PUBLIC_VIEW_TTL_MS,
 * keyed by token AND workspace version: any save is a new version, so an
 * edit shows on the next request, and a busy link does not read and parse
 * the whole workspace document for every visitor. "Today" for the page's
 * date filters is the sharer's (their time zone), fixed for the entry's life.
 */
import "server-only";

import { dayKeyOf } from "@/lib/workspace/view-logic";
import { publicAssetIds, toPublicPage, type PublicPage } from "./public-view";
import { findLiveShare, loadSharedDocument, ownerTimeZone, type ActiveShare, type LiveShare } from "./store";
import { createTtlCache } from "./view-cache";

export const PUBLIC_VIEW_TTL_MS = 30_000;
const MAX_CACHED_VIEWS = 500;
const MAX_CACHED_BYTES = 32 * 1024 * 1024;

export interface PublicShare {
  share: ActiveShare;
  view: PublicPage;
  /** The assets this view shows: the only ones its image route serves. */
  assetIds: ReadonlySet<string>;
}

/** A computed view, or null when the page is gone at that version. */
type Entry = { view: PublicPage; assetIds: ReadonlySet<string> } | null;

const views = createTtlCache<Entry>({ ttlMs: PUBLIC_VIEW_TTL_MS, maxEntries: MAX_CACHED_VIEWS, maxBytes: MAX_CACHED_BYTES });
const building = new Map<string, Promise<Entry>>();

const keyOf = (token: string, version: number) => `${token}:${version}`;

async function build(live: LiveShare, now: Date): Promise<Entry> {
  const doc = await loadSharedDocument(live.share);
  if (!doc) {
    views.set(keyOf(live.share.token, live.version), null, 64);
    return null;
  }
  const today = dayKeyOf(now, await ownerTimeZone(live.share.userId));
  const view = toPublicPage(doc.page, doc.workspace, { token: live.share.token, today });
  const entry: Entry = { view, assetIds: publicAssetIds(view) };
  // Keyed by the version the document was read at (a save may have landed since the lookup).
  views.set(keyOf(live.share.token, doc.version), entry, JSON.stringify(view).length * 2);
  return entry;
}

/** The public view of a working share link, or null (unknown, revoked, trashed, page gone). */
export async function loadPublicShare(token: string, now: Date = new Date()): Promise<PublicShare | null> {
  const live = await findLiveShare(token);
  if (!live) return null;
  const key = keyOf(token, live.version);
  let entry = views.get(key);
  if (entry === undefined) {
    // Visitors arriving together share one build.
    let pending = building.get(key);
    if (!pending) {
      pending = build(live, now).finally(() => building.delete(key));
      building.set(key, pending);
    }
    entry = await pending;
  }
  return entry ? { share: live.share, ...entry } : null;
}

/** Forget every cached view (tests). */
export function clearPublicShareCache(): void {
  views.clear();
  building.clear();
}
