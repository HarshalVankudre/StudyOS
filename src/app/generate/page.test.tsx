import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  hasCredits: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/credits", () => ({ hasCredits: mocks.hasCredits }));
vi.mock("./GeneratorClient", () => ({
  GeneratorClient: ({
    initialPrompt,
    outOfCredits,
  }: {
    initialPrompt?: string;
    outOfCredits?: boolean;
  }) => (
    <div
      data-testid="generator"
      data-initial-prompt={initialPrompt}
      data-out-of-credits={String(Boolean(outOfCredits))}
    />
  ),
}));

import GeneratePage from "./page";

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "user-1" });
  mocks.hasCredits.mockResolvedValue(true);
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
});
