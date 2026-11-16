import Link from "next/link";
import type { NoticeMessages } from "@/lib/contract-notices/format";
import { cn } from "@/lib/utils";

/**
 * "Withdraw from contract here" and "Cancel contracts here" beside purchases
 * in the signed-in app (settings' billing section, the credits page). The
 * public footer has the same two links (components/SiteFooterLinks.tsx).
 */
export function ContractNoticeLinks({ messages: M, className }: { messages: NoticeMessages; className?: string }) {
  const link =
    "inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-sm font-semibold text-ink transition hover:bg-hover";
  return (
    <div className={cn("text-sm text-ink-soft", className)}>
      <p>{M.linksNote}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href="/withdraw" className={link}>
          {M.withdrawLink}
        </Link>
        <Link href="/cancel" className={link}>
          {M.cancelLink}
        </Link>
      </div>
    </div>
  );
}
