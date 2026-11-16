/**
 * Attribution: recording that a NEW account came through an invite link
 * (server-only).
 *
 * The trial grant (lib/credits.ts ensureAccountTx) runs wherever an account
 * is first seen, with no request at hand, so it cannot read the invite
 * cookie. Attribution therefore runs on the friend's first signed-in /app
 * request instead (app/app/referral-actions.ts, from the /app layout while the
 * cookie is present), and only for an account whose CreditAccount was made
 * after the invite was opened and less than REFERRAL_NEW_ACCOUNT_MS ago.
 *
 * The build route (POST /api/generate) runs it too, before its reward, so a
 * friend whose first stop after sign-up is the generator still earns on
 * that first build (lib/referral/claim.ts).
 *
 * At most one Referral row per friend (refereeId is unique). It is "pending"
 * when everything checks out, or "rejected" with a reason (never rewarded):
 *   self_referral     the inviter opened their own link;
 *   referrer_deleted  the inviter's account is deleted (tombstoned);
 *   account_not_new   the account existed before the link was opened (by
 *                     more than ATTRIBUTION_CLOCK_SKEW_MS: the cookie is
 *                     stamped by an app server's clock, the account by the
 *                     database's), or is older than REFERRAL_NEW_ACCOUNT_MS;
 *   cookie_expired    the invite is older than the cookie's lifetime;
 *   bad_signature     the cookie was not signed by us (or the key changed).
 * Nothing is recorded for a cookie we cannot read, an unknown code (there is
 * no inviter to name), a deleted friend or a friend already attributed, nor
 * while the program is paused (STUDYOS_REFERRALS=off: the cookie is kept).
 */
import "server-only";

import { prisma } from "@/lib/db";
import { REFERRAL_NEW_ACCOUNT_MS, referralsEnabled, type ReferralRejectReason } from "./config";
import { referralCookieKey, verifyReferralCookie } from "./cookie";
import { findReferralCode } from "./store";

/** How far an account may seem to predate the invite and still be new (two clocks). */
export const ATTRIBUTION_CLOCK_SKEW_MS = 2 * 60 * 1000;

export type AttributionOutcome =
  | {
      kind: "skipped";
      why: "no_key" | "malformed" | "unknown_code" | "already_attributed" | "deleted_account" | "paused";
    }
  | { kind: "pending"; referrerId: string }
  | { kind: "rejected"; referrerId: string; reason: ReferralRejectReason };

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";

/**
 * Attribute `userId` (signed in) to the invite in `cookieValue`. Safe to run
 * more than once and in parallel: the first run records, the others skip.
 */
export async function attributeReferral(
  userId: string,
  cookieValue: string,
  opts: { now?: Date; key?: Buffer | null } = {},
): Promise<AttributionOutcome> {
  if (!referralsEnabled()) return { kind: "skipped", why: "paused" };
  const now = opts.now ?? new Date();
  const key = opts.key === undefined ? referralCookieKey() : opts.key;
  if (!key) return { kind: "skipped", why: "no_key" };
  const cookie = verifyReferralCookie(cookieValue, now, key);
  // A cookie that is ours in shape (even stale or forged) names a code.
  const code = cookie.ok || cookie.reason !== "malformed" ? cookie.code : null;
  if (!code) return { kind: "skipped", why: "malformed" };

  const owner = await findReferralCode(code);
  if (!owner) return { kind: "skipped", why: "unknown_code" };

  const [existing, refereeDeleted, referrerDeleted, account] = await Promise.all([
    prisma.referral.findUnique({ where: { refereeId: userId }, select: { id: true } }),
    prisma.deletedAccount.findUnique({ where: { userId }, select: { userId: true } }),
    prisma.deletedAccount.findUnique({ where: { userId: owner.userId }, select: { userId: true } }),
    prisma.creditAccount.findUnique({ where: { userId }, select: { createdAt: true } }),
  ]);
  if (existing) return { kind: "skipped", why: "already_attributed" };
  if (refereeDeleted) return { kind: "skipped", why: "deleted_account" };

  let reason: ReferralRejectReason | null = null;
  if (!cookie.ok) reason = cookie.reason === "expired" ? "cookie_expired" : "bad_signature";
  else if (owner.userId === userId) reason = "self_referral";
  else if (referrerDeleted) reason = "referrer_deleted";
  else if (
    // No CreditAccount yet: this request is the account's first sight, so it
    // is new. One that exists must have been made after the link was opened.
    account &&
    (account.createdAt.getTime() < cookie.issuedAt.getTime() - ATTRIBUTION_CLOCK_SKEW_MS ||
      now.getTime() - account.createdAt.getTime() > REFERRAL_NEW_ACCOUNT_MS)
  ) {
    reason = "account_not_new";
  }

  try {
    await prisma.referral.create({
      data: {
        referrerId: owner.userId,
        refereeId: userId,
        code: owner.code,
        status: reason ? "rejected" : "pending",
        rejectReason: reason,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "skipped", why: "already_attributed" };
    throw err;
  }
  return reason
    ? { kind: "rejected", referrerId: owner.userId, reason }
    : { kind: "pending", referrerId: owner.userId };
}
