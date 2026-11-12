import { Info } from "lucide-react";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

/** Outcomes the billing actions report back via `?billing=…`. */
export type BillingNoticeCode = "unavailable" | "already_subscribed" | "error";

/** Parse the `billing` search param; anything unknown shows nothing. */
export function parseBillingNotice(
  value: string | string[] | undefined,
): BillingNoticeCode | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "unavailable" || v === "already_subscribed" || v === "error"
    ? v
    : null;
}

/**
 * A calm, translated notice explaining why checkout did not open (billing not
 * configured here, already subscribed, or a Stripe hiccup). Always says that
 * nothing was charged. Server component; renders nothing without a code.
 */
export function BillingNotice({
  code,
  messages,
  className = "",
}: {
  code: BillingNoticeCode | null;
  messages: Dictionary["billingNotice"];
  className?: string;
}) {
  if (!code) return null;
  const text =
    code === "already_subscribed"
      ? messages.alreadySubscribed
      : code === "unavailable"
        ? messages.unavailable
        : messages.error;
  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-md border border-line-strong bg-surface-2 px-4 py-3 text-start text-sm text-ink ${className}`}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
      <span>{text}</span>
    </div>
  );
}
