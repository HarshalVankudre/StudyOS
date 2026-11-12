"use server";

import { auth } from "@clerk/nextjs/server";
import { planQuestionsDetailed } from "@/lib/ai/generate";
import { modelForPlan } from "@/lib/ai/plans";
import { defaultQuestions, type GenQuestion } from "@/lib/ai/onboarding";
import { withUsageMeter } from "@/lib/ai/usage-meter";
import { getUserPlan } from "@/lib/billing";
import {
  hasCredits,
  releaseCreditHold,
  reserveCredits,
  settleCreditHold,
  usageToCredits,
} from "@/lib/credits";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/server";
import { MAX_SOURCE_INPUT, normalizeSourceText } from "@/lib/import/syllabus";
import { checkUsageLimit } from "@/lib/usage-limits";

/**
 * Credits held while the questions are written: one small model call costs a
 * few credits; the hold is settled to the metered cost.
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
 * usage meter. Credits are charged only when the model's questions were used
 * (the static fallback is free).
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

  if (!(await hasCredits(userId))) {
    return { ok: false, code: "out_of_credits", message: T.credits.outGenerate };
  }
  if (!(await checkUsageLimit(userId, "generate_questions")).allowed) {
    return { ok: false, code: "rate_limited", message: T.limits.rateLimited };
  }

  // Reserve before the model runs, so parallel calls cannot all spend the
  // same last credits; settled to the metered cost, or given back.
  const hold = await reserveCredits(userId, {
    estimate: QUESTIONS_HOLD_CREDITS,
    reason: "generate_questions",
  });
  if (!hold) {
    return { ok: false, code: "out_of_credits", message: T.credits.outGenerate };
  }

  try {
    const model = modelForPlan(await getUserPlan());
    const source = normalizeSourceText(sourceText);
    const { result, usage } = await withUsageMeter(() =>
      planQuestionsDetailed(clean, model, locale, source),
    );
    // The static fallback is free (the hold is given back in `finally`).
    if (result.fromModel) await settleCreditHold(hold, usageToCredits(usage));
    // The static fallback leaves out what the description already says (a
    // student who named two courses is not asked how many they take).
    const questions = result.fromModel ? result.questions : defaultQuestions(T.onboarding, clean);
    return { ok: true, questions };
  } finally {
    await releaseCreditHold(hold).catch(() => false);
  }
}
