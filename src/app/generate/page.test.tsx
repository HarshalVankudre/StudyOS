import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  hasCredits: vi.fn(),
  plan: vi.fn(),
  models: { free: "z-ai/glm-5.2", pro: "z-ai/glm-5.2" } as Record<string, string>,
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/credits", () => ({ hasCredits: mocks.hasCredits }));
vi.mock("@/lib/billing", () => ({ getUserPlan: mocks.plan }));
vi.mock("@/lib/ai/plans", () => ({ modelForPlan: (plan: string) => mocks.models[plan] }));
vi.mock("./GeneratorClient", () => ({
  GeneratorClient: ({
    initialPrompt,
    outOfCredits,
    minCredits,
  }: {
    initialPrompt?: string;
    outOfCredits?: boolean;
    minCredits?: number;
  }) => (
    <div
      data-testid="generator"
      data-initial-prompt={initialPrompt}
      data-min-credits={String(minCredits)}
      data-out-of-credits={String(Boolean(outOfCredits))}
    />
  ),
}));

import GeneratePage from "./page";
import { buildCreditCost } from "@/lib/credits-info";

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "user-1" });
  mocks.hasCredits.mockResolvedValue(true);
  mocks.plan.mockResolvedValue("free");
  mocks.models.free = "z-ai/glm-5.2";
});

describe("generate page", () => {
  test("passes a landing-page prompt into the generator", async () => {
    render(
      await GeneratePage({
        searchParams: Promise.resolve({ prompt: "Organic chemistry finals" }),
      }),
    );

    expect(screen.getByTestId("generator")).toHaveAttribute(
      "data-initial-prompt",
      "Organic chemistry finals",
    );
  });

  test("ignores repeated prompt parameters", async () => {
    render(
      await GeneratePage({
        searchParams: Promise.resolve({ prompt: ["first", "second"] }),
      }),
    );

    expect(screen.getByTestId("generator")).toHaveAttribute(
      "data-initial-prompt",
      "",
    );
  });

  test("tells the generator up front when the student is out of credits", async () => {
    mocks.hasCredits.mockResolvedValue(false);
    render(await GeneratePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId("generator")).toHaveAttribute("data-out-of-credits", "true");
  });

  test("a failed credit lookup never blocks the generator", async () => {
    mocks.hasCredits.mockRejectedValue(new Error("db down"));
    render(await GeneratePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId("generator")).toHaveAttribute("data-out-of-credits", "false");
  });

  test("checks and shows the minimum for the model the student's plan runs", async () => {
    mocks.models.free = "claude-haiku-5-5";
    render(await GeneratePage({ searchParams: Promise.resolve({}) }));
    const min = buildCreditCost("claude-haiku-5-5").typical;
    expect(min).toBeLessThan(buildCreditCost("z-ai/glm-5.2").typical);
    expect(screen.getByTestId("generator")).toHaveAttribute("data-min-credits", String(min));
    expect(mocks.hasCredits).toHaveBeenCalledWith("user-1", min);
  });
});
