"use server";

import { auth } from "@clerk/nextjs/server";
import { planQuestionsDetailed } from "@/lib/ai/generate";
import { modelForPlan } from "@/lib/ai/plans";
import { defaultQuestions, type GenQuestion } from "@/lib/ai/onboarding";
import { withUsageMeter } from "@/lib/ai/usage-meter";
import { getUserPlan } from "@/lib/billing";
import {
  getCreditBalance,
  releaseCreditHold,
  reserveCredits,
  settleCreditHold,
  usageToCredits,
  type CreditHold,
} from "@/lib/credits";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/server";
import { MAX_SOURCE_INPUT, normalizeSourceText } from "@/lib/import/syllabus";
import { buildQuote, isFixedPrice } from "@/lib/price-list";
import { checkUsageLimit } from "@/lib/usage-limits";
import { belowBuildMinimumMessage, outOfCreditsMessage } from "@/lib/credit-messages";

/**
 * Credits held while the questions are written on a model whose build price
 * is not fixed (see below): one small model call costs a few credits; the
 * hold is settled to the metered cost.
 */
const QUESTIONS_HOLD_CREDITS = 5;

/** Same cap as a generation request's prompt (POST /api/generate). */
const MAX_PROMPT_CHARS = 2000;

export type PlanQuestionsResult =
  | { ok: true; questions: GenQuestion[] }
  | {
      ok: false;
      code: "not_authenticated" | "invalid" | "out_of_credits" | "rate_limited";
      message: string;
    };

/**
 * Server Action: from the student's description (and any pasted/uploaded
 * course material), produce a few tailored multiple-choice onboarding
 * questions. Server actions are reachable by direct POST, so this is gated
 * like every other model call: signed-in user, credits, a rate limit, and a
 * usage meter.
 *
 * The questions are part of building a workspace, whose published price
 * includes them (lib/price-list.ts), so they cost nothing on their own: they
 * need a balance that covers the build (a student who cannot build is told
 * so here, before answering anything) and are bounded by their rate limit.
 * Only on a model expensive enough that a build is charged its real cost
 * (its price is not fixed) are the questions charged their real cost too,
 * through a hold, so that real cost is paid by someone; the static fallback
 * is always free.
 */
export async function planQuestionsAction(
  prompt: string,
  sourceText = "",
): Promise<PlanQuestionsResult> {
  const locale = await getLocale();
  const T = getDictionary(locale);

  const { userId } = await auth();
  if (!userId) {
    return { ok: false, code: "not_authenticated", message: T.ai.errors.notAuthenticated };
  }

  // Server actions take whatever a direct POST sends: check types and lengths
  // before anything else runs (the 3 MB body limit is the only other bound).
  if (
    typeof prompt !== "string" ||
    prompt.length > MAX_PROMPT_CHARS ||
    typeof sourceText !== "string" ||
    sourceText.length > MAX_SOURCE_INPUT
  ) {
    return { ok: false, code: "invalid", message: T.ai.errors.describeBeforeGenerating };
  }
  const clean = prompt.trim();
  if (!clean) {
    return { ok: false, code: "invalid", message: T.ai.errors.describeBeforeGenerating };
  }

  const model = modelForPlan(await getUserPlan());
  const build = buildQuote(model);
  const balance = await getCreditBalance(userId);
  if (balance < build.price) {
    return {
      ok: false,
      code: "out_of_credits",
      message: balance <= 0 ? outOfCreditsMessage(T, "generate") : belowBuildMinimumMessage(T, build.price),
    };
  }
  if (!(await checkUsageLimit(userId, "generate_questions")).allowed) {
    return { ok: false, code: "rate_limited", message: T.limits.rateLimited };
  }

  // Only when the build is charged its real cost: reserve before the model
  // runs, so parallel calls cannot all spend the same last credits; settled
  // to the metered cost, or given back.
  let hold: CreditHold | null = null;
  if (!isFixedPrice(build)) {
    hold = await reserveCredits(userId, {
      estimate: QUESTIONS_HOLD_CREDITS,
      reason: "generate_questions",
    });
    if (!hold) {
      return { ok: false, code: "out_of_credits", message: outOfCreditsMessage(T, "generate") };
    }
  }

  try {
    const source = normalizeSourceText(sourceText);
    const { result, usage } = await withUsageMeter(() =>
      planQuestionsDetailed(clean, model, locale, source),
    );
    // The static fallback is free (the hold is given back in `finally`).
    if (hold && result.fromModel) await settleCreditHold(hold, usageToCredits(usage, model));
    // The static fallback leaves out what the description already says (a
    // student who named two courses is not asked how many they take).
    const questions = result.fromModel ? result.questions : defaultQuestions(T.onboarding, clean);
    return { ok: true, questions };
  } finally {
    if (hold) await releaseCreditHold(hold).catch(() => false);
  }
}
