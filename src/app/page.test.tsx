import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getI18n: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <div data-testid="user-button" />,
}));
vi.mock("@/lib/i18n/server", () => ({ getI18n: mocks.getI18n }));
vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher" />,
}));
vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

import Home from "./page";

describe("landing page", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ userId: null });
    mocks.getI18n.mockResolvedValue({ dict: en, locale: "en" });
  });

  test("renders the product-first chapter structure and proof points", async () => {
    render(await Home());

    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("02")).toBeInTheDocument();
    expect(screen.getByText("03")).toBeInTheDocument();
    expect(screen.getByText("agent · connected")).toBeInTheDocument();
    expect(screen.getAllByText("Assignments")).not.toHaveLength(0);
    expect(screen.getByText("June")).toBeInTheDocument();
    expect(screen.getByText("avg workspace build")).toBeInTheDocument();
    expect(screen.getByText("views from one dataset")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /build your workspace/i }),
    ).toHaveAttribute("href", "/generate");
  });
});
