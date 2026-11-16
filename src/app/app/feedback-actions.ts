"use server";

/**
 * The "Send feedback" dialog's server side: validates the message, keeps the
 * page path only (never a query string or hash), applies the per-student
 * limits (FEEDBACK_LIMITS) and stores it for the operator console.
 *
 * The limit count and the insert run in one transaction holding the
 * student's advisory lock (lib/db-lock), so parallel sends cannot all pass
 * the count. Never throws to the client: every outcome is a typed result.
 */
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { userLockKey, withKeyLock } from "@/lib/db-lock";
import {
  FEEDBACK_KINDS,
  FEEDBACK_LIMITS,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_MIN_LENGTH,
  sanitizeFeedbackPath,
} from "@/lib/feedback";
import { isLocale } from "@/lib/i18n/config";
import { reportError } from "@/lib/ops/report-error";

export type SendFeedbackError = "unauthorized" | "invalid" | "rate_limited" | "failed";
export type SendFeedbackResult = { ok: true } | { ok: false; error: SendFeedbackError };

const input = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  message: z.string().trim().min(FEEDBACK_MIN_LENGTH).max(FEEDBACK_MAX_LENGTH),
  pagePath: z.string().max(2000).nullish(),
  locale: z.string().max(10).nullish(),
  contactOk: z.boolean().optional(),
});

export type SendFeedbackInput = z.input<typeof input>;

export async function sendFeedbackAction(raw: SendFeedbackInput): Promise<SendFeedbackResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthorized" };

  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { kind, message, contactOk } = parsed.data;
  // A path that is not a plain site path is dropped, not refused: the
  // message itself is what matters.
  const pagePath = sanitizeFeedbackPath(parsed.data.pagePath);
  const locale = isLocale(parsed.data.locale) ? parsed.data.locale : null;

  try {
    const stored = await withKeyLock(userLockKey("feedback", userId), async (tx) => {
      const now = Date.now();
      for (const limit of FEEDBACK_LIMITS) {
        const sent = await tx.feedback.count({
          where: { userId, createdAt: { gte: new Date(now - limit.windowMs) } },
        });
        if (sent >= limit.max) return false;
      }
      await tx.feedback.create({
        data: { userId, kind, message, pagePath, locale, contactOk: contactOk === true },
      });
      return true;
    });
    return stored ? { ok: true } : { ok: false, error: "rate_limited" };
  } catch (error) {
    reportError(error, { source: "feedback.send", userId });
    return { ok: false, error: "failed" };
  }
}
