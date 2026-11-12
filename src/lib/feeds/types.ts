/**
 * Shapes shared by the feed server actions and the import dialog. None of
 * them ever carries the feed link: the browser only sees `label` (the host).
 */
import type { FeedMapping } from "./mapping";
import type { FeedPlatform } from "./normalize";

export type FeedErrorCode =
  // the link as typed
  | "invalid_url"
  | "unsupported_link"
  | "blocked_address"
  // reaching it
  | "host_not_found"
  | "unreachable"
  | "timeout"
  | "too_large"
  | "too_many_redirects"
  | "link_expired"
  | "remote_busy"
  | "remote_error"
  // what came back
  | "not_calendar"
  | "studyos_feed"
  | "file_too_large"
  // ours
  | "rate_limited"
  | "busy"
  | "not_found"
  | "reconnect"
  | "too_many_feeds"
  | "already_connected"
  | "failed";

/** What one sync changed, kept for "last synced … what changed". */
export interface SyncSummary {
  /** ISO time of the sync. */
  at: string;
  added: number;
  updated: number;
  flagged: number;
  restored: number;
  linked: number;
  keptEdits: number;
  /** A few titles per kind, for the "what changed" list. */
  titles: { added: string[]; updated: string[]; flagged: string[]; restored: string[] };
}

export interface FeedInfo {
  id: string;
  databaseId: string;
  /** The feed's host, e.g. "canvas.university.edu". Never the link. */
  label: string;
  platform: FeedPlatform;
  lastSyncedAt: string | null;
  lastAttemptAt: string | null;
  lastError: FeedErrorCode | null;
  lastSummary: SyncSummary | null;
  mapping: Partial<FeedMapping> | null;
  /** Repeating events (series keys) the student chose to follow. */
  series: string[];
  /** True when the last successful sync is old enough to sync on open. */
  stale: boolean;
}

/** Sync again on open once the last sync is older than this. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
/** Feeds per workspace. */
export const MAX_FEEDS_PER_WORKSPACE = 10;
/** Event keys remembered per feed as already decided on. */
export const MAX_SEEN_KEYS = 6_000;
/** Followed repeating events per feed. */
export const MAX_SERIES = 200;
/** Largest .ics file accepted for upload. */
export const MAX_ICS_FILE_BYTES = 3_000_000;
