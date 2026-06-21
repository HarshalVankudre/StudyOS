import { describe, expect, it } from "vitest";
import { budgetForPlan } from "./budgets";

describe("agent budgets", () => {
  it("gives every tier the full 5-minute window", () => {
    // Must stay within the route's `maxDuration = 300`; the loop reserves a tail
    // under this for the save step (see agent-loop TAIL_RESERVE_MS).
    expect(budgetForPlan("free").wallTimeMs).toBe(300_000);
    expect(budgetForPlan("pro").wallTimeMs).toBe(300_000);
  });

  it("gives pro a larger turn/tool envelope than free", () => {
    const free = budgetForPlan("free");
    const pro = budgetForPlan("pro");
    expect(pro.maxModelTurns).toBeGreaterThan(free.maxModelTurns);
    expect(pro.maxToolCalls).toBeGreaterThan(free.maxToolCalls);
    expect(pro.maxRepairs).toBeGreaterThanOrEqual(free.maxRepairs);
  });
});
