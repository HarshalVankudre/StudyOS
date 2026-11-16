import type { Metadata, ResolvingMetadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { HelpArticleCard } from "@/components/help/HelpArticleCard";
import { HelpLayout, StillStuck } from "@/components/help/HelpLayout";
import { helpPath, isHelpSlug, type HelpSlug } from "@/lib/help/catalog";
import { helpArticles, type HelpArticle } from "@/lib/help/content";
import { helpMetadata } from "@/lib/help/metadata";
import { getI18n, type ServerI18n } from "@/lib/i18n/server";
import { isBillingConfigured } from "@/lib/stripe";

/*
 * One page per article (/help/<slug>), so each can be found and linked on
 * its own. No generateStaticParams: like every page here, an article is
 * rendered per request in the visitor's language (the root layout reads the
 * locale cookie), so there is nothing to prerender. A slug that is not in
 * the catalog (lib/help/catalog.ts) is a 404.
 */

type Props = { params: Promise<{ slug: string }> };

/** The article for `slug` and every other one (for its related links), or a 404. */
async function load(params: Props["params"], i18n: ServerI18n): Promise<{ article: HelpArticle; all: Map<HelpSlug, HelpArticle> }> {
  const { slug } = await params;
  if (!isHelpSlug(slug)) notFound();
  const all = new Map(helpArticles(i18n, { billing: isBillingConfigured() }).map((a) => [a.slug, a]));
  const article = all.get(slug);
  if (!article) notFound();
  return { article, all };
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const i18n = await getI18n();
  const { article } = await load(params, i18n);
  return helpMetadata(
    {
      title: i18n.t(i18n.dict.help.articleTitle, { title: article.title }),
      description: article.summary,
      path: helpPath(article.slug),
    },
    parent,
  );
}

export default async function HelpArticlePage({ params }: Props) {
  const [i18n, { userId }] = await Promise.all([getI18n(), auth()]);
  const { article, all } = await load(params, i18n);
  const { dict, locale } = i18n;
  const H = dict.help;
  const related = article.related.map((slug) => all.get(slug)).filter((a): a is HelpArticle => Boolean(a));

  return (
    <HelpLayout dict={dict} signedIn={Boolean(userId)}>
      <Link
        href={helpPath()}
        className="-ms-1 inline-flex min-h-10 items-center gap-1.5 rounded-full px-1 text-sm text-ink-soft transition hover:text-ink"
      >
        <span aria-hidden className="rtl:-scale-x-100">←</span>
        {H.home}
      </Link>

      <article className="mt-6 max-w-2xl">
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-balance [overflow-wrap:anywhere] sm:text-5xl">
          {article.title}
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-soft">{article.intro}</p>

        {article.steps.length > 0 && (
          <section aria-labelledby="help-steps" className="mt-10 rounded-3xl border border-line bg-card p-5 sm:p-7">
            <h2 id="help-steps" className="font-display text-xl font-bold tracking-tight">
              {H.stepsTitle}
            </h2>
            <ol role="list" className="mt-5 space-y-4">
              {article.steps.map((step, i) => (
                <li key={i} className="flex gap-3.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-lime text-sm font-bold text-lime-on">
                    {(i + 1).toLocaleString(locale)}
                  </span>
                  <span className="min-w-0 pt-0.5 leading-relaxed text-ink [overflow-wrap:anywhere]">{step}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {article.sections.map((section, i) => (
          <section key={i} aria-labelledby={`help-section-${i}`} className="mt-10">
            <h2 id={`help-section-${i}`} className="font-display text-2xl font-bold tracking-tight">
              {section.heading}
            </h2>
            <p className="mt-3 leading-relaxed text-ink-soft [overflow-wrap:anywhere]">{section.text}</p>
          </section>
        ))}

        {article.note && (
          <p role="note" className="mt-10 rounded-3xl bg-oat px-5 py-4 leading-relaxed text-ink">
            {article.note}
          </p>
        )}
      </article>

      {related.length > 0 && (
        <section aria-labelledby="help-related" className="mt-16">
          <h2 id="help-related" className="font-display text-2xl font-bold tracking-tight">
            {H.relatedTitle}
          </h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {related.map((a) => (
              <li key={a.slug}>
                <HelpArticleCard href={helpPath(a.slug)} title={a.title} summary={a.summary} topic={a.topic} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <StillStuck dict={dict} />
    </HelpLayout>
  );
}
