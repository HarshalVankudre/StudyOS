/**
 * Connected calendar feeds (server-only data access). Every function is
 * scoped to the signed-in user's id, passed in by the caller after auth.
 * The sealed link is read only by `claimFeedForSync`, which hands it to the
 * fetcher and nowhere else; nothing returned to a caller ever contains it.
 */
import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import type { FeedMapping } from "./mapping";
import type { FeedPlatform } from "./normalize";
import { FeedKeyMissingError, feedLinksAvailable, feedUrlHash, needsReseal, openFeedUrl, sealFeedUrl } from "./secret";
import {
  MAX_FEEDS_PER_WORKSPACE,
  MAX_SEEN_KEYS,
  MAX_SERIES,
  STALE_AFTER_MS,
  type FeedErrorCode,
  type FeedInfo,
  type SyncSummary,
} from "./types";
import { feedLabel } from "./url";

/** How long one tab may hold a feed while it syncs (stops two tabs syncing at once). */
export const SYNC_LEASE_MS = 2 * 60 * 1000;
/** Sync-on-open waits this long after any attempt, so a broken link is not retried on every open. */
export const AUTO_RETRY_AFTER_MS = 30 * 60 * 1000;

const PLATFORMS = ["canvas", "moodle", "blackboard", "brightspace", "google", "outlook", "apple", "other"] as const;

const choice = z.string().max(200).nullable();
const mappingSchema = z
  .object({ title: choice, due: choice, course: choice, link: choice, status: choice })
  .partial();
const settingsSchema = z.object({
  mapping: mappingSchema.optional(),
  seen: z.array(z.string().max(500)).optional(),
  series: z.array(z.string().max(500)).optional(),
});
type StoredSettings = z.infer<typeof settingsSchema>;

const titles = z.array(z.string().max(300)).max(20);
const summarySchema = z.object({
  at: z.string().max(40),
  added: z.number().int().min(0),
  updated: z.number().int().min(0),
  flagged: z.number().int().min(0),
  restored: z.number().int().min(0),
  linked: z.number().int().min(0),
  keptEdits: z.number().int().min(0),
  titles: z.object({ added: titles, updated: titles, flagged: titles, restored: titles }),
});
export { mappingSchema as feedMappingSchema, summarySchema as syncSummarySchema };

function parseSettings(text: string): StoredSettings {
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function parseSummary(text: string | null): SyncSummary | null {
  if (!text) return null;
  try {
    const parsed = summarySchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const FEED_SELECT = {
  id: true,
  databaseId: true,
  label: true,
  platform: true,
  settings: true,
  lastSyncedAt: true,
  lastAttemptAt: true,
  lastError: true,
  lastSummary: true,
} as const;

type FeedRow = {
  id: string;
  databaseId: string;
  label: string;
  platform: string;
  settings: string;
  lastSyncedAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  lastSummary: string | null;
};

function toInfo(row: FeedRow, now = Date.now()): FeedInfo {
  const settings = parseSettings(row.settings);
  return {
    id: row.id,
    databaseId: row.databaseId,
    label: row.label,
    platform: (PLATFORMS as readonly string[]).includes(row.platform) ? (row.platform as FeedPlatform) : "other",
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    lastError: (row.lastError as FeedErrorCode | null) ?? null,
    lastSummary: parseSummary(row.lastSummary),
    mapping: (settings.mapping as Partial<FeedMapping> | undefined) ?? null,
    series: settings.series ?? [],
    stale: !row.lastSyncedAt || now - row.lastSyncedAt.getTime() > STALE_AFTER_MS,
  };
}

/** True when the user owns this (non-trashed) workspace. */
export async function ownsWorkspace(userId: string, workspaceId: string): Promise<boolean> {
  const row = await prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId: userId, deletedAt: null },
    select: { id: true },
  });
  return Boolean(row);
}

export async function listFeeds(userId: string, workspaceId: string): Promise<FeedInfo[]> {
  const rows = await prisma.calendarFeed.findMany({
    where: { userId, workspaceId },
    orderBy: { createdAt: "asc" },
    select: FEED_SELECT,
  });
  return rows.map((r) => toInfo(r));
}

export async function getFeed(userId: string, feedId: string): Promise<FeedInfo | null> {
  const row = await prisma.calendarFeed.findFirst({ where: { id: feedId, userId }, select: FEED_SELECT });
  return row ? toInfo(row) : null;
}

/** The id of a feed already connected with this exact link, if any. */
export async function findFeedByUrl(userId: string, workspaceId: string, url: string): Promise<string | null> {
  const row = await prisma.calendarFeed.findFirst({
    where: { userId, workspaceId, urlHash: feedUrlHash(url) },
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function connectFeed(input: {
  userId: string;
  workspaceId: string;
  databaseId: string;
  url: string;
  platform: FeedPlatform;
  mapping: Partial<FeedMapping>;
  series: string[];
}): Promise<{ ok: true; feed: FeedInfo } | { ok: false; error: FeedErrorCode }> {
  // Production without FEED_URL_KEY: connecting links is switched off.
  if (!feedLinksAvailable()) return { ok: false, error: "links_unavailable" };
  const count = await prisma.calendarFeed.count({ where: { userId: input.userId, workspaceId: input.workspaceId } });
  if (count >= MAX_FEEDS_PER_WORKSPACE) return { ok: false, error: "too_many_feeds" };
  if (await findFeedByUrl(input.userId, input.workspaceId, input.url)) return { ok: false, error: "already_connected" };
  const settings: StoredSettings = { mapping: input.mapping, series: input.series.slice(0, MAX_SERIES) };
  let urlSealed: string;
  try {
    urlSealed = sealFeedUrl(input.url);
  } catch (error) {
    // Production without FEED_URL_KEY: never store the link unencrypted.
    if (error instanceof FeedKeyMissingError) return { ok: false, error: "links_unavailable" };
    throw error;
  }
  try {
    const row = await prisma.calendarFeed.create({
      data: {
        userId: input.userId,
        workspaceId: input.workspaceId,
        databaseId: input.databaseId,
        urlSealed,
        urlHash: feedUrlHash(input.url),
        label: feedLabel(input.url).slice(0, 200),
        platform: input.platform,
        settings: JSON.stringify(settings),
      },
      select: FEED_SELECT,
    });
    return { ok: true, feed: toInfo(row) };
  } catch (error) {
    // Lost a race with the same link connected from another tab.
    if ((error as { code?: string }).code === "P2002") return { ok: false, error: "already_connected" };
    throw error;
  }
}

export type ClaimResult =
  | { ok: true; url: string; databaseId: string; seen: string[]; series: string[]; mapping: Partial<FeedMapping> | null }
  | { ok: false; error: "not_found" | "busy" | "fresh" | "reconnect" | "links_unavailable" };

/**
 * Take the feed for one sync. `auto` (on open) only proceeds when the last
 * sync is stale; either way only one tab may hold the feed at a time, so two
 * open tabs never import the same changes twice.
 */
export async function claimFeedForSync(
  userId: string,
  feedId: string,
  auto: boolean,
  now = new Date(),
): Promise<ClaimResult> {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
  const retryBefore = new Date(now.getTime() - AUTO_RETRY_AFTER_MS);
  const claimed = await prisma.calendarFeed.updateMany({
    where: {
      id: feedId,
      userId,
      OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: now } }],
      ...(auto
        ? {
            AND: [
              { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }] },
              { OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: retryBefore } }] },
            ],
          }
        : {}),
    },
    data: { syncLeaseUntil: new Date(now.getTime() + SYNC_LEASE_MS), lastAttemptAt: now },
  });
  if (claimed.count !== 1) {
    const exists = await prisma.calendarFeed.findFirst({ where: { id: feedId, userId }, select: { syncLeaseUntil: true } });
    if (!exists) return { ok: false, error: "not_found" };
    return { ok: false, error: exists.syncLeaseUntil && exists.syncLeaseUntil > now ? "busy" : "fresh" };
  }
  const row = await prisma.calendarFeed.findFirst({
    where: { id: feedId, userId },
    select: { urlSealed: true, databaseId: true, settings: true },
  });
  if (!row) return { ok: false, error: "not_found" };
  const url = openFeedUrl(row.urlSealed);
  if (!url && !feedLinksAvailable()) {
    // The key is missing, not wrong: pause (the link opens again once it is
    // set) instead of asking the student to reconnect.
    await releaseFeed(userId, feedId, "links_unavailable");
    return { ok: false, error: "links_unavailable" };
  }
  if (!url) {
    await releaseFeed(userId, feedId, "reconnect");
    return { ok: false, error: "reconnect" };
  }
  // A link stored merely encoded (before FEED_URL_KEY was set) is sealed now.
  if (needsReseal(row.urlSealed)) {
    await prisma.calendarFeed.updateMany({
      where: { id: feedId, userId, urlSealed: row.urlSealed },
      data: { urlSealed: sealFeedUrl(url) },
    });
  }
  const settings = parseSettings(row.settings);
  return {
    ok: true,
    url,
    databaseId: row.databaseId,
    seen: settings.seen ?? [],
    series: settings.series ?? [],
    mapping: (settings.mapping as Partial<FeedMapping> | undefined) ?? null,
  };
}

/** End a sync that fetched nothing usable, keeping the error code for the UI. */
export async function releaseFeed(userId: string, feedId: string, error: FeedErrorCode | null): Promise<void> {
  await prisma.calendarFeed.updateMany({
    where: { id: feedId, userId },
    data: { syncLeaseUntil: null, lastError: error },
  });
}

function mergeKeys(existing: string[], added: string[], max: number): string[] {
  const set = new Set(existing);
  for (const key of added) {
    set.delete(key);
    set.add(key); // most recent last, so trimming drops the oldest
  }
  const all = [...set];
  return all.length > max ? all.slice(all.length - max) : all;
}

/** Record a finished sync: what changed, which events were decided on, settings. */
export async function recordSync(
  userId: string,
  feedId: string,
  input: { summary: SyncSummary; considered: string[]; mapping?: Partial<FeedMapping>; series?: string[] },
  now = new Date(),
): Promise<FeedInfo | null> {
  const row = await prisma.calendarFeed.findFirst({ where: { id: feedId, userId }, select: { settings: true } });
  if (!row) return null;
  const settings = parseSettings(row.settings);
  const next: StoredSettings = {
    mapping: input.mapping ?? settings.mapping,
    series: (input.series ?? settings.series ?? []).slice(0, MAX_SERIES),
    seen: mergeKeys(settings.seen ?? [], input.considered, MAX_SEEN_KEYS),
  };
  const updated = await prisma.calendarFeed.update({
    where: { id: feedId },
    data: {
      settings: JSON.stringify(next),
      lastSummary: JSON.stringify({ ...input.summary, at: now.toISOString() }),
      lastSyncedAt: now,
      lastError: null,
      syncLeaseUntil: null,
    },
    select: FEED_SELECT,
  });
  return toInfo(updated, now.getTime());
}

export async function updateFeedSettings(
  userId: string,
  feedId: string,
  patch: { mapping?: Partial<FeedMapping>; series?: string[] },
): Promise<FeedInfo | null> {
  const row = await prisma.calendarFeed.findFirst({ where: { id: feedId, userId }, select: { settings: true } });
  if (!row) return null;
  const settings = parseSettings(row.settings);
  const next: StoredSettings = {
    ...settings,
    ...(patch.mapping ? { mapping: patch.mapping } : {}),
    ...(patch.series ? { series: patch.series.slice(0, MAX_SERIES) } : {}),
  };
  const updated = await prisma.calendarFeed.update({
    where: { id: feedId },
    data: { settings: JSON.stringify(next) },
    select: FEED_SELECT,
  });
  return toInfo(updated);
}

export async function disconnectFeed(userId: string, feedId: string): Promise<boolean> {
  const result = await prisma.calendarFeed.deleteMany({ where: { id: feedId, userId } });
  return result.count === 1;
}
