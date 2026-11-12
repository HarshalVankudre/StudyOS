/**
 * AI model tiers by plan. A value is either an OpenRouter slug (provider/model)
 * or a bare Claude id (`claude-…`), which is served by the Anthropic API on
 * ANTHROPIC_API_KEY instead (see ./provider). By default both tiers run on
 * z-ai/glm-5.2; split them via STUDYOS_FREE_MODEL / STUDYOS_PRO_MODEL when you
 * want the paid tier on a stronger model.
 *
 * The signed-in user's plan comes from `getUserPlan()` in lib/billing.
 */
export type Plan = "free" | "pro";

const MODELS: Record<Plan, string> = {
  free: process.env.STUDYOS_FREE_MODEL ?? "z-ai/glm-5.2",
  pro: process.env.STUDYOS_PRO_MODEL ?? "z-ai/glm-5.2",
};

export function modelForPlan(plan: Plan): string {
  return MODELS[plan];
}
