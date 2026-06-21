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
        stopTask: "Stop task",
        stopping: "Stopping…",
        thinking: "Thinking…",
        phase: {
          inspecting: "Understanding",
          planning: "Shaping",
          updating: "Improving",
          validating: "Checking",
          saving: "Finishing",
        },
        areaStatus: { queued: "Queued", working: "Updating", complete: "Ready" },
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
    render(
      <AgentProgressCard
        activity={activity}
        onStop={vi.fn()}
        stopping={false}
        canStop
      />,
    );
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
    render(
      <AgentProgressCard
        activity={activity}
        onStop={vi.fn()}
        stopping={false}
        canStop
      />,
    );
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
      <AgentProgressCard
        activity={activity}
        onStop={vi.fn()}
        stopping={false}
        canStop
      />,
    );
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "73",
    );
    unmount();
    vi.useRealTimers();
  });

  it("shows thinking and a prominent Stop task control", () => {
    const onStop = vi.fn();
    render(
      <AgentProgressCard
        activity={{
          ...createInitialAgentActivity("Working"),
          thinking: "Reviewing the course plan",
        }}
        onStop={onStop}
        stopping={false}
        canStop
      />,
    );

    expect(screen.getByText("Reviewing the course plan")).toBeInTheDocument();
    screen.getByRole("button", { name: "Stop task" }).click();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("disables the control and shows Stopping while cancellation is pending", () => {
    render(
      <AgentProgressCard
        activity={createInitialAgentActivity("Working")}
        onStop={vi.fn()}
        stopping
        canStop
      />,
    );
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
  });
});
