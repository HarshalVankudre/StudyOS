import { SignUp } from "@clerk/nextjs";
import { cookies } from "next/headers";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { BrandMark } from "@/components/BrandMark";
import { getI18n } from "@/lib/i18n/server";
import { REFERRAL_CREDITS } from "@/lib/price-list";
import { hasValidReferralCookie, referralCookieName } from "@/lib/referral/cookie";

export default async function Page() {
  // A friend's invite link (/r/<code>) brought this visitor here: say what
  // it gives them. Only a valid, unexpired signed cookie counts (no database
  // read; none while invites are paused); the invite itself is recorded
  // after sign-up (lib/referral).
  const invited = hasValidReferralCookie((await cookies()).get(referralCookieName())?.value);
  const { dict, t, plural } = await getI18n();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 py-12 antialiased">
      <Link
        href="/"
        className="mb-8 flex items-center gap-1.5 font-display text-2xl font-extrabold tracking-tight text-ink"
      >
        <BrandMark />
        StudyOS
      </Link>
      {invited && (
        <p
          className="mb-6 max-w-sm rounded-2xl bg-matcha px-4 py-3 text-center text-sm text-ink"
          data-testid="invited-note"
        >
          {t(dict.referral.invited, { credits: plural(dict.counts.credits, REFERRAL_CREDITS) })}
        </p>
      )}
      {/* After auth, students land in the app, not on the marketing page. A
          redirect_url from a protected page still wins (Clerk: force props,
          then redirect_url, then these fallbacks). */}
      <SignUp fallbackRedirectUrl="/app" signInFallbackRedirectUrl="/app" />
      <div className="mt-8">
        <LanguageSwitcher />
      </div>
    </main>
  );
}
