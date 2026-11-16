"use server";

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { claimReferral } from "@/lib/referral/claim";
import { referralCookieOptions } from "@/lib/referral/cookie";

/**
 * Attribute the signed-in student to the invite their browser carries (the
 * invite cookie from /r/<code>, lib/referral/cookie.ts), then clear the
 * cookie. Run once by <ReferralClaim> from the /app layout and the /generate
 * page while the cookie is present: the first signed-in request after
 * sign-up. Every rule (a new account only, no self-referral, ...) is in
 * lib/referral/attribution.ts. When the database cannot be reached, or the
 * program is paused, the cookie is kept, so a later visit tries again (an
 * account older than a day is no longer attributed anyway).
 */
export async function claimReferralAction(): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  const store = await cookies();
  const { name, path, secure, sameSite, httpOnly } = referralCookieOptions();
  const value = store.get(name)?.value;
  if (!value) return;
  if (!(await claimReferral(userId, value))) return;
  store.delete({ name, path, secure, sameSite, httpOnly });
}
