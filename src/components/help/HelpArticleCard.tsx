import Link from "next/link";
import type { HelpTopic } from "@/lib/help/catalog";
import { cn } from "@/lib/utils";

/** The soft fill each topic's cards sit on (the landing page's pastel tints). */
export const TOPIC_TINT: Record<HelpTopic, string> = {
  start: "bg-matcha",
  deadlines: "bg-cloud",
  study: "bg-heather",
  account: "bg-oat",
};

/**
 * One article as a card: its title (the link, so a screen reader hears just
 * the title) and its summary. The whole card is clickable through the link's
 * stretched ::after. Shared by the index (a client component) and the
 * related articles under each article (a server component).
 */
export function HelpArticleCard({
  href,
  title,
  summary,
  topic,
  headingLevel = 3,
}: {
  href: string;
  title: string;
  summary: string;
  topic: HelpTopic;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div
      className={cn(
        "relative flex h-full flex-col rounded-3xl p-5 transition hover:ring-2 hover:ring-ink/10 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ink/40",
        TOPIC_TINT[topic],
      )}
    >
      <Heading className="font-display text-lg font-bold leading-snug text-ink">
        <Link href={href} className="outline-none after:absolute after:inset-0 after:rounded-3xl after:content-['']">
          {title}
        </Link>
      </Heading>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{summary}</p>
    </div>
  );
}
