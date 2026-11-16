/**
 * The props of the invite card (components/referral/InviteCard.tsx) for one
 * student, in their language (server-only). Shared by the credits and
 * settings pages. Null when the data cannot be loaded: the card is left out
 * and the page still renders (the failure is reported).
 */
import "server-only";

import { headers } from "next/headers";
import type { InviteCardProps } from "@/components/referral/InviteCard";
import type { ServerI18n } from "@/lib/i18n/server";
import { reportError } from "@/lib/ops/report-error";
import { REFERRAL_CREDITS } from "@/lib/price-list";
import { referralPath, referralsEnabled } from "./config";
import { referralSummary } from "./store";

/**
 * Where invite links point: the app's public origin (APP_URL, then
 * NEXT_PUBLIC_APP_URL), else the host this request came in on.
 */
export async function inviteOrigin(env: Record<string, string | undefined> = process.env): Promise<string> {
  for (const raw of [env.APP_URL, env.NEXT_PUBLIC_APP_URL]) {
    const value = raw?.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // Not a URL: try the next one.
    }
  }
  const host = (await headers()).get("host") ?? "localhost:3000";
  return `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
}

export async function inviteCardProps(
  userId: string,
  { dict, t, plural, locale }: Pick<ServerI18n, "dict" | "t" | "plural" | "locale">,
): Promise<Omit<InviteCardProps, "className"> | null> {
  try {
    const [summary, origin] = await Promise.all([referralSummary(userId), inviteOrigin()]);
    const R = dict.referral;
    const credits = plural(dict.counts.credits, REFERRAL_CREDITS);
    // STUDYOS_REFERRALS=off: the link leads nowhere, so it is not offered.
    const paused = !referralsEnabled();
    const note = paused
      ? R.paused
      : summary.capReached
        ? R.capReached
        : summary.dailyCapReached
          ? R.dailyCapReached
          : null;
    return {
      paused,
      link: `${origin}${referralPath(summary.code)}`,
      messages: {
        howItWorks: t(R.howItWorks, { credits }),
        linkLabel: R.linkLabel,
        copy: R.copy,
        copied: R.copied,
        share: R.share,
        shareText: t(R.shareText, { credits }),
        joined: R.joined,
        rewarded: R.rewarded,
        earned: R.earned,
        note: note ? t(note, { credits }) : null,
      },
      stats: {
        joined: summary.joined.toLocaleString(locale),
        rewarded: summary.rewarded.toLocaleString(locale),
        earned: summary.creditsEarned.toLocaleString(locale),
      },
    };
  } catch (error) {
    reportError(error, { source: "referral-card", userId });
    return null;
  }
}
