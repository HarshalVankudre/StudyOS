"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

export interface InviteCardProps {
  /** The full invite link (https://…/r/<code>). */
  link: string;
  /** Invites are paused (STUDYOS_REFERRALS=off): `messages.note` says so; no link is offered. */
  paused?: boolean;
  /** The words, in the student's language, with the counts already filled in. */
  messages: {
    howItWorks: string;
    linkLabel: string;
    copy: string;
    copied: string;
    share: string;
    shareText: string;
    joined: string;
    rewarded: string;
    earned: string;
    /** The cap note, when a cap is reached, or the paused notice. */
    note: string | null;
  };
  /** Already formatted for the student's language. */
  stats: { joined: string; rewarded: string; earned: string };
  className?: string;
}

const noop = () => () => {};
const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

/**
 * The student's invite link (lib/referral) with a copy button, the native
 * share sheet where the device has one, one line on how it works, and what
 * the invites earned so far. The cards on the credits and settings pages
 * render it; they load the data (lib/referral/store.ts referralSummary).
 * While invites are paused it says so instead of offering the link, and
 * still shows what invites earned.
 */
export function InviteCard({ link, paused = false, messages: M, stats, className }: InviteCardProps) {
  const shareable = useSyncExternalStore(noop, canShare, () => false);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: select the link so it can be copied by hand.
      input.current?.select();
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: "StudyOS", text: M.shareText, url: link });
    } catch {
      // Dismissed, or the share sheet failed: the link is still on screen.
    }
  };

  const earnings = (
    <dl className="mt-4 grid grid-cols-3 gap-2">
      <Stat tint="bg-matcha" label={M.joined} value={stats.joined} />
      <Stat tint="bg-cloud" label={M.rewarded} value={stats.rewarded} />
      <Stat tint="bg-heather" label={M.earned} value={stats.earned} />
    </dl>
  );

  if (paused) {
    return (
      <div className={className}>
        <p className="rounded-2xl bg-oat px-4 py-3 text-sm text-ink" data-testid="invite-paused">
          {M.note}
        </p>
        {earnings}
      </div>
    );
  }

  return (
    <div className={className}>
      <p className="text-sm text-ink-soft">{M.howItWorks}</p>
      {/* One row where the card is wide, the buttons on their own row where
          it is narrow (the credits page column, a phone). */}
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          ref={input}
          readOnly
          value={link}
          dir="ltr"
          aria-label={M.linkLabel}
          onFocus={(e) => e.currentTarget.select()}
          className="min-h-11 min-w-0 flex-[999_1_16rem] rounded-full border border-line bg-paper px-4 font-mono text-xs text-ink-soft outline-none focus:border-line-strong"
        />
        <div className="flex flex-[1_0_auto] gap-2">
          <button
            type="button"
            onClick={copy}
            className="min-h-11 flex-1 rounded-full bg-lime px-5 text-sm font-semibold text-lime-on transition hover:bg-lime-hover"
          >
            <span aria-live="polite">{copied ? M.copied : M.copy}</span>
          </button>
          {shareable && (
            <button
              type="button"
              onClick={share}
              className="min-h-11 flex-1 rounded-full border border-line-strong px-5 text-sm font-semibold text-ink transition hover:bg-hover"
            >
              {M.share}
            </button>
          )}
        </div>
      </div>
      {earnings}
      {M.note && (
        <p className="mt-3 text-xs text-ink-soft" data-testid="invite-cap-note">
          {M.note}
        </p>
      )}
    </div>
  );
}

function Stat({ tint, label, value }: { tint: string; label: string; value: string }) {
  return (
    <div className={cn("min-w-0 rounded-2xl px-3 py-2.5", tint)}>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="mt-0.5 font-display text-xl font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
