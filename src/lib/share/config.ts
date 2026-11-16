/**
 * Public share links (/s/<token>): the rules both sides read. Client-safe
 * (no server imports): the owner's dialog and the visitor's report form use
 * the same reasons and limits the server enforces.
 */

/** Pages one student may have shared at the same time. */
export const MAX_ACTIVE_SHARES_PER_USER = 100;

/**
 * Links an operator turned off after a report (/app/admin) before a student
 * cannot share any page any more. A page whose link an operator turned off
 * can never be shared again, whatever this count.
 */
export const OPERATOR_DISABLED_SHARES_BLOCK = 3;

/** Times a student may turn sharing on per hour (each can create a new link). */
export const SHARE_ENABLES_PER_HOUR = 30;
/** The UsageEvent kind that counts them (a rate-limit window; aged out by lib/ops/retention). */
export const SHARE_ENABLE_KIND = "share_enable";

/** Database rows shown per table on a shared page (and copied by "Save a copy"). */
export const PUBLIC_ROW_CAP = 200;

/** Why a visitor reports a shared page. */
export const SHARE_REPORT_REASONS = ["spam", "copyright", "harmful", "personal", "other"] as const;
export type ShareReportReason = (typeof SHARE_REPORT_REASONS)[number];

/** Longest optional message with a report, counted after trimming. */
export const SHARE_REPORT_MAX_MESSAGE = 1000;

/** Reports one address may send per hour (in memory, per instance). */
export const SHARE_REPORTS_PER_HOUR = 5;

/**
 * New reports kept per share while none is handled: past this, further
 * reports are acknowledged but not stored (one flood cannot fill the table).
 */
export const SHARE_REPORTS_OPEN_CAP = 50;

/** Report states in the operator console. */
export const SHARE_REPORT_STATUSES = ["new", "done"] as const;

/** The path of a shared page. */
export function sharePath(token: string): string {
  return `/s/${encodeURIComponent(token)}`;
}

/** Where a shared page's images are served from (only images that page uses). */
export function shareAssetPath(token: string, assetId: string): string {
  return `${sharePath(token)}/asset/${encodeURIComponent(assetId)}`;
}
