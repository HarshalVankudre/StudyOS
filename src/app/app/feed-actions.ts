"use server";

/**
 * Server actions for importing deadlines from a calendar feed link.
 *
 * Every action re-checks the signed-in user and their ownership of the
 * workspace or feed. The link travels browser → server only when the student
 * previews or connects it; after that it stays on the server (sealed in the
 * CalendarFeed table) and nothing returned here contains it. Changes to the
 * workspace are NOT made here: the browser applies the returned events
 * through the workspace `update()` path, so an import is undoable and saved
 * by the version-checked autosave like any other edit.
 */
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { FeedFetchError, fetchFeed } from "@/lib/feeds/fetch-feed";
import { readFeed, type FeedSnapshot } from "@/lib/feeds/normalize";
import * as store from "@/lib/feeds/store";
import { MAX_SERIES, type FeedErrorCode, type FeedInfo, type SyncSummary } from "@/lib/feeds/types";
import { feedLabel, normalizeFeedUrl } from "@/lib/feeds/url";
import { reportError } from "@/lib/ops/report-error";
import { checkUsageLimit } from "@/lib/usage-limits";

type Fail = { ok: false; error: FeedErrorCode };

const id = z.string().min(1).max(200);
const keys = z.array(z.string().max(500)).max(10_000);
const mappingInput = store.feedMappingSchema;

async function userId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

/** Fetch and read a feed. The link only ever goes to `fetchFeed`. */
async function load(url: string, uid: string): Promise<{ ok: true; feed: FeedSnapshot } | Fail> {
  try {
    const response = await fetchFeed(url);
    const read = readFeed(response.text, { feedUrl: url });
    if (!read.ok) return { ok: false, error: read.error };
    return { ok: true, feed: read.feed };
  } catch (error) {
    if (error instanceof FeedFetchError) return { ok: false, error: error.code };
    // Unexpected: report a scrubbed error only. The original may name the
    // host or carry request details; the link itself must never be logged.
    reportError(new Error(`calendar feed import failed unexpectedly (${(error as Error)?.name ?? "unknown"})`), {
      source: "feeds",
      userId: uid,
    });
    return { ok: false, error: "failed" };
  }
}

export type PreviewResult =
  | { ok: true; feed: FeedSnapshot; label: string; connectedFeedId: string | null }
  | Fail;

/** Fetch a pasted link and return what it contains, without saving anything. */
export async function previewFeedAction(workspaceId: string, rawUrl: string): Promise<PreviewResult> {
  const uid = await userId();
  if (!uid || !id.safeParse(workspaceId).success || typeof rawUrl !== "string") return { ok: false, error: "not_found" };
  const normalized = normalizeFeedUrl(rawUrl);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  if (!(await store.ownsWorkspace(uid, workspaceId))) return { ok: false, error: "not_found" };
  const limit = await checkUsageLimit(uid, "feed_sync");
  if (!limit.allowed) return { ok: false, error: "rate_limited" };
  const loaded = await load(normalized.url, uid);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    feed: loaded.feed,
    label: feedLabel(normalized.url),
    connectedFeedId: await store.findFeedByUrl(uid, workspaceId, normalized.url),
  };
}

const connectInput = z.object({
  workspaceId: id,
  databaseId: id,
  url: z.string().max(4_000),
  platform: z.enum(["canvas", "moodle", "blackboard", "brightspace", "google", "outlook", "apple", "other"]),
  mapping: mappingInput,
  series: keys.max(MAX_SERIES),
});

/** Remember a feed on the workspace so it keeps syncing. */
export async function connectFeedAction(input: z.input<typeof connectInput>): Promise<{ ok: true; feed: FeedInfo } | Fail> {
  const uid = await userId();
  const parsed = connectInput.safeParse(input);
  if (!uid || !parsed.success) return { ok: false, error: "not_found" };
  const normalized = normalizeFeedUrl(parsed.data.url);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  if (!(await store.ownsWorkspace(uid, parsed.data.workspaceId))) return { ok: false, error: "not_found" };
  return store.connectFeed({ ...parsed.data, url: normalized.url, userId: uid });
}

/** Feeds connected to a workspace (no links, only hosts and sync status). */
export async function listFeedsAction(workspaceId: string): Promise<FeedInfo[]> {
  const uid = await userId();
  if (!uid || !id.safeParse(workspaceId).success) return [];
  return store.listFeeds(uid, workspaceId);
}

export type SyncFetchResult =
  | {
      ok: true;
      feed: FeedSnapshot;
      databaseId: string;
      seen: string[];
      series: string[];
      mapping: FeedInfo["mapping"];
    }
  | { ok: false; error: FeedErrorCode | "fresh" };

/**
 * Fetch a connected feed for a sync. `auto` (workspace opened) only runs when
 * the last sync is stale; one tab at a time holds the feed.
 */
export async function fetchFeedForSyncAction(feedId: string, auto: boolean): Promise<SyncFetchResult> {
  const uid = await userId();
  if (!uid || !id.safeParse(feedId).success) return { ok: false, error: "not_found" };
  const claim = await store.claimFeedForSync(uid, feedId, auto === true);
  if (!claim.ok) return { ok: false, error: claim.error };
  const limit = await checkUsageLimit(uid, "feed_sync");
  if (!limit.allowed) {
    await store.releaseFeed(uid, feedId, "rate_limited");
    return { ok: false, error: "rate_limited" };
  }
  const loaded = await load(claim.url, uid);
  if (!loaded.ok) {
    await store.releaseFeed(uid, feedId, loaded.error);
    return loaded;
  }
  return {
    ok: true,
    feed: loaded.feed,
    databaseId: claim.databaseId,
    seen: claim.seen,
    series: claim.series,
    mapping: claim.mapping,
  };
}

const titles = z.array(z.string().max(300)).max(20);
const recordInput = z.object({
  summary: z.object({
    at: z.string().max(40),
    added: z.number().int().min(0).max(100_000),
    updated: z.number().int().min(0).max(100_000),
    flagged: z.number().int().min(0).max(100_000),
    restored: z.number().int().min(0).max(100_000),
    linked: z.number().int().min(0).max(100_000),
    keptEdits: z.number().int().min(0).max(100_000),
    titles: z.object({ added: titles, updated: titles, flagged: titles, restored: titles }),
  }),
  considered: keys,
  mapping: mappingInput.optional(),
  series: keys.max(MAX_SERIES).optional(),
});

/** After the browser applied a sync: remember what changed and what was decided. */
export async function recordFeedSyncAction(
  feedId: string,
  input: { summary: SyncSummary; considered: string[]; mapping?: FeedInfo["mapping"]; series?: string[] },
): Promise<FeedInfo | null> {
  const uid = await userId();
  const parsed = recordInput.safeParse(input);
  if (!uid || !id.safeParse(feedId).success || !parsed.success) return null;
  return store.recordSync(uid, feedId, {
    ...parsed.data,
    mapping: parsed.data.mapping ?? undefined,
  });
}

/** Let go of a feed without recording a sync (the browser could not apply it). */
export async function releaseFeedAction(feedId: string): Promise<void> {
  const uid = await userId();
  if (!uid || !id.safeParse(feedId).success) return;
  await store.releaseFeed(uid, feedId, null);
}

const settingsInput = z.object({ mapping: mappingInput.optional(), series: keys.max(MAX_SERIES).optional() });

export async function updateFeedSettingsAction(
  feedId: string,
  patch: { mapping?: FeedInfo["mapping"]; series?: string[] },
): Promise<FeedInfo | null> {
  const uid = await userId();
  const parsed = settingsInput.safeParse(patch);
  if (!uid || !id.safeParse(feedId).success || !parsed.success) return null;
  return store.updateFeedSettings(uid, feedId, parsed.data);
}

/** Forget a feed. Rows already imported stay in the database as the student's own. */
export async function disconnectFeedAction(feedId: string): Promise<boolean> {
  const uid = await userId();
  if (!uid || !id.safeParse(feedId).success) return false;
  return store.disconnectFeed(uid, feedId);
}
