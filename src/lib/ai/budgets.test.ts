import { describe, expect, it } from "vitest";
import { budgetForPlan } from "./budgets";

describe("agent budgets", () => {
  it("gives pro a larger envelope than free", () => {
    const free = budgetForPlan("free");
    const pro = budgetForPlan("pro");
    expect(free.maxModelTurns).toBe(8);
    expect(free.maxToolCalls).toBe(12);
    expect(free.wallTimeMs).toBe(90_000);
    expect(pro.maxModelTurns).toBe(14);
    expect(pro.maxToolCalls).toBe(24);
    expect(pro.wallTimeMs).toBe(180_000);
    expect(free.maxRepairs).toBe(2);
    expect(pro.maxRepairs).toBe(2);
  });
});
