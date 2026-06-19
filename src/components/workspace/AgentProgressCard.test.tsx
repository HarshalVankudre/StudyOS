import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createInitialAgentActivity } from "@/lib/ai/progress";
import { AgentProgressCard } from "./AgentProgressCard";

vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({
    dict: {
      common: { cancel: "Cancel" },
      agentChat: {
        buildingUpdate: "Making it feel effortless",
        phase: {
          inspecting: "Understanding",
          planning: "Shaping",
          updating: "Improving",
          validating: "Checking",
          saving: "Finishing",
        },
      },
    },
  }),
}));

describe("AgentProgressCard", () => {
  it("shows a visible, accessible percentage", () => {
    const activity = {
      ...createInitialAgentActivity("Creating more breathing room"),
      progress: 68,
    };
    render(<AgentProgressCard activity={activity} onCancel={vi.fn()} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "68",
    );
    expect(screen.getByText("68%")).toBeInTheDocument();
  });

  it("shows discoveries without technical details", () => {
    const activity = {
      ...createInitialAgentActivity("Improving"),
      discoveries: [
        {
          id: "layout",
          title: "Layout understood",
          detail: "I found where the dashboard was crowded",
        },
      ],
    };
    render(<AgentProgressCard activity={activity} onCancel={vi.fn()} />);
    expect(screen.getByText("Layout understood")).toBeInTheDocument();
    expect(
      screen.getByText("I found where the dashboard was crowded"),
    ).toBeInTheDocument();
  });

  it("animates but does not cross the active phase ceiling", () => {
    vi.useFakeTimers();
    const activity = {
      ...createInitialAgentActivity("Improving"),
      phase: "updating" as const,
      progress: 35,
    };
    const { unmount } = render(
      <AgentProgressCard activity={activity} onCancel={vi.fn()} />,
    );
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "73",
    );
    unmount();
    vi.useRealTimers();
  });
});
