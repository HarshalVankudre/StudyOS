import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { legalNoticeConfigured } from "@/lib/legal/operator";
import { supportEmail } from "@/lib/site";
import { isBillingConfigured } from "@/lib/stripe";
import { GRADE_CALCULATOR_PATH } from "@/lib/tools/catalog";
import { cn } from "@/lib/utils";

/**
 * The links in the footer of every public page (landing, pricing, help,
 * legal): one list, so a new public page is linked from all of them at once.
 * Each page keeps its own footer layout and passes the classes for the row
 * and for a link.
 */
export function SiteFooterLinks({
  dict,
  className,
  linkClassName,
  pricing = true,
  contactLabel,
}: {
  dict: Dictionary;
  /** Classes of the <nav> row. */
  className?: string;
  /** Extra classes of each link (colour, size). */
  linkClassName?: string;
  /** Leave the pricing link out (on the pricing page itself). */
  pricing?: boolean;
  /** Label of the email link; "Support" by default. */
  contactLabel?: string;
}) {
  const link = cn("flex min-h-10 items-center transition hover:text-ink", linkClassName);
  return (
    <nav aria-label={dict.legal.contact} className={className}>
      {pricing && (
        <Link href="/pricing" className={link}>
          {dict.landing.nav.pricing}
        </Link>
      )}
      <Link href="/help" className={link}>
        {dict.help.footerLink}
      </Link>
      <Link href={GRADE_CALCULATOR_PATH} className={link}>
        {dict.tools.gradeCalculator.footerLink}
      </Link>
      <Link href="/terms" className={link}>
        {dict.legal.terms}
      </Link>
      <Link href="/privacy" className={link}>
        {dict.legal.privacy}
      </Link>
      {legalNoticeConfigured() && (
        <Link href="/legal-notice" className={link}>
          {dict.legal.notice}
        </Link>
      )}
      <a href={`mailto:${supportEmail()}`} className={link}>
        {contactLabel ?? dict.landing.footer.support}
      </a>
      {/* The statutory withdrawal function and cancellation button (lib/contract-notices),
          once payments make contracts possible. Served by the app (lib/ops/site-split.ts). */}
      {isBillingConfigured() && (
        <>
          <Link href="/withdraw" className={link}>
            {dict.contractNotices.withdrawLink}
          </Link>
          <Link href="/cancel" className={link}>
            {dict.contractNotices.cancelLink}
          </Link>
        </>
      )}
    </nav>
  );
}
