// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordUsage } from "@/lib/ai/usage-meter";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  planQuestionsDetailed: vi.fn(),
  hasCredits: vi.fn(),
  chargeCredits: vi.fn(),
  checkUsageLimit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/ai/generate", () => ({ planQuestionsDetailed: mocks.planQuestionsDetailed }));
vi.mock("@/lib/billing", () => ({ getUserPlan: vi.fn(async () => "free") }));
vi.mock("@/lib/credits", () => ({
  hasCredits: mocks.hasCredits,
  chargeCredits: mocks.chargeCredits,
  usageToCredits: (usage: { promptTokens: number; completionTokens: number }) =>
    Math.ceil((usage.promptTokens + usage.completionTokens) / 100),
}));
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: mocks.checkUsageLimit }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: vi.fn(async () => "en") }));

import { planQuestionsAction } from "./actions";

const QUESTIONS = [
  { id: "q", question: "Level?", type: "single", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
];

beforeEach(() => {
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

  it("meters and charges the model call", async () => {
    expect(await planQuestionsAction("CS student", "syllabus")).toEqual({
      ok: true,
      questions: QUESTIONS,
    });
    expect(mocks.chargeCredits).toHaveBeenCalledWith("user-1", 3, "generate_questions");
  });

  it("does not charge for the static fallback questions", async () => {
    mocks.planQuestionsDetailed.mockResolvedValue({ questions: QUESTIONS, fromModel: false });
    await planQuestionsAction("CS student");
    expect(mocks.chargeCredits).not.toHaveBeenCalled();
  });

  it("rejects an empty description", async () => {
    expect(await planQuestionsAction("   ")).toMatchObject({ ok: false, code: "invalid" });
  });
});
