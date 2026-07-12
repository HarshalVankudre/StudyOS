import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("./GeneratorClient", () => ({
  GeneratorClient: ({ initialPrompt }: { initialPrompt?: string }) => (
    <div data-testid="generator" data-initial-prompt={initialPrompt} />
  ),
}));

import GeneratePage from "./page";

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
});
