"use server";

import { auth } from "@clerk/nextjs/server";
import { planQuestionsDetailed } from "@/lib/ai/generate";
import { modelForPlan } from "@/lib/ai/plans";
import type { GenQuestion } from "@/lib/ai/onboarding";
import { withUsageMeter } from "@/lib/ai/usage-meter";
import { getUserPlan } from "@/lib/billing";
import { chargeCredits, hasCredits, usageToCredits } from "@/lib/credits";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/server";
import { normalizeSourceText } from "@/lib/import/syllabus";
import { checkUsageLimit } from "@/lib/usage-limits";

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

  const clean = (typeof prompt === "string" ? prompt : "").slice(0, 2000).trim();
  if (!clean) {
    return { ok: false, code: "invalid", message: T.ai.errors.describeBeforeGenerating };
  }

  if (!(await hasCredits(userId))) {
    return { ok: false, code: "out_of_credits", message: T.credits.outGenerate };
  }
  if (!(await checkUsageLimit(userId, "generate_questions")).allowed) {
    return { ok: false, code: "rate_limited", message: T.limits.rateLimited };
  }

  const model = modelForPlan(await getUserPlan());
  const source = normalizeSourceText(typeof sourceText === "string" ? sourceText : "");
  const { result, usage } = await withUsageMeter(() =>
    planQuestionsDetailed(clean, model, locale, source),
  );
  if (result.fromModel) {
    await chargeCredits(userId, usageToCredits(usage), "generate_questions");
  }
  return { ok: true, questions: result.questions };
}
