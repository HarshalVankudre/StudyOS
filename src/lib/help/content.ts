/**
 * The help centre's articles in the visitor's language, with every number
 * filled in from the constant the product itself runs on: the price list
 * (trial, Pro, packs, action prices on the configured models, the invite
 * rules), the limits of each feature and the retention rules. A number is
 * never written into a dictionary, so an article cannot drift from what the
 * code does (src/lib/price-list.pages.test.tsx builds the price list with
 * other numbers and checks the help pages follow).
 *
 * Server-only: the action prices depend on the configured models
 * (lib/ai/plans reads the environment), as on the pricing page.
 */
import "server-only";

import { modelForPlan, type Plan } from "@/lib/ai/plans";
import { AGENDA_DAYS } from "@/lib/agenda/build";
import { MAX_ICS_FILE_BYTES, MAX_FEEDS_PER_WORKSPACE, STALE_AFTER_MS } from "@/lib/feeds/types";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import type { PluralForms } from "@/lib/i18n/plural";
import { NOTION_IMPORT_LIMITS } from "@/lib/import/notion/limits";
import { MAX_UPLOAD_BYTES } from "@/lib/import/syllabus";
import { DAILY_CAP } from "@/lib/notifications/preferences";
import { RETENTION } from "@/lib/ops/retention";
import {
  CREDIT_PACK_SIZE,
  FREE_FAILURES_PER_DAY,
  isFixedPrice,
  PRO_MONTHLY_CREDITS,
  publicQuotes,
  REFERRAL_CREDITS,
  REFERRAL_MAX_PER_DAY,
  REFERRAL_MAX_REWARDS,
  TRIAL_CREDITS,
  TURN_CREDIT_CAP,
  type PriceQuote,
} from "@/lib/price-list";
import { REFERRAL_COOKIE_MAX_AGE_S } from "@/lib/referral/config";
import { MAX_ACTIVE_SHARES_PER_USER, PUBLIC_ROW_CAP } from "@/lib/share/config";
import { FOCUS_PRESETS } from "@/lib/study/focus-timer";
import { FREEZE_EVERY, MAX_FREEZES } from "@/lib/study/streak";
import { MAX_FLASHCARDS, MAX_QUIZ_QUESTIONS } from "@/lib/workspace/schema";
import { HELP_ARTICLES, type HelpSlug, type HelpTopic } from "./catalog";

/** What one article's copy looks like in a dictionary. */
export type HelpArticleCopy = Dictionary["help"]["articles"][HelpSlug];

/** One article, ready to show: every placeholder filled in. */
export interface HelpArticle {
  slug: HelpSlug;
  topic: HelpTopic;
  title: string;
  /** One or two sentences: the index card and the meta description. */
  summary: string;
  intro: string;
  steps: string[];
  sections: { heading: string; text: string }[];
  /** A note about this deployment (purchases not on sale yet), or null. */
  note: string | null;
  related: HelpSlug[];
}

/** The parts of ServerI18n the articles need. */
export interface HelpI18n {
  dict: Dictionary;
  locale: string;
  t: (template: string, vars?: Record<string, string | number>) => string;
  plural: (forms: PluralForms, count: number, vars?: Record<string, string | number>) => string;
}

export interface HelpOptions {
  /** Payments are switched on (lib/stripe isBillingConfigured): Pro and packs can be bought. */
  billing: boolean;
  /** The models each plan runs on; the configured ones by default. */
  models?: Record<Plan, string>;
}

const MB = 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;
const DAY_S = 24 * 60 * 60;

/**
 * The values every article's {placeholders} are filled from. Plain numbers
 * are formatted for the locale; {build}, {message}, {kitPart} and {referral}
 * carry their unit ("30 credits"), and an action whose real cost on the
 * configured model is above its list price reads "about …, at most …", as
 * on the pricing page.
 */
export function helpValues(i18n: HelpI18n, models?: Record<Plan, string>): Record<string, string> {
  const { dict, locale, t, plural } = i18n;
  const n = (value: number) => value.toLocaleString(locale);
  const credits = (value: number) => plural(dict.counts.credits, value);
  const cost = (quote: PriceQuote) =>
    isFixedPrice(quote) ? credits(quote.list) : t(dict.help.costRange, { price: n(quote.price), max: n(quote.max) });
  const q = publicQuotes(models ?? { free: modelForPlan("free"), pro: modelForPlan("pro") });
  return {
    // Plans and credits (lib/price-list.ts)
    trial: n(TRIAL_CREDITS),
    monthly: n(PRO_MONTHLY_CREDITS),
    pack: n(CREDIT_PACK_SIZE),
    build: cost(q.build),
    message: credits(q.message.price),
    kitPart: cost(q.studyKitPart),
    capFree: n(TURN_CREDIT_CAP.free),
    capPro: n(TURN_CREDIT_CAP.pro),
    failures: n(FREE_FAILURES_PER_DAY),
    // Invites (lib/price-list.ts, lib/referral/config.ts)
    referral: credits(REFERRAL_CREDITS),
    referralMax: n(REFERRAL_MAX_REWARDS),
    referralPerDay: n(REFERRAL_MAX_PER_DAY),
    inviteDays: n(Math.round(REFERRAL_COOKIE_MAX_AGE_S / DAY_S)),
    // Imports
    uploadMb: n(Math.round(MAX_UPLOAD_BYTES / MB)),
    notionMb: n(Math.round(NOTION_IMPORT_LIMITS.maxUploadBytes / MB)),
    notionPages: n(NOTION_IMPORT_LIMITS.maxPages),
    notionTables: n(NOTION_IMPORT_LIMITS.maxDatabases),
    notionRows: n(NOTION_IMPORT_LIMITS.maxRowsPerDatabase),
    // Deadlines and planning
    icsMb: n(Math.round(MAX_ICS_FILE_BYTES / 1_000_000)),
    syncHours: n(Math.round(STALE_AFTER_MS / HOUR_MS)),
    feedsMax: n(MAX_FEEDS_PER_WORKSPACE),
    agendaDays: n(AGENDA_DAYS),
    dailyCap: n(DAILY_CAP),
    // Studying
    deckMax: n(MAX_FLASHCARDS),
    quizMax: n(MAX_QUIZ_QUESTIONS),
    freezeEvery: n(FREEZE_EVERY),
    freezeMax: n(MAX_FREEZES),
    classic: n(FOCUS_PRESETS.classic.focusMinutes),
    classicBreak: n(FOCUS_PRESETS.classic.breakMinutes),
    deep: n(FOCUS_PRESETS.deep.focusMinutes),
    deepBreak: n(FOCUS_PRESETS.deep.breakMinutes),
    quick: n(FOCUS_PRESETS.quick.focusMinutes),
    // Sharing and your data
    shareMax: n(MAX_ACTIVE_SHARES_PER_USER),
    shareRows: n(PUBLIC_ROW_CAP),
    trashDays: n(RETENTION.trashedWorkspaceDays),
  };
}

/** Every article, in catalog order. */
export function helpArticles(i18n: HelpI18n, options: HelpOptions): HelpArticle[] {
  const values = helpValues(i18n, options.models);
  const fill = (text: string) => i18n.t(text, values);
  const copy: Record<HelpSlug, HelpArticleCopy> = i18n.dict.help.articles;
  return HELP_ARTICLES.map(({ slug, topic, related }) => {
    const c = copy[slug];
    return {
      slug,
      topic,
      title: fill(c.title),
      summary: fill(c.summary),
      intro: fill(c.intro),
      steps: c.steps.map(fill),
      sections: c.sections.map((s) => ({ heading: fill(s.heading), text: fill(s.text) })),
      // Without payments the pricing page shows Pro and packs as coming soon; so does this.
      note: slug === "plans-and-credits" && !options.billing ? i18n.dict.spend.purchasesComingSoon : null,
      related: [...related],
    };
  });
}

/** Everything an article says, as one string, for the index's search box. */
export function helpSearchText(article: HelpArticle): string {
  return [
    article.title,
    article.summary,
    article.intro,
    ...article.steps,
    ...article.sections.flatMap((s) => [s.heading, s.text]),
    article.note ?? "",
  ].join(" ");
}
