// "Plan my day" / "Rebuild from today" are throttled per user: each one
// loads and plans across every workspace the student owns.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  run: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: m.auth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/agents/daily-study/store", () => ({
  runDailyStudyAgent: m.run,
  setDailyStudyItemCompleted: vi.fn(),
  updateDailyStudyAgentConfig: vi.fn(),
}));
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: m.limit }));

import { rebuildTodayAction, runDailyStudyAgentAction } from "./actions";

beforeEach(() => {
  m.auth.mockReset().mockResolvedValue({ userId: "user_1" });
  m.run.mockReset().mockResolvedValue(null);
  m.limit.mockReset().mockResolvedValue({ allowed: true, remaining: 5 });
});

describe("rebuildTodayAction", () => {
  it("plans when the student is under the limit", async () => {
    expect(await rebuildTodayAction({ timeZone: "Europe/Berlin", minutes: 30 })).toEqual({ ok: true });
    expect(m.limit).toHaveBeenCalledWith("user_1", "daily_plan");
    expect(m.run).toHaveBeenCalledWith(expect.objectContaining({ trigger: "manual", todayMinutes: 30 }));
  });

  it("refuses without planning once the limit is reached", async () => {
    m.limit.mockResolvedValue({ allowed: false, remaining: 0 });
    expect(await rebuildTodayAction({ minutes: 30 })).toEqual({ ok: false });
    expect(m.run).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller without planning", async () => {
    m.auth.mockResolvedValue({ userId: null });
    expect(await rebuildTodayAction({})).toEqual({ ok: false });
    expect(m.limit).not.toHaveBeenCalled();
    expect(m.run).not.toHaveBeenCalled();
  });

  it("the form variant goes through the same limit", async () => {
    m.limit.mockResolvedValue({ allowed: false, remaining: 0 });
    const form = new FormData();
    form.set("minutes", "45");
    await runDailyStudyAgentAction(form);
    expect(m.limit).toHaveBeenCalledWith("user_1", "daily_plan");
    expect(m.run).not.toHaveBeenCalled();
  });
});
