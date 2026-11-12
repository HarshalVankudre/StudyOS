// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordUsage } from "@/lib/ai/usage-meter";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  planQuestionsDetailed: vi.fn(),
  getCreditBalance: vi.fn(),
  // The configured Haiku: a build's price is fixed, its questions included.
  model: "claude-haiku-5-5",
  chargeCredits: vi.fn(),
  reserveCredits: vi.fn(),
  settleCreditHold: vi.fn(),
  releaseCreditHold: vi.fn(),
  checkUsageLimit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/ai/generate", () => ({ planQuestionsDetailed: mocks.planQuestionsDetailed }));
vi.mock("@/lib/billing", () => ({ getUserPlan: vi.fn(async () => "free") }));
vi.mock("@/lib/ai/plans", () => ({ modelForPlan: () => mocks.model }));
vi.mock("@/lib/credits", () => ({
  getCreditBalance: mocks.getCreditBalance,
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
import { buildQuote } from "@/lib/price-list";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";

const QUESTIONS = [
  { id: "q", question: "Level?", type: "single", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
];

const HOLD = { id: "hold-q", userId: "user-1", amount: 5, reason: "generate_questions" };

beforeEach(() => {
  mocks.reserveCredits.mockResolvedValue(HOLD);
  mocks.settleCreditHold.mockImplementation(async (_hold: unknown, actual: number) => actual);
  mocks.releaseCreditHold.mockResolvedValue(true);
  mocks.auth.mockResolvedValue({ userId: "user-1" });
  mocks.getCreditBalance.mockResolvedValue(100);
  mocks.model = "claude-haiku-5-5";
  mocks.reserveCredits.mockClear();
  mocks.settleCreditHold.mockClear();
  mocks.releaseCreditHold.mockClear();
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

  it("stops before the model when the student cannot afford the build the questions are part of", async () => {
    mocks.getCreditBalance.mockResolvedValue(0);
    expect(await planQuestionsAction("CS student")).toMatchObject({ ok: false, code: "out_of_credits" });
    mocks.getCreditBalance.mockResolvedValue(29);
    expect(await planQuestionsAction("CS student")).toEqual({
      ok: false,
      code: "out_of_credits",
      message: fmt(en.spend.belowMinimum, { min: 30 }),
    });
    expect(mocks.planQuestionsDetailed).not.toHaveBeenCalled();
  });

  it("on the configured model the questions are included in the build's price: no charge, no hold", async () => {
    expect(await planQuestionsAction("CS student")).toEqual({ ok: true, questions: QUESTIONS });
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
    expect(mocks.settleCreditHold).not.toHaveBeenCalled();
    expect(mocks.chargeCredits).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    mocks.checkUsageLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    expect(await planQuestionsAction("CS student")).toMatchObject({ ok: false, code: "rate_limited" });
    expect(mocks.checkUsageLimit).toHaveBeenCalledWith("user-1", "generate_questions");
    expect(mocks.planQuestionsDetailed).not.toHaveBeenCalled();
  });

  it("on a model whose builds cost their real price, holds credits first and charges the metered cost", async () => {
    mocks.model = "claude-opus-5-5";
    mocks.getCreditBalance.mockResolvedValue(buildQuote("claude-opus-5-5").price);
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
    mocks.model = "claude-opus-5-5";
    mocks.getCreditBalance.mockResolvedValue(buildQuote("claude-opus-5-5").price);
    mocks.reserveCredits.mockResolvedValue(null);
    expect(await planQuestionsAction("CS student")).toMatchObject({ ok: false, code: "out_of_credits" });
    expect(mocks.planQuestionsDetailed).not.toHaveBeenCalled();
  });

  it("does not charge for the static fallback questions (the hold is given back)", async () => {
    mocks.model = "claude-opus-5-5";
    mocks.getCreditBalance.mockResolvedValue(buildQuote("claude-opus-5-5").price);
    mocks.planQuestionsDetailed.mockResolvedValue({ questions: QUESTIONS, fromModel: false });
    await planQuestionsAction("CS student");
    expect(mocks.settleCreditHold).not.toHaveBeenCalled();
    expect(mocks.chargeCredits).not.toHaveBeenCalled();
    expect(mocks.releaseCreditHold).toHaveBeenCalledWith(HOLD);
  });

  it("fallback questions skip what the description already answers", async () => {
    mocks.planQuestionsDetailed.mockResolvedValue({ questions: QUESTIONS, fromModel: false });
    const result = await planQuestionsAction(
      "I'm taking Intro Microeconomics and Renaissance Art History this semester.",
    );
    expect(result.ok).toBe(true);
    const ids = result.ok ? result.questions.map((q) => q.id) : [];
    expect(ids).not.toContain("load");
    expect(ids).toContain("level");
  });

  it("gives the hold back when the model call throws", async () => {
    mocks.model = "claude-opus-5-5";
    mocks.getCreditBalance.mockResolvedValue(buildQuote("claude-opus-5-5").price);
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
    expect(mocks.getCreditBalance).not.toHaveBeenCalled();
    expect(mocks.checkUsageLimit).not.toHaveBeenCalled();
    expect(mocks.planQuestionsDetailed).not.toHaveBeenCalled();
  });

  it("accepts source material up to the client's limit and passes it normalised", async () => {
    await planQuestionsAction("CS student", "Midterm   \n\n\n\nFinal" + " ".repeat(100_000));
    expect(mocks.planQuestionsDetailed).toHaveBeenCalledWith("CS student", expect.any(String), "en", "Midterm\n\nFinal");
  });
});
