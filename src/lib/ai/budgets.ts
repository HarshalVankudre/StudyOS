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

// Every tier gets the full 5-minute window. The wall budget is the model-loop
// ceiling; the loop reserves a small tail under it (see agent-loop) and is
// anchored at request start, so the work still finishes within the route's
// `maxDuration = 300`. Higher tiers get more model turns / tool calls so they
// can actually use the time on richer changes.
const BUDGETS: Record<Plan, AgentBudget> = {
  free: { wallTimeMs: 300_000, maxModelTurns: 18, maxToolCalls: 30, maxRepairs: 2 },
  pro: { wallTimeMs: 300_000, maxModelTurns: 26, maxToolCalls: 44, maxRepairs: 3 },
};

export function budgetForPlan(plan: Plan): AgentBudget {
  return BUDGETS[plan];
}
