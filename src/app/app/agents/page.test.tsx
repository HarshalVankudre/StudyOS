import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";

const mocks = vi.hoisted(() => ({
  getAgentCenterSnapshot: vi.fn(),
  getI18n: vi.fn(),
}));

vi.mock("@/lib/agents/daily-study/store", () => ({
  getAgentCenterSnapshot: mocks.getAgentCenterSnapshot,
}));
vi.mock("@/lib/i18n/server", () => ({ getI18n: mocks.getI18n }));
vi.mock("@/components/account/AccountMenu", () => ({
  AccountMenu: () => <div data-testid="account-menu" />,
}));
vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher" />,
}));
vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));
vi.mock("./DailyAgentBootstrap", () => ({
  DailyAgentBootstrap: () => <div data-testid="agent-bootstrap" />,
}));
vi.mock("./PendingButton", () => ({
  PendingButton: ({ idleLabel }: { idleLabel: string }) => (
    <button type="submit">{idleLabel}</button>
  ),
}));
vi.mock("./TimezoneInput", () => ({
  TimezoneInput: () => <input type="hidden" name="timeZone" value="UTC" readOnly />,
}));
vi.mock("./actions", () => ({
  runDailyStudyAgentAction: vi.fn(),
  saveDailyStudyAgentConfigAction: vi.fn(),
  toggleDailyStudyItemAction: vi.fn(),
}));

import AgentCenterPage from "./page";

describe("Agent Center page", () => {
  beforeEach(() => {
    mocks.getI18n.mockResolvedValue({ dict: en, locale: "en", t: fmt });
    mocks.getAgentCenterSnapshot.mockResolvedValue({
      config: { enabled: true, dailyMinutes: 60, timeZone: "Europe/Berlin" },
      plan: {
        id: "plan-1",
        localDate: "2026-07-11",
        timeZone: "Europe/Berlin",
        summary: "One focused session.",
        sourceCount: 2,
        candidateCount: 4,
        generatedAt: new Date("2026-07-11T08:00:00.000Z"),
        items: [
          {
            id: "deadline:ws-1:assignments:essay",
            kind: "deadline",
            title: "Essay draft",
            source: "Semester HQ · Assignments",
            reason: "Due tomorrow — make visible progress today.",
            workspaceId: "ws-1",
            href: "/app/ws-1",
            durationMinutes: 45,
            dueDate: "2026-07-12",
            completed: false,
          },
        ],
      },
      runs: [
        {
          id: "run-1",
          trigger: "auto",
          status: "completed",
          summary: "One focused session.",
          error: null,
          startedAt: new Date("2026-07-11T08:00:00.000Z"),
          completedAt: new Date("2026-07-11T08:00:01.000Z"),
        },
      ],
    });
  });

  it("renders the plan, controls, boundaries, and transparent activity", async () => {
    render(await AgentCenterPage());

    expect(
      screen.getByRole("heading", { name: en.agentCenter.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(en.agentCenter.enabled)).toBeInTheDocument();
    expect(screen.getByText("Essay draft")).toBeInTheDocument();
    expect(screen.getByText("Due tomorrow — make visible progress today.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open workspace/i })).toHaveAttribute(
      "href",
      "/app/ws-1",
    );
    expect(screen.getByText(en.agentCenter.writesBody)).toBeInTheDocument();
    expect(screen.getByText(en.agentCenter.autoTrigger)).toBeInTheDocument();
    expect(screen.getAllByText(en.agentCenter.completedStatus)).not.toHaveLength(0);
  });
});
