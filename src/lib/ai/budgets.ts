import type { Plan } from "./plans";

/** Server-owned, plan-aware limits for one agent turn's tool-loop. */
export interface AgentBudget {
  /** Hard wall-clock ceiling for the whole turn. */
  wallTimeMs: number;
  /** Max model calls (planner + each loop step). */
  maxModelTurns: number;
  /** Max successful + attempted tool dispatches. */
  maxToolCalls: number;
  /** Max times a failed validation/apply may be retried with a corrective message. */
  maxRepairs: number;
}

const BUDGETS: Record<Plan, AgentBudget> = {
  free: { wallTimeMs: 90_000, maxModelTurns: 8, maxToolCalls: 12, maxRepairs: 2 },
  pro: { wallTimeMs: 180_000, maxModelTurns: 14, maxToolCalls: 24, maxRepairs: 2 },
};

export function budgetForPlan(plan: Plan): AgentBudget {
  return BUDGETS[plan];
}
