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
}));
vi.mock("@/components/today/TodayPlan", () => ({
  TodayPlan: ({ plan, variant }: { plan: { items: { title: string }[] } | null; variant: string }) => (
    <div data-testid="today-plan" data-variant={variant}>
      {plan?.items.map((item) => <p key={item.title}>{item.title}</p>)}
    </div>
  ),
}));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

import AgentCenterPage from "./page";

describe("Agent Center page", () => {
  beforeEach(() => {
    mocks.getI18n.mockResolvedValue({ dict: en, locale: "en", t: fmt, dir: "ltr" });
    mocks.getAgentCenterSnapshot.mockResolvedValue({
      config: { enabled: true, dailyMinutes: 60, timeZone: "Europe/Berlin" },
      plan: {
        id: "plan-1",
        localDate: "2026-07-11",
        timeZone: "Europe/Berlin",
        sourceCount: 2,
        candidateCount: 4,
        generatedAt: "2026-07-11T08:00:00.000Z",
        details: { budgetMinutes: 60, workload: null, exams: [], progress: {} },
        items: [
          {
            id: "deadline:ws-1:assignments:essay",
            kind: "deadline",
            mode: "finish",
            title: "Essay draft",
            workspaceName: "Semester HQ",
            section: "Assignments",
            target: { workspaceId: "ws-1", databaseId: "assignments", rowId: "essay" },
            minutes: 45,
            reason: { code: "due_tomorrow", days: 1 },
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
          result: { v: 2, items: 3, minutes: 75, workspaces: 1 },
          startedAt: new Date("2026-07-11T08:00:00.000Z"),
          completedAt: new Date("2026-07-11T08:00:01.000Z"),
        },
        {
          id: "run-0",
          trigger: "manual",
          status: "completed",
          result: null,
          startedAt: new Date("2026-07-10T08:00:00.000Z"),
          completedAt: new Date("2026-07-10T08:00:01.000Z"),
        },
      ],
    });
  });

  it("renders today's plan, settings, honest boundaries and localized activity", async () => {
    render(await AgentCenterPage());

    expect(screen.getByRole("heading", { name: en.agentCenter.title })).toBeInTheDocument();
    expect(screen.getByText(en.agentCenter.enabled)).toBeInTheDocument();
    expect(screen.getByTestId("today-plan")).toHaveAttribute("data-variant", "center");
    expect(screen.getByText("Essay draft")).toBeInTheDocument();
    expect(screen.getByText(en.today.agentWrites)).toBeInTheDocument();
    expect(screen.getByText(en.agentCenter.autoTrigger)).toBeInTheDocument();
    // Version 2 runs are summarized in the reader's language; older runs
    // (stored as English sentences) show their status instead.
    expect(screen.getByText("Planned 3 items · 1 h 15 min")).toBeInTheDocument();
    expect(screen.getAllByText(en.agentCenter.completedStatus)).not.toHaveLength(0);
    expect(document.getElementById("settings")).not.toBeNull();
  });
});
