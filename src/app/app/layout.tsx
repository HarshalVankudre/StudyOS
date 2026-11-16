import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { AppShell } from "@/components/command/AppShell";
import { FocusTimerProvider } from "@/components/focus/FocusTimerProvider";
import { ReferralClaim } from "@/components/referral/ReferralClaim";
import { referralsEnabled } from "@/lib/referral/config";
import { referralCookieName } from "@/lib/referral/cookie";

/**
 * Shared chrome for every signed-in /app page: the search and command
 * palette (⌘/Ctrl+K), the keyboard shortcut sheet (?), the install hint, the
 * offline service worker and the focus timer (kept here so it keeps running
 * while the student moves between Today and a workspace). Adds no layout of
 * its own, so each page keeps full control of its frame. While an invite
 * cookie is present (a friend's /r/<code> link, then sign-up), it records
 * the invite once (lib/referral/attribution.ts).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The timer is kept per student in the browser, so the next person on a
  // shared device never sees (or saves) someone else's session.
  const { userId } = await auth();
  // Not while the program is paused: the cookie is kept for when it resumes.
  const invited = userId && referralsEnabled() ? (await cookies()).has(referralCookieName()) : false;
  const shell = (
    <>
      {children}
      <AppShell />
      {invited && <ReferralClaim />}
    </>
  );
  return userId ? <FocusTimerProvider owner={userId}>{shell}</FocusTimerProvider> : shell;
}
