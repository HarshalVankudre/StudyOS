import { Clock } from "lucide-react";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

/**
 * What a purchase control becomes while payments are not switched on here
 * (lib/stripe.ts isBillingConfigured is false). One rule everywhere:
 *   - compact surfaces (header, account menu, credit chip, low-balance
 *     panels) show no purchase action at all;
 *   - the pages about plans and credits (pricing, credits, settings) keep
 *     showing what exists and put this marker where the button would be,
 *     never a button that ends in "payments aren't available".
 * `note` adds the one-line explanation below the marker. Server component.
 */
export function ComingSoon({
  messages,
  note = false,
  className = "",
}: {
  messages: Pick<Dictionary["spend"], "comingSoon" | "purchasesComingSoon">;
  note?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} data-testid="coming-soon">
      <span className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-dashed border-line-strong bg-surface-2 px-5 text-sm font-semibold text-ink-soft">
        <Clock className="h-4 w-4 shrink-0" aria-hidden />
        {messages.comingSoon}
      </span>
      {note && <p className="text-xs leading-relaxed text-ink-soft">{messages.purchasesComingSoon}</p>}
    </div>
  );
}
