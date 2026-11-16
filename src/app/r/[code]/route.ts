import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { clientRateLimitKey } from "@/lib/ops/client-ip";
import { reportError } from "@/lib/ops/report-error";
import { normalizeReferralCode, referralsEnabled } from "@/lib/referral/config";
import { referralCookieKey, referralCookieOptions, signReferralCookie } from "@/lib/referral/cookie";
import { findReferralCode } from "@/lib/referral/store";
import { allowReferralVisit, REFERRAL_VISIT_WINDOW_MS } from "@/lib/referral/visit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * A relative redirect: the browser resolves it against the address it used,
 * so it works behind our reverse proxy (where the request URL carries the
 * server's internal host).
 */
function redirectTo(path: string, cookie?: string): NextResponse {
  const response = new NextResponse(null, { status: 307, headers: { ...HEADERS, Location: path } });
  if (cookie) response.cookies.set({ ...referralCookieOptions(), value: cookie });
  return response;
}

/**
 * A student's invite link, on the app's origin (the website deployment
 * redirects /r/* here, lib/ops/site-split.ts). Signed-out visitors pass the
 * proxy (only /app and /generate need a session).
 *
 *  - the program paused (STUDYOS_REFERRALS=off), not a code, or no such
 *    code: to the landing page, silently, with no cookie;
 *  - already signed in: to the app, and nothing is recorded (an existing
 *    account is never a new friend);
 *  - otherwise: remember the invite in a signed, httpOnly first-party cookie
 *    (lib/referral/cookie.ts) and go to sign-up. Attribution happens on the
 *    new account's first /app request (lib/referral/attribution.ts).
 * Throttled per address (lib/referral/visit.ts).
 */
export async function GET(request: Request, { params }: Props) {
  if (!allowReferralVisit(clientRateLimitKey(request.headers))) {
    return new Response("Too many requests", {
      status: 429,
      headers: { ...HEADERS, "Retry-After": String(Math.ceil(REFERRAL_VISIT_WINDOW_MS / 1000)) },
    });
  }
  if (!referralsEnabled()) return redirectTo("/");
  const code = normalizeReferralCode((await params).code);
  if (!code) return redirectTo("/");

  const { userId } = await auth();
  if (userId) return redirectTo("/app");

  const key = referralCookieKey();
  if (!key) return redirectTo("/sign-up");

  let owner;
  try {
    owner = await findReferralCode(code);
  } catch (error) {
    // The invite cannot be checked now: sign-up still works, without it.
    reportError(error, { source: "api", route: "/r/[code]", method: "GET" });
    return redirectTo("/sign-up");
  }
  if (!owner) return redirectTo("/");
  return redirectTo("/sign-up", signReferralCookie(owner.code, new Date(), key));
}
