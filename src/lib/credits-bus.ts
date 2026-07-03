"use client";

/**
 * A tiny client-side event bus so a charged action (an agent turn) can push the
 * user's new credit balance to whatever is showing it — without prop-drilling
 * through the whole workspace tree. The CreditMeter in the header listens; the
 * AgentChat emits after each completed turn.
 */
import { useEffect, useState } from "react";

const EVENT = "studyos:credits";

export function emitCreditsBalance(balance: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: balance }));
}

/**
 * Live balance: starts at `initial` (server-rendered, always fresh on load —
 * the meter remounts per workspace navigation) and updates whenever a charged
 * action broadcasts a new balance.
 */
export function useLiveBalance(initial: number): number {
  const [balance, setBalance] = useState(initial);
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      if (typeof detail === "number") setBalance(detail);
    };
    window.addEventListener(EVENT, onUpdate);
    return () => window.removeEventListener(EVENT, onUpdate);
  }, []);
  return balance;
}
