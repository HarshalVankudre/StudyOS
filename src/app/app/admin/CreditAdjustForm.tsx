"use client";

import { useActionState } from "react";
import { cn } from "@/lib/utils";
import { adjustCreditsAction, type AdjustState } from "./credit-actions";

const INPUT =
  "mt-1 block w-full min-h-10 rounded-xl border border-line-strong bg-card px-3 text-sm text-ink placeholder:text-ink-faint";

/**
 * The operator console's credit adjustment form (Support tools). `nonce`
 * comes from the server with the page; the action hands back the next one,
 * so a double submit of one form applies once. English only, like the console.
 */
export function CreditAdjustForm({ nonce, maxAmount, maxNote }: { nonce: string; maxAmount: number; maxNote: number }) {
  const initial: AdjustState = { status: "idle", message: "", nonce };
  const [state, formAction, pending] = useActionState(adjustCreditsAction, initial);

  return (
    <div>
      {/* Remounted with each result, so the fields show what the action handed
          back: everything after an error, the user id after a success. */}
      <form key={`${state.nonce}:${state.message}`} action={formAction} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="nonce" value={state.nonce || nonce} />
        <label className="text-xs font-semibold text-ink-soft">
          Clerk user id
          <input
            name="userId"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="user_…"
            defaultValue={state.values?.userId}
            className={cn(INPUT, "font-mono")}
          />
        </label>
        <label className="text-xs font-semibold text-ink-soft">
          Credits (positive grants, negative deducts)
          <input
            name="amount"
            type="number"
            required
            step={1}
            min={-maxAmount}
            max={maxAmount}
            placeholder="500 or -500"
            defaultValue={state.values?.amount}
            className={cn(INPUT, "tabular-nums")}
          />
        </label>
        <label className="text-xs font-semibold text-ink-soft sm:col-span-2">
          Note (required, shown in the lookup)
          <input
            name="note"
            required
            maxLength={maxNote}
            autoComplete="off"
            placeholder="Why, e.g. withdrawal, ticket #123"
            defaultValue={state.values?.note}
            className={INPUT}
          />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="min-h-10 rounded-full bg-ink px-5 text-sm font-semibold text-paper transition hover:bg-ink/90 disabled:opacity-60"
          >
            {pending ? "Applying…" : "Apply"}
          </button>
        </div>
      </form>
      <p
        role="status"
        aria-live="polite"
        data-testid="adjust-result"
        className={cn("mt-3 min-h-5 text-sm", state.status === "error" ? "text-rose-600" : "text-ink")}
      >
        {state.message}
      </p>
    </div>
  );
}
