/**
 * In-app feedback: what a student can send from the "Send feedback" dialog
 * and the limits the server enforces (src/app/app/feedback-actions.ts).
 * Client-safe: the dialog reads the same kinds and lengths.
 */

export const FEEDBACK_KINDS = ["bug", "idea", "question", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Inbox states in the operator console (/app/admin). */
export const FEEDBACK_STATUSES = ["new", "read", "done"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Message length, counted after trimming. */
export const FEEDBACK_MIN_LENGTH = 5;
export const FEEDBACK_MAX_LENGTH = 4000;

/** Longest page path kept with a message. */
export const FEEDBACK_MAX_PATH = 300;

const HOUR_MS = 60 * 60 * 1000;

/** Messages one student may send per window (both apply). */
export const FEEDBACK_LIMITS = [
  { max: 5, windowMs: HOUR_MS },
  { max: 20, windowMs: 24 * HOUR_MS },
] as const;

/**
 * The path part of `raw` ("/app/w1" from "/app/w1?page=p2#x"), or null when
 * it is not a site path: a full URL, a protocol-relative "//host", empty, or
 * longer than FEEDBACK_MAX_PATH. Query strings and hashes are always dropped:
 * they can carry ids or tokens the student never meant to send.
 */
export function sanitizeFeedbackPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.split(/[?#]/, 1)[0].trim();
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (path.length > FEEDBACK_MAX_PATH) return null;
  // No control characters (a path the browser reports never has them).
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  return path;
}
