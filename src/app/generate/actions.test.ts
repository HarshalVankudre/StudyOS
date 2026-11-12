// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordUsage } from "@/lib/ai/usage-meter";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  planQuestionsDetailed: vi.fn(),
  hasCredits: vi.fn(),
  chargeCredits: vi.fn(),
  reserveCredits: vi.fn(),
  settleCreditHold: vi.fn(),
  releaseCreditHold: vi.fn(),
  checkUsageLimit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/ai/generate", () => ({ planQuestionsDetailed: mocks.planQuestionsDetailed }));
vi.mock("@/lib/billing", () => ({ getUserPlan: vi.fn(async () => "free") }));
vi.mock("@/lib/credits", () => ({
  hasCredits: mocks.hasCredits,
  chargeCredits: mocks.chargeCredits,
  reserveCredits: mocks.reserveCredits,
  settleCreditHold: mocks.settleCreditHold,
  releaseCreditHold: mocks.releaseCreditHold,
  usageToCredits: (usage: { promptTokens: number; completionTokens: number }) =>
    Math.ceil((usage.promptTokens + usage.completionTokens) / 100),
}));
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: mocks.checkUsageLimit }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: vi.fn(async () => "en") }));

import { planQuestionsAction } from "./actions";

const QUESTIONS = [
  { id: "q", question: "Level?", type: "single", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
];

const HOLD = { id: "hold-q", userId: "user-1", amount: 5, reason: "generate_questions" };

beforeEach(() => {
  mocks.reserveCredits.mockResolvedValue(HOLD);
  mocks.settleCreditHold.mockImplementation(async (_hold: unknown, actual: number) => actual);
  mocks.releaseCreditHold.mockResolvedValue(true);
  mocks.auth.mockResolvedValue({ userId: "user-1" });
  mocks.hasCredits.mockResolvedValue(true);
  mocks.checkUsageLimit.mockResolvedValue({ allowed: true, remaining: 3 });
  mocks.planQuestionsDetailed.mockImplementation(async () => {
    recordUsage({ prompt_tokens: 250, completion_tokens: 50 });
    return { questions: QUESTIONS, fromModel: true };
  });
});

describe("planQuestionsAction", () => {
  it("requires a signed-in user and never calls the model otherwise", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect(await planQuestionsAction("CS student")).toMatchObject({
      ok: false,
      code: "not_authenticated",
    });
    expect(mocks.planQuestionsDetailed).not.toHaveBeenCalled();
  });

  it("stops before the model when the student is out of credits", async () => {
    mocks.hasCredits.mockResolvedValue(false);
    expect(await planQuestionsAction("CS student")).toMatchObject({
      ok: false,
      code: "out_of_credits",
    });
    expect(mocks.planQuestionsDetailed).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    mocks.checkUsageLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    expect(await planQuestionsAction("CS student")).toMatchObject({ ok: false, code: "rate_limited" });
    expect(mocks.checkUsageLimit).toHaveBeenCalledWith("user-1", "generate_questions");
    expect(mocks.planQuestionsDetailed).not.toHaveBeenCalled();
  });

  it("holds credits before the model call, then charges the metered cost through the hold", async () => {
    expect(await planQuestionsAction("CS student", "syllabus")).toEqual({
      ok: true,
      questions: QUESTIONS,
    });
    expect(mocks.reserveCredits).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ reason: "generate_questions" }),
    );
    expect(mocks.reserveCredits.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.planQuestionsDetailed.mock.invocationCallOrder[0],
    );
    expect(mocks.settleCreditHold).toHaveBeenCalledWith(HOLD, 3);
    expect(mocks.chargeCredits).not.toHaveBeenCalled();
  });

  it("a parallel request that finds the credits already held is refused before the model", async () => {
    mocks.reserveCredits.mockResolvedValue(null);
    expect(await planQuestionsAction("CS student")).toMatchObject({ ok: false, code: "out_of_credits" });
    expect(mocks.planQuestionsDetailed).not.toHaveBeenCalled();
  });

  it("does not charge for the static fallback questions (the hold is given back)", async () => {
    mocks.planQuestionsDetailed.mockResolvedValue({ questions: QUESTIONS, fromModel: false });
    await planQuestionsAction("CS student");
    expect(mocks.settleCreditHold).not.toHaveBeenCalled();
    expect(mocks.chargeCredits).not.toHaveBeenCalled();
    expect(mocks.releaseCreditHold).toHaveBeenCalledWith(HOLD);
  });

  it("gives the hold back when the model call throws", async () => {
    mocks.planQuestionsDetailed.mockRejectedValue(new Error("provider down"));
    await expect(planQuestionsAction("CS student")).rejects.toThrow("provider down");
    expect(mocks.releaseCreditHold).toHaveBeenCalledWith(HOLD);
  });

  it("rejects an empty description", async () => {
    expect(await planQuestionsAction("   ")).toMatchObject({ ok: false, code: "invalid" });
  });

  it("rejects arguments of the wrong type or length before any work (direct POSTs)", async () => {
    const cases: unknown[][] = [
      ["x".repeat(2001)],
      [{ toString: () => "CS" }],
      ["CS student", " ".repeat(120_001)],
      ["CS student", 42],
    ];
    for (const args of cases) {
      const result = await (planQuestionsAction as (...a: unknown[]) => ReturnType<typeof planQuestionsAction>)(
        ...args,
      );
      expect(result).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(mocks.hasCredits).not.toHaveBeenCalled();
    expect(mocks.checkUsageLimit).not.toHaveBeenCalled();
    expect(mocks.planQuestionsDetailed).not.toHaveBeenCalled();
  });

  it("accepts source material up to the client's limit and passes it normalised", async () => {
    await planQuestionsAction("CS student", "Midterm   \n\n\n\nFinal" + " ".repeat(100_000));
    expect(mocks.planQuestionsDetailed).toHaveBeenCalledWith("CS student", expect.any(String), "en", "Midterm\n\nFinal");
  });
});
