/**
 * The per-address throttle of the invite link route (/r/<code>), in memory
 * per instance (lib/ops/memory-rate-limit.ts), keyed by lib/ops/client-ip's
 * rateLimitKey (an IPv6 client by its /64). Generous for people clicking a
 * friend's link a few times; it stops anyone walking the code space, or
 * hammering the database, from one address.
 */
import { createMemoryRateLimiter } from "@/lib/ops/memory-rate-limit";

export const REFERRAL_VISIT_WINDOW_MS = 10 * 60 * 1000;
/** Invite links one address may open per window. */
export const REFERRAL_VISITS_PER_WINDOW = 30;

/** One visit of an invite link from `key`: false once the address is over its limit. */
export const allowReferralVisit = createMemoryRateLimiter({
  limit: REFERRAL_VISITS_PER_WINDOW,
  windowMs: REFERRAL_VISIT_WINDOW_MS,
});
