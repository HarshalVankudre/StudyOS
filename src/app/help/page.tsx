import type { Metadata, ResolvingMetadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { HelpLayout, StillStuck } from "@/components/help/HelpLayout";
import { HelpSearch, type HelpSearchTopic } from "@/components/help/HelpSearch";
import { HELP_TOPICS, helpPath } from "@/lib/help/catalog";
import { helpArticles, helpSearchText } from "@/lib/help/content";
import { helpMetadata } from "@/lib/help/metadata";
import { getI18n } from "@/lib/i18n/server";
import { isBillingConfigured } from "@/lib/stripe";

export async function generateMetadata(_props: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const { dict } = await getI18n();
  return helpMetadata({ title: dict.help.metaTitle, description: dict.help.metaDescription, path: helpPath() }, parent);
}

/**
 * The help centre's index (/help): every article, grouped by topic, with a
 * search box that filters as you type. Public, like /pricing: served by the
 * website deployment too (lib/ops/site-split.ts) and listed in the sitemap.
 */
export default async function HelpPage() {
  const [{ dict, locale, t, plural }, { userId }] = await Promise.all([getI18n(), auth()]);
  const H = dict.help;
  const articles = helpArticles({ dict, locale, t, plural }, { billing: isBillingConfigured() });
  const topics: HelpSearchTopic[] = HELP_TOPICS.map((id) => ({
    id,
    title: H.topics[id],
    articles: articles
      .filter((a) => a.topic === id)
      .map((a) => ({ slug: a.slug, href: helpPath(a.slug), title: a.title, summary: a.summary, text: helpSearchText(a) })),
  }));

  return (
    <HelpLayout dict={dict} signedIn={Boolean(userId)}>
      <div className="max-w-2xl">
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">{H.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-soft">{H.subtitle}</p>
      </div>
      <HelpSearch
        topics={topics}
        locale={locale}
        copy={{
          searchLabel: H.searchLabel,
          searchPlaceholder: H.searchPlaceholder,
          clearSearch: H.clearSearch,
          resultCount: H.resultCount,
          noResultsTitle: H.noResultsTitle,
          noResultsBody: H.noResultsBody,
          showAll: H.showAll,
        }}
      />
      <StillStuck dict={dict} />
    </HelpLayout>
  );
}
