/**
 * The invite program's fixed vocabulary (pure, client-safe): the code shape,
 * the cookie, the ledger reasons and the statuses a Referral row can have.
 * The amounts and caps are in lib/price-list.ts (REFERRAL_CREDITS,
 * REFERRAL_MAX_REWARDS, REFERRAL_MAX_PER_DAY).
 *
 * How it works (lib/referral/*):
 *   1. A student opens their invite card: a ReferralCode is made once.
 *   2. A friend opens /r/<code> on the app's origin: a signed, httpOnly
 *      first-party cookie remembers the code for REFERRAL_COOKIE_MAX_AGE_S,
 *      then sign-up (app/r/[code]/route.ts).
 *   3. The friend's first signed-in /app request with that cookie records a
 *      Referral (attribution.ts) and clears the cookie.
 *   4. The friend's first charged workspace build rewards both sides, once
 *      (reward.ts), within the caps, counted per account and per mailbox
 *      (mailbox.ts).
 * STUDYOS_REFERRALS=off pauses all of it (referralsEnabled).
 */

/**
 * The kill switch: STUDYOS_REFERRALS=off pauses the invite program. Invite
 * links then lead to the landing page without a cookie, nothing is
 * attributed or rewarded (pending referrals stay pending, and are rewarded
 * once it is on again), and the invite cards say invites are paused. On by
 * default.
 */
export function referralsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STUDYOS_REFERRALS?.trim().toLowerCase() !== "off";
}

/** The unambiguous alphabet codes are drawn from: no 0/O, no 1/I/L. */
export const REFERRAL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** Length of a new code (31^8, about 8.5e11 codes). Shapes of 8 to 10 are accepted. */
export const REFERRAL_CODE_LENGTH = 8;

const CODE_SHAPE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8,10}$/;

/** True for a string that could be a code; anything else is refused before any lookup. */
export function isReferralCodeShape(value: unknown): value is string {
  return typeof value === "string" && CODE_SHAPE.test(value);
}

/** A typed or pasted code, upper-cased, or null when it cannot be one. */
export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 16) return null;
  const code = value.trim().toUpperCase();
  return isReferralCodeShape(code) ? code : null;
}

/** The invite link's path. */
export const referralPath = (code: string) => `/r/${code}`;

/**
 * The first-party cookie that carries a friend's invite to sign-up, by name
 * in development (plain http). In production it carries the `__Host-` prefix
 * (REFERRAL_COOKIE_HOST, see lib/referral/cookie.ts referralCookieName).
 */
export const REFERRAL_COOKIE = "studyos_ref";
/** The production name: Secure, Path=/, no Domain, so no subdomain can plant or overwrite it. */
export const REFERRAL_COOKIE_HOST = `__Host-${REFERRAL_COOKIE}`;
/** How long an invite is remembered after the link was opened. */
export const REFERRAL_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
/**
 * The longest a friend's account may exist before the invite is attributed:
 * attribution runs on the first signed-in /app request, right after sign-up.
 */
export const REFERRAL_NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000;

/** Ledger reasons of the two grants (never counted as AI spending). */
export const REFERRAL_REASON_REFEREE = "referral_referee";
export const REFERRAL_REASON_REFERRER = "referral_referrer";
export const REFERRAL_REASONS = [REFERRAL_REASON_REFEREE, REFERRAL_REASON_REFERRER] as const;

/** Ledger keys: one grant of each kind per friend, whatever retries happen. */
export const refereeGrantKey = (refereeId: string) => `referral:referee:${refereeId}`;
export const referrerGrantKey = (refereeId: string) => `referral:referrer:${refereeId}`;

export type ReferralStatus = "pending" | "rewarded" | "rejected";

/** Why an attribution was recorded as rejected (never rewarded). */
export type ReferralRejectReason =
  | "self_referral"
  | "referrer_deleted"
  | "account_not_new"
  | "cookie_expired"
  | "bad_signature"
  | "same_email"
  /** The friend's mailbox already earned a friend bonus, on another account. */
  | "mailbox_reused";

/** What the inviter got when a referral was rewarded. */
export type ReferrerOutcome = "granted" | "capped_total" | "capped_daily" | "referrer_deleted";
