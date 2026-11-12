/**
 * What StudyOS sells, in one place: the plans, the credit price of every AI
 * action, the limits each plan has, and the Pro prices shown while billing
 * is off.
 *
 *   Free   a trial: TRIAL_CREDITS once, at sign-up, and nothing more.
 *   Pro    PRO_MONTHLY_CREDITS for each paid month, higher hourly limits
 *          (USAGE_LIMITS) and a higher per-message ceiling (TURN_CREDIT_CAP).
 *   Both   every feature. Studying (flashcard reviews, quizzes, Today, the
 *          grade tracker, editing, export) never uses credits on any plan.
 *
 * AI actions have fixed, published prices (ACTION_PRICES). A run is reserved
 * at, and charged, its price; a failure that delivered nothing is free; a
 * stopped run is charged the share of the price for the work it completed
 * (chargeForPartial). When the configured model is expensive enough that an
 * action's real cost exceeds its list price, the action is charged its real
 * cost instead: every quote (buildQuote, messageQuote, studyKitQuote) says,
 * for a model, what a run is shown and charged (`price`) and the most it can
 * be charged (`max`), and the pages show those before the student starts.
 * So the list price is a floor per action, never a promise the code breaks.
 *
 * Every page and message that states one of these numbers reads it from
 * here: the pricing, landing, credits, settings, generator and terms pages,
 * the assistant chat, the study-kit dialog and the refusals. The module is
 * built by `createPriceList`, so a test can build it with other numbers and
 * check that every page follows (src/lib/price-list.pages.test.tsx); the
 * README is checked against it by src/lib/price-list.test.ts.
 *
 * Pure and client-safe. Quotes depend on the model, which only the server
 * knows (lib/ai/plans.ts reads the environment): price on the server and
 * pass the quote to client components.
 */
import type { CallTokens } from "@/lib/ai/model-pricing";
import type { Plan } from "@/lib/ai/plans";
import {
  addTokens,
  MAX_BUILD_TOKENS,
  MAX_KIT_SECTION_TOKENS,
  tokensCredits,
  tokensUsd,
  typicalTokens,
} from "@/lib/credits-info";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Kinds of work with a per-user rate limit (lib/usage-limits.ts). */
export type LimitedKind =
  | "generate"
  | "generate_questions"
  | "agent"
  | "sandbox_run"
  | "search"
  | "study_kit"
  | "material_upload"
  | "feed_sync"
  | "generate_failed"
  | "study_kit_failed"
  | "workspace_duplicate"
  | "syllabus_upload"
  | "daily_plan";

export type UsageLimits = Record<LimitedKind, { free: number; pro: number; windowMs: number }>;

/** Per-window request caps. Generous for real users, hard walls for abuse. */
const DEFAULT_USAGE_LIMITS: UsageLimits = {
  // Workspace generations are the most expensive request (~100s of model time).
  generate: { free: 10, pro: 30, windowMs: HOUR },
  // Onboarding questions before a generation (one small model call each).
  generate_questions: { free: 20, pro: 60, windowMs: HOUR },
  // Agent chat turns.
  agent: { free: 60, pro: 180, windowMs: HOUR },
  // Sandbox runs cost real Daytona compute per call — cap per day.
  sandbox_run: { free: 20, pro: 60, windowMs: DAY },
  // Command-palette searches (debounced as the student types). Not a paid
  // feature, so the same cap for everyone; only a runaway client hits it.
  search: { free: 600, pro: 600, windowMs: HOUR },
  // Study kits from the student's material (up to 10 model calls each).
  study_kit: { free: 10, pro: 30, windowMs: HOUR },
  // Material uploads and pastes (text extraction is CPU work, no model call).
  material_upload: { free: 30, pro: 90, windowMs: HOUR },
  // Calendar feed fetches (previews and syncs; an outbound request each).
  // Sync-on-open runs at most every few hours per feed, so this only stops
  // a runaway client or someone using StudyOS as a fetch proxy.
  feed_sync: { free: 30, pro: 30, windowMs: HOUR },
  // Workspace generations that FAILED (nothing delivered, nothing charged).
  // Counted separately so honest failures stay free for students while
  // provoking failures on purpose (two long model calls each, never billed)
  // is bounded: past this, new generations wait.
  generate_failed: { free: 3, pro: 6, windowMs: DAY },
  // Study kits that FAILED (nothing verifiable made, nothing charged): the
  // same bound for the same reason (up to 10 model calls each, never billed).
  study_kit_failed: { free: 3, pro: 6, windowMs: DAY },
  // Workspace copies (each up to 2 MB of storage).
  workspace_duplicate: { free: 20, pro: 40, windowMs: HOUR },
  // Syllabus file uploads (POST /api/import/syllabus): each starts a capped
  // extraction process. A student uploads a handful; retries fit easily.
  syllabus_upload: { free: 20, pro: 60, windowMs: HOUR },
  // "Plan my day" / "Rebuild from today": no model call, but each one loads
  // and plans across every workspace the student owns.
  daily_plan: { free: 30, pro: 30, windowMs: HOUR },
};

/** The numbers a price list is made of (see the header). */
export interface PriceListConfig {
  /** Credits a new account receives once (the Free trial). */
  trialCredits: number;
  /** Credits for each paid month of Pro. */
  proMonthlyCredits: number;
  /** Pro prices shown while billing is off (USD). With billing on, the Stripe Prices are shown. */
  proFallbackUsd: { month: number; year: number };
  /** The buyable credit pack, and what its checkout charges. */
  creditPack: { credits: number; usd: number };
  /** Published credit price of each AI action. */
  actions: {
    /** Building a workspace, its setup questions included. */
    build: number;
    /** One assistant message. */
    message: number;
    /** One part (section) of the material a study kit processes. */
    studyKitPart: number;
    /** One rendered visual from the sandbox. */
    render: number;
  };
  /** The most one assistant message may spend, renders included (a safety limit). */
  turnCreditCap: Record<Plan, number>;
  /** Uncharged failed assistant messages per student per day. */
  freeFailuresPerDay: number;
  usageLimits: UsageLimits;
}

export const DEFAULT_PRICE_LIST: PriceListConfig = {
  trialCredits: 300,
  proMonthlyCredits: 1000,
  proFallbackUsd: { month: 7.99, year: 39.99 },
  creditPack: { credits: 1000, usd: 10 },
  actions: { build: 30, message: 3, studyKitPart: 10, render: 2 },
  turnCreditCap: { free: 30, pro: 100 },
  freeFailuresPerDay: 3,
  usageLimits: DEFAULT_USAGE_LIMITS,
};

/**
 * What one action is shown and charged on one model. On a model whose real
 * cost stays within the list price, `price` and `max` are the list price: the
 * charge is exactly the list price (isFixedPrice).
 */
export interface PriceQuote {
  /** The published list price. */
  list: number;
  /** What a typical run is charged: the list price, or the model's typical real cost when higher. */
  price: number;
  /** The most a run may be charged (and what is reserved for it). */
  max: number;
}

/** True when the charge is exactly the list price on this model. */
export function isFixedPrice(quote: PriceQuote): boolean {
  return quote.price === quote.list && quote.max === quote.list;
}

/** The quotes the pages show for one plan's model. */
export interface PlanQuotes {
  build: PriceQuote;
  message: PriceQuote;
  /** One study-kit part (multiply by the parts of a run: studyKitQuote). */
  studyKitPart: PriceQuote;
  render: number;
}

/** How many of each action a balance covers, and one mix of them (see creditExamples). */
export interface CreditExamples {
  builds: number;
  parts: number;
  messages: number;
  mix: { builds: number; parts: number; messages: number };
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 1);

const quoteOf = (list: number, typicalReal: number, maxReal: number): PriceQuote => {
  const price = Math.max(list, typicalReal);
  return { list, price, max: Math.max(price, maxReal) };
};

/** Build the price list from `config` (the live one is DEFAULT_PRICE_LIST, exported below). */
export function createPriceList(config: PriceListConfig) {
  const A = config.actions;
  const questions = (model: string): CallTokens => typicalTokens(model, "questions");

  /** Building a workspace on `model`, its setup questions included. */
  function buildQuote(model: string): PriceQuote {
    return quoteOf(
      A.build,
      tokensCredits(model, addTokens(typicalTokens(model, "build"), questions(model))),
      tokensCredits(model, addTokens(MAX_BUILD_TOKENS, questions(model))),
    );
  }

  /** The USD a typical build (questions included) uses on `model`: the base of a stopped build's share. */
  function buildTypicalUsd(model: string): number {
    return tokensUsd(model, addTokens(typicalTokens(model, "build"), questions(model)));
  }

  /**
   * One assistant message on `model` for `plan`. A long request can cost
   * more than the list price on any model; it is then charged its real
   * cost, never more than the plan's per-message ceiling (`max`).
   */
  function messageQuote(model: string, plan: Plan): PriceQuote {
    const cap = config.turnCreditCap[plan];
    const price = Math.min(cap, Math.max(A.message, tokensCredits(model, typicalTokens(model, "edit"))));
    return { list: A.message, price, max: Math.max(price, cap) };
  }

  /** One study-kit part on `model`. */
  function studyKitPartQuote(model: string): PriceQuote {
    return quoteOf(
      A.studyKitPart,
      tokensCredits(model, typicalTokens(model, "kitSection")),
      tokensCredits(model, MAX_KIT_SECTION_TOKENS),
    );
  }

  /** A study kit of `parts` parts, from one part's quote (a model id prices it). */
  function studyKitQuote(parts: number, part: PriceQuote | string): PriceQuote {
    const each = typeof part === "string" ? studyKitPartQuote(part) : part;
    const n = Math.max(0, Math.floor(parts));
    return { list: n * each.list, price: n * each.price, max: n * each.max };
  }

  /** The quotes for one plan's model. */
  function planQuotes(model: string, plan: Plan): PlanQuotes {
    return {
      build: buildQuote(model),
      message: messageQuote(model, plan),
      studyKitPart: studyKitPartQuote(model),
      render: A.render,
    };
  }

  /** The higher of two quotes, field by field (what a page shows for both plans at once). */
  function higherQuote(a: PriceQuote, b: PriceQuote): PriceQuote {
    return { list: Math.max(a.list, b.list), price: Math.max(a.price, b.price), max: Math.max(a.max, b.max) };
  }

  /**
   * The quotes a public page shows for both plans: each action at the higher
   * of the two plans' models (the message ceiling is per plan and is shown
   * separately, from TURN_CREDIT_CAP).
   */
  function publicQuotes(models: Record<Plan, string>): PlanQuotes {
    const free = planQuotes(models.free, "free");
    const pro = planQuotes(models.pro, "pro");
    return {
      build: higherQuote(free.build, pro.build),
      message: { ...higherQuote(free.message, pro.message), max: Math.max(free.message.max, pro.message.max) },
      studyKitPart: higherQuote(free.studyKitPart, pro.studyKitPart),
      render: A.render,
    };
  }

  /**
   * The charge for a run that completed: its price, or its real cost when
   * higher, never above `max`. Nothing when no model ran at all (the local
   * mock, which reports no usage).
   */
  function chargeForCompleted(quote: PriceQuote, realCredits: number): number {
    const real = Math.max(0, Math.ceil(realCredits));
    if (real <= 0) return 0;
    return Math.min(quote.max, Math.max(quote.list, real));
  }

  /**
   * The charge for a run that stopped part-way (cancelled, or a failure past
   * the daily free allowance): the share of the list price for the work it
   * completed (`fraction`, 0..1), never more than the list price. When its
   * real cost already exceeds the list price (an expensive model), the real
   * cost, never above `max`.
   */
  function chargeForPartial(quote: PriceQuote, realCredits: number, fraction: number): number {
    const real = Math.max(0, Math.ceil(realCredits));
    if (real <= 0) return 0; // no model ran
    if (real > quote.list) return Math.min(quote.max, real);
    return Math.min(quote.list, Math.max(0, Math.ceil(quote.list * clamp01(fraction) - 1e-9)));
  }

  /**
   * How many builds, study-kit parts or messages `credits` cover at these
   * prices, and one mix: about a tenth of it on builds, three tenths on
   * study-kit parts, the rest on messages.
   */
  function creditExamples(credits: number, q: Pick<PlanQuotes, "build" | "message" | "studyKitPart">): CreditExamples {
    const c = Math.max(0, Math.floor(credits));
    const per = (n: number, each: number) => (each > 0 ? Math.floor(n / each) : 0);
    const builds = Math.max(c >= q.build.price ? 1 : 0, per(c * 0.1, q.build.price));
    const parts = per(c * 0.3, q.studyKitPart.price);
    const left = c - builds * q.build.price - parts * q.studyKitPart.price;
    return {
      builds: per(c, q.build.price),
      parts: per(c, q.studyKitPart.price),
      messages: per(c, q.message.price),
      mix: { builds, parts, messages: per(Math.max(0, left), q.message.price) },
    };
  }

  /** Whole percent saved by the yearly fallback price against twelve months. */
  const fallbackYearlySavings = Math.max(
    0,
    Math.floor((1 - config.proFallbackUsd.year / (config.proFallbackUsd.month * 12)) * 100 + 1e-9),
  );

  return {
    TRIAL_CREDITS: config.trialCredits,
    PRO_MONTHLY_CREDITS: config.proMonthlyCredits,
    PRO_FALLBACK_MONTHLY_USD: config.proFallbackUsd.month,
    PRO_FALLBACK_ANNUAL_USD: config.proFallbackUsd.year,
    PRO_FALLBACK_YEARLY_SAVINGS: fallbackYearlySavings,
    CREDIT_PACK_SIZE: config.creditPack.credits,
    CREDIT_PACK_PRICE_USD: config.creditPack.usd,
    ACTION_PRICES: A,
    RENDER_CREDITS: A.render,
    TURN_CREDIT_CAP: config.turnCreditCap,
    FREE_FAILURES_PER_DAY: config.freeFailuresPerDay,
    USAGE_LIMITS: config.usageLimits,
    buildQuote,
    buildTypicalUsd,
    messageQuote,
    studyKitPartQuote,
    studyKitQuote,
    planQuotes,
    publicQuotes,
    chargeForCompleted,
    chargeForPartial,
    creditExamples,
  };
}

export type PriceList = ReturnType<typeof createPriceList>;

const LIVE = createPriceList(DEFAULT_PRICE_LIST);

export const {
  TRIAL_CREDITS,
  PRO_MONTHLY_CREDITS,
  PRO_FALLBACK_MONTHLY_USD,
  PRO_FALLBACK_ANNUAL_USD,
  PRO_FALLBACK_YEARLY_SAVINGS,
  CREDIT_PACK_SIZE,
  CREDIT_PACK_PRICE_USD,
  ACTION_PRICES,
  RENDER_CREDITS,
  TURN_CREDIT_CAP,
  FREE_FAILURES_PER_DAY,
  USAGE_LIMITS,
  buildQuote,
  buildTypicalUsd,
  messageQuote,
  studyKitPartQuote,
  studyKitQuote,
  planQuotes,
  publicQuotes,
  chargeForCompleted,
  chargeForPartial,
  creditExamples,
} = LIVE;
