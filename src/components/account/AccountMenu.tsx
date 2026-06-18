"use client";

import Link from "next/link";
import { useClerk, useUser } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { getAccountSummaryAction } from "@/app/app/account-actions";
import { useI18n } from "@/lib/i18n/client";

interface AccountSummary {
  pro: boolean;
  credits: number;
}

/**
 * The account/profile control. Two placements:
 *   - "sidebar" (default): a full-width card at the bottom of the workspace
 *     sidebar; its menu opens upward.
 *   - "header": a compact avatar button in a top bar; its menu opens downward.
 * Both open the same menu to manage profile, subscription, payments, and
 * credits.
 */
export function AccountMenu({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "header";
}) {
  const { user } = useUser();
  const { openUserProfile, signOut } = useClerk();
  const { dict, t, locale, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getAccountSummaryAction()
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [open]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const email = user?.primaryEmailAddress?.emailAddress;
  const name = user?.fullName || email || dict.account.fallbackName;
  const initial = (user?.firstName || name || "?").charAt(0).toUpperCase();
  const pro = summary?.pro ?? false;
  const isHeader = variant === "header";

  const menu = (
    <div
      className={`absolute z-30 overflow-hidden rounded-xl border border-ink/10 bg-white shadow-[0_18px_50px_-22px_rgba(26,23,18,0.45)] ${
        isHeader
          ? `top-[calc(100%+8px)] w-64 ${dir === "rtl" ? "left-0" : "right-0"}`
          : "bottom-[calc(100%+6px)] left-2 right-2"
      }`}
      role="menu"
    >
      <div className="border-b border-ink/10 px-3 py-2.5">
        <p className="truncate text-sm font-semibold text-ink">{name}</p>
        {email && <p className="truncate text-xs text-ink-soft">{email}</p>}
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              pro ? "bg-ink text-paper" : "bg-ink/10 text-ink"
            }`}
          >
            {pro ? dict.account.pro : dict.account.free}
          </span>
          <span className="text-xs text-ink-soft">
            {summary
              ? t(dict.credits.amount, {
                  count: summary.credits.toLocaleString(locale),
                })
              : "…"}
          </span>
        </div>
      </div>

      <div className="py-1">
        <MenuButton
          icon="👤"
          label={dict.account.manageProfile}
          onClick={() => {
            setOpen(false);
            openUserProfile();
          }}
        />
        <MenuLink
          icon="💳"
          label={dict.account.subscriptionPayments}
          href="/app/settings#billing"
          onNavigate={() => setOpen(false)}
        />
        <MenuLink
          icon="✦"
          label={dict.account.buyCredits}
          href="/app/credits"
          onNavigate={() => setOpen(false)}
        />
        <MenuLink
          icon="⚙"
          label={dict.account.settings}
          href="/app/settings"
          onNavigate={() => setOpen(false)}
        />
      </div>

      <div className="border-t border-ink/10 py-1">
        <MenuButton
          icon="⎋"
          label={dict.account.signOut}
          danger
          onClick={() => signOut({ redirectUrl: "/" })}
        />
      </div>
    </div>
  );

  if (isHeader) {
    return (
      <div ref={ref} className="relative">
        {open && menu}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          title={name}
          className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 transition hover:bg-ink/5"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-paper">
            {initial}
          </span>
          <span className="text-ink-soft/60" aria-hidden>
            ⌄
          </span>
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative border-t border-ink/10">
      {open && menu}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-3 text-left transition hover:bg-ink/5"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-paper">
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {name}
          </span>
          <span className="block truncate text-xs text-ink-soft">
            {summary
              ? t(dict.account.creditsAndPlan, {
                  credits: summary.credits.toLocaleString(locale),
                  plan: pro ? dict.account.pro : dict.account.free,
                })
              : email || dict.account.viewProfile}
          </span>
        </span>
        <span className="text-ink-soft/60" aria-hidden>
          ⌄
        </span>
      </button>
    </div>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-ink/5 ${
        danger ? "text-rose-600" : "text-ink"
      }`}
    >
      <span className="w-4 text-center text-xs" aria-hidden>
        {icon}
      </span>
      {label}
    </button>
  );
}

function MenuLink({
  icon,
  label,
  href,
  onNavigate,
}: {
  icon: string;
  label: string;
  href: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      role="menuitem"
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink transition hover:bg-ink/5"
    >
      <span className="w-4 text-center text-xs" aria-hidden>
        {icon}
      </span>
      {label}
    </Link>
  );
}
