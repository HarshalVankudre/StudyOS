/**
 * The "why are you leaving?" answer, client-safe (no database): the reasons
 * the delete-account confirmation offers, and how a submitted answer is read.
 * Storing and counting answers is lib/account/deletion-reason.ts.
 */

/** The answers offered, in the order the confirmation lists them. */
export const DELETION_REASONS = [
  "tooExpensive",
  "missingFeature",
  "hardToUse",
  "aiQuality",
  "finished",
  "otherTool",
  "other",
] as const;

export type DeletionReason = (typeof DELETION_REASONS)[number];

export const DELETION_NOTE_MAX = 500;

/** How long the account existed, coarsely (a date would help tell who it was). */
export const TENURES = ["week", "month", "quarter", "year", "older"] as const;
export type Tenure = (typeof TENURES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export function tenureOf(createdAt: Date | null | undefined, now: Date = new Date()): Tenure {
  if (!createdAt) return "older";
  const days = (now.getTime() - createdAt.getTime()) / DAY_MS;
  if (days < 7) return "week";
  if (days < 31) return "month";
  if (days < 92) return "quarter";
  if (days < 366) return "year";
  return "older";
}

export interface DeletionAnswer {
  reason: DeletionReason;
  note: string | null;
}

/**
 * The student's answer from the confirmation form, or null when they gave
 * none (or sent something that is not one of the offered reasons). A note
 * without a reason counts as "other".
 */
export function parseDeletionAnswer(input: unknown): DeletionAnswer | null {
  if (!input || typeof input !== "object") return null;
  const { reason, note } = input as { reason?: unknown; note?: unknown };
  const text =
    typeof note === "string"
      ? note
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
          .trim()
          .slice(0, DELETION_NOTE_MAX)
      : "";
  const known = typeof reason === "string" && (DELETION_REASONS as readonly string[]).includes(reason);
  if (!known && !text) return null;
  return { reason: known ? (reason as DeletionReason) : "other", note: text || null };
}
