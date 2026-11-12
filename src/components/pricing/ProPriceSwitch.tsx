"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

export interface ProPriceSwitchProps {
  labels: {
    billingPeriod: string;
    monthly: string;
    yearly: string;
    /** Already filled in, e.g. "save 16%"; empty when there is no saving. */
    save: string;
    perMonth: string;
    perYear: string;
    billedMonthly: string;
    /** Already filled in with the yearly total and its monthly equivalent. */
    billedYearly: string;
    upgrade: string;
    signedOut: string;
  };
  /** Formatted monthly price, e.g. "$5". */
  monthlyPrice: string;
  /** Formatted yearly total; null when annual billing is not offered. */
  annualPrice: string | null;
  /** Server action that starts checkout (reads `interval`); null when signed out. */
  checkout: ((formData: FormData) => Promise<void>) | null;
  signUpHref: string;
}

/**
 * Pro's price and its call to action, with a Monthly / Yearly switch that is
 * rendered only when annual billing is offered. The chosen period is sent to
 * checkout as `interval` (month | year), the value startCheckoutAction reads.
 */
export function ProPriceSwitch({
  labels,
  monthlyPrice,
  annualPrice,
  checkout,
  signUpHref,
}: ProPriceSwitchProps) {
  const [interval, setPeriod] = useState<"month" | "year">("month");
  const groupName = useId();
  const yearly = interval === "year" && annualPrice !== null;

  return (
    <div>
      {annualPrice !== null && (
        <fieldset className="mb-4">
          <legend className="sr-only">{labels.billingPeriod}</legend>
          <div className="inline-flex rounded-lg border border-line-strong bg-surface-2 p-1 text-sm">
            {(["month", "year"] as const).map((value) => (
              <label
                key={value}
                className={cn(
                  "flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-3.5 font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-lime/60",
                  interval === value ? "bg-card text-ink shadow-card" : "text-ink-soft hover:text-ink",
                )}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={value}
                  checked={interval === value}
                  onChange={() => setPeriod(value)}
                  className="sr-only"
                />
                {value === "month" ? labels.monthly : labels.yearly}
                {value === "year" && labels.save && (
                  <span className="rounded-full bg-lime-faint px-1.5 py-0.5 text-[11px] font-semibold text-lime-deep">
                    {labels.save}
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <p className="flex items-baseline gap-1 font-display text-5xl font-extrabold tracking-tight" aria-live="polite">
        {yearly ? annualPrice : monthlyPrice}
        <span className="text-base font-medium text-ink-faint">{yearly ? labels.perYear : labels.perMonth}</span>
      </p>
      <p className="mt-1.5 text-sm text-ink-soft">{yearly ? labels.billedYearly : labels.billedMonthly}</p>

      <div className="mt-6">
        {checkout ? (
          <form action={checkout}>
            <input type="hidden" name="interval" value={yearly ? "year" : "month"} />
            <button
              type="submit"
              className="min-h-12 w-full rounded-md bg-ink px-5 text-sm font-semibold text-paper transition hover:opacity-90"
            >
              {labels.upgrade}
            </button>
          </form>
        ) : (
          <Link
            href={signUpHref}
            className="flex min-h-12 items-center justify-center rounded-md bg-ink px-5 text-center text-sm font-semibold text-paper transition hover:opacity-90"
          >
            {labels.signedOut}
          </Link>
        )}
      </div>
    </div>
  );
}
