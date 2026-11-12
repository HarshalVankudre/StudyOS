"use client";

import {
  fetchFeedForSyncAction,
  recordFeedSyncAction,
  releaseFeedAction,
} from "@/app/app/feed-actions";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { reconcileMapping, type FeedMapping } from "@/lib/feeds/mapping";
import { applyFeedEvents, type ApplyOptions, type ApplyResult } from "@/lib/feeds/sync";
import type { FeedErrorCode, FeedInfo, SyncSummary } from "@/lib/feeds/types";
import { dayKeyOf } from "@/lib/workspace/view-logic";
import type { Workspace } from "@/lib/workspace/types";
import type { WorkspaceCtx } from "../WorkspaceContext";

/**
 * How an import or sync is recorded: its own undo step (never merged into a
 * typing burst), and re-run, not patched, if the document changed elsewhere
 * before it was saved. Re-running is safe because the import matches rows by
 * their event key, so it never adds a row twice.
 */
export const IMPORT_UPDATE = { coalesceKey: null, rebase: "rerun" } as const;

/** The browser's IANA time zone (undefined if the engine cannot tell). */
export function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function localToday(): string {
  return dayKeyOf(new Date());
}

/** Fresh ids and localized names for columns an import may create. */
export function newColumnSpecs(dict: Dictionary): ApplyOptions["newColumns"] {
  const F = dict.feeds;
  return {
    due: { id: crypto.randomUUID(), name: F.newDueName },
    course: { id: crypto.randomUUID(), name: F.newCourseName },
    link: { id: crypto.randomUUID(), name: F.newLinkName },
  };
}

export function summarize(result: ApplyResult): SyncSummary {
  const of = (kind: string) => result.changes.filter((c) => c.kind === kind);
  const titles = (kind: string) => of(kind).slice(0, 20).map((c) => c.title.slice(0, 300));
  return {
    at: new Date().toISOString(),
    added: of("added").length,
    updated: of("updated").length,
    flagged: of("flagged").length,
    restored: of("restored").length,
    linked: of("linked").length,
    keptEdits: result.keptEdits,
    titles: { added: titles("added"), updated: titles("updated"), flagged: titles("flagged"), restored: titles("restored") },
  };
}

export function hasChanges(summary: SyncSummary): boolean {
  return summary.added + summary.updated + summary.flagged + summary.restored > 0;
}

/** "2 new · 1 updated" in the student's language ("" when nothing changed). */
export function summaryText(summary: SyncSummary, dict: Dictionary, t: (s: string, v?: Record<string, string | number>) => string): string {
  const F = dict.feeds;
  const parts: string[] = [];
  if (summary.added) parts.push(t(F.summaryAdded, { count: summary.added }));
  if (summary.updated) parts.push(t(F.summaryUpdated, { count: summary.updated }));
  if (summary.flagged) parts.push(t(F.summaryFlagged, { count: summary.flagged }));
  if (summary.restored) parts.push(t(F.summaryRestored, { count: summary.restored }));
  if (summary.keptEdits) parts.push(t(F.summaryKept, { count: summary.keptEdits }));
  return parts.join(" · ");
}

/** A re-sync never creates columns on its own: "new" means "not mapped". */
export function syncMapping(mapping: FeedMapping): FeedMapping {
  return {
    ...mapping,
    due: mapping.due === "new" ? null : mapping.due,
    course: mapping.course === "new" ? null : mapping.course,
    link: mapping.link === "new" ? null : mapping.link,
  };
}

export type SyncOutcome =
  | { ok: true; summary: SyncSummary; feed: FeedInfo | null }
  | { ok: false; error: FeedErrorCode | "fresh" };

/**
 * Sync one connected feed into the open workspace: the server fetches it,
 * this tab applies the changes through `update()` (one undoable step, saved
 * by the version-checked autosave) and then tells the server what it did.
 */
export async function syncConnectedFeed(
  feedId: string,
  auto: boolean,
  ctx: {
    getWorkspace: () => Workspace;
    update: WorkspaceCtx["update"];
    dict: Dictionary;
  },
): Promise<SyncOutcome> {
  const fetched = await fetchFeedForSyncAction(feedId, auto);
  if (!fetched.ok) return fetched;
  const workspace = ctx.getWorkspace();
  const db = workspace.databases.find((d) => d.id === fetched.databaseId);
  if (!db) {
    await releaseFeedAction(feedId);
    return { ok: false, error: "not_found" };
  }
  const options: ApplyOptions = {
    databaseId: db.id,
    feedId,
    mapping: syncMapping(reconcileMapping(db, fetched.mapping ?? undefined)),
    today: localToday(),
    timeZone: localTimeZone(),
    mode: "sync",
    seen: new Set(fetched.seen),
    series: new Set(fetched.series),
    horizonDay: fetched.feed.horizonDay,
    newColumns: newColumnSpecs(ctx.dict),
  };
  // Dry run on a copy for the summary; the real run happens in the mutator.
  const dry = applyFeedEvents(structuredClone(workspace), fetched.feed.events, options);
  if (dry.changes.length > 0) {
    ctx.update((draft) => {
      applyFeedEvents(draft, fetched.feed.events, options);
    }, IMPORT_UPDATE);
  }
  const summary = summarize(dry);
  const feed = await recordFeedSyncAction(feedId, { summary, considered: dry.considered });
  return { ok: true, summary, feed };
}
