"use client";

import { Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { HelpTopic } from "@/lib/help/catalog";
import { fmt } from "@/lib/i18n/interpolate";
import { fold } from "@/lib/search/text";
import { HelpArticleCard } from "./HelpArticleCard";

export interface HelpSearchArticle {
  slug: string;
  href: string;
  title: string;
  summary: string;
  /** Everything the article says (lib/help/content.ts helpSearchText). */
  text: string;
}

export interface HelpSearchTopic {
  id: HelpTopic;
  title: string;
  articles: HelpSearchArticle[];
}

export interface HelpSearchCopy {
  searchLabel: string;
  searchPlaceholder: string;
  clearSearch: string;
  /** "Articles matching “{query}”: {count}" */
  resultCount: string;
  /** "Nothing matches “{query}”" */
  noResultsTitle: string;
  noResultsBody: string;
  showAll: string;
}

/**
 * The help index: a search box over every article's title and text, and the
 * articles grouped by topic. Filters as you type, case- and accent-blind,
 * every word of the query must appear. Rendered on the server with an empty
 * query, so without JavaScript every article is listed.
 */
export function HelpSearch({
  topics,
  copy,
  locale,
}: {
  topics: HelpSearchTopic[];
  copy: HelpSearchCopy;
  locale: string;
}) {
  const [query, setQuery] = useState("");
  const inputId = useId();
  const statusId = useId();

  const index = useMemo(
    () =>
      topics.map((topic) => ({
        ...topic,
        articles: topic.articles.map((a) => ({ ...a, haystack: fold(`${a.title} ${a.summary} ${a.text}`) })),
      })),
    [topics],
  );

  const shown = query.trim();
  const terms = fold(shown).split(/\s+/).filter(Boolean);
  const visible =
    terms.length === 0
      ? index
      : index
          .map((topic) => ({ ...topic, articles: topic.articles.filter((a) => terms.every((w) => a.haystack.includes(w))) }))
          .filter((topic) => topic.articles.length > 0);
  const count = visible.reduce((sum, topic) => sum + topic.articles.length, 0);
  const status = !shown
    ? ""
    : count > 0
      ? fmt(copy.resultCount, { query: shown, count: count.toLocaleString(locale) })
      : fmt(copy.noResultsTitle, { query: shown });

  return (
    <div className="mt-8">
      <form role="search" onSubmit={(e) => e.preventDefault()} className="relative max-w-2xl">
        <label htmlFor={inputId} className="sr-only">
          {copy.searchLabel}
        </label>
        <Search
          className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-ink-faint"
          aria-hidden
        />
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              setQuery("");
            }
          }}
          placeholder={copy.searchPlaceholder}
          aria-describedby={statusId}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          className="h-13 w-full min-w-0 rounded-full border border-line-strong bg-card ps-12 pe-12 text-base text-ink outline-none transition placeholder:text-ink-faint focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/15 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={copy.clearSearch}
            className="absolute end-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-ink-soft transition hover:bg-hover hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </form>

      {/* Announces each result count as the student types (and is the visible count). */}
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className={count === 0 ? "sr-only" : "mt-3 min-h-5 text-sm text-ink-soft"}
      >
        {status}
      </p>

      {count === 0 ? (
        <div className="mt-6 max-w-2xl rounded-3xl border border-line bg-card p-6 sm:p-8">
          <h2 className="font-display text-xl font-bold tracking-tight text-ink [overflow-wrap:anywhere]">
            {fmt(copy.noResultsTitle, { query: shown })}
          </h2>
          <p className="mt-2 leading-relaxed text-ink-soft">{copy.noResultsBody}</p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="mt-5 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-sm font-semibold text-ink transition hover:bg-hover"
          >
            {copy.showAll}
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-12">
          {visible.map((topic) => (
            <section key={topic.id} aria-labelledby={`help-topic-${topic.id}`}>
              <h2 id={`help-topic-${topic.id}`} className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                {topic.title}
              </h2>
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {topic.articles.map((a) => (
                  <li key={a.slug}>
                    <HelpArticleCard href={a.href} title={a.title} summary={a.summary} topic={topic.id} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
