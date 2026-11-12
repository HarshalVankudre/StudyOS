"use client";

/**
 * The one client-side source of the student's credit balance, shared by every
 * surface that shows it (the workspace header meter, the home page chip, the
 * account menu), so they can never disagree.
 *
 * Why this exists: each surface used to keep its own copy. The home page chip
 * showed the balance server-rendered when the page was first built (kept by
 * the router cache across navigations, and never updated after an AI
 * action), the account menu fetched its own on open, and the meter listened
 * for updates. A copy read while an AI request held credits (holds are taken
 * out of the balance up front, lib/credits.ts reserveCredits) and never
 * refreshed stayed lower than one read after the request settled — the
 * "244 against 265" seen in QA.
 *
 * What is shown is the AVAILABLE balance: what the student can spend now.
 * Credits held by a request in flight are not available; they come back (or
 * are charged) when it settles, and the next value published here says so.
 *
 * Values arrive from three places, and the most recently observed one wins:
 *  - emitCreditsBalance: the balance an AI action returned after settling;
 *  - refreshCreditsBalance: a fresh read from the server (on mount, on focus,
 *    when the account menu opens);
 *  - a server-rendered value passed to useLiveBalance, used only until one of
 *    the above is known.
 */
import { useEffect, useSyncExternalStore } from "react";
import { getAccountSummaryAction } from "@/app/app/account-actions";

/** Re-reads closer together than this are skipped (several surfaces mount at once). */
const REFRESH_MIN_INTERVAL_MS = 2_000;

let known: { balance: number; observedAt: number } | null = null;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;
let lastRefreshAt = 0;
/** Orders observations (a clock could tie within one millisecond). */
let sequence = 0;

/**
 * Mark the start of a server read; pass the result to reportCreditsBalance
 * with the balance it returned, so a value that arrived meanwhile wins.
 */
export function balanceReadStarted(): number {
  return ++sequence;
}

/** Record a balance; an older observation never replaces a newer one. */
export function reportCreditsBalance(balance: number, observedAt: number = ++sequence): void {
  if (typeof balance !== "number" || !Number.isFinite(balance)) return;
  if (known && known.observedAt > observedAt) return;
  const changed = known?.balance !== balance;
  known = { balance, observedAt };
  if (changed) for (const listener of listeners) listener();
}

/** The balance an AI action returned once its credits were settled. */
export function emitCreditsBalance(balance: number): void {
  if (typeof window === "undefined") return;
  reportCreditsBalance(balance);
}

/**
 * Read the balance from the server. Concurrent calls share one request; a
 * read that started before a newer value arrived (an AI action settling
 * meanwhile) is ignored.
 */
export function refreshCreditsBalance(opts: { force?: boolean } = {}): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (inflight) return inflight;
  if (!opts.force && Date.now() - lastRefreshAt < REFRESH_MIN_INTERVAL_MS) return Promise.resolve();
  lastRefreshAt = Date.now();
  const startedAt = balanceReadStarted();
  inflight = getAccountSummaryAction()
    .then((summary) => reportCreditsBalance(summary.credits, startedAt))
    .catch(() => {
      // Offline or signed out: keep showing the last known balance.
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const currentBalance = () => known?.balance;
const noBalanceOnServer = () => undefined;

/**
 * The live, shared balance. `initial` (server-rendered) is shown until a
 * fresher value is known; the hook re-reads from the server on mount and
 * whenever the tab comes back into view, so a balance changed elsewhere
 * (another tab, a purchase) is picked up too.
 */
export function useLiveBalance(initial: number): number;
export function useLiveBalance(initial?: number): number | undefined;
export function useLiveBalance(initial?: number): number | undefined {
  const balance = useSyncExternalStore(subscribe, currentBalance, noBalanceOnServer);
  useEffect(() => {
    void refreshCreditsBalance();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshCreditsBalance();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return balance ?? initial;
}

/** Tests only: forget the shared balance. */
export function resetCreditsBusForTests(): void {
  known = null;
  inflight = null;
  lastRefreshAt = 0;
}
