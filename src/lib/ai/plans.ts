/**
 * AI model tiers by plan. Models are addressed through OpenRouter, so these are
 * OpenRouter model slugs (provider/model). Both tiers currently run on
 * z-ai/glm-5.2; split them via STUDYOS_FREE_MODEL / STUDYOS_PRO_MODEL when you
 * want the paid tier on a stronger model.
 *
 * `getPlan()` will read the signed-in user's subscription once auth + billing
 * are added; until then it's a dev override (STUDYOS_PLAN), default "free".
 */
export type Plan = "free" | "pro";

const MODELS: Record<Plan, string> = {
  free: process.env.STUDYOS_FREE_MODEL ?? "z-ai/glm-5.2",
  pro: process.env.STUDYOS_PRO_MODEL ?? "z-ai/glm-5.2",
};

export function modelForPlan(plan: Plan): string {
  return MODELS[plan];
}

export async function getPlan(): Promise<Plan> {
  // TODO: once auth + billing land, return the signed-in user's subscription.
  const override = process.env.STUDYOS_PLAN;
  if (override === "pro" || override === "free") return override;
  return "free";
}
