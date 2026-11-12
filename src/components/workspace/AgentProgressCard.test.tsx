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
        liveSteps: {
          reading: "Reading your workspace",
          finding: "Finding the right pages and entries",
          checking: "Checking the changes",
          visual: "Building a visual",
          lookup: "Looking something up",
          retrying: "Fixing a change that didn’t fit",
          working: "Working on your workspace",
          addPage: "Adding a page",
          editPage: "Editing a page",
          removePage: "Removing a page",
          addRows: "Adding entries",
          updateRows: "Updating entries",
          removeRows: "Removing entries",
          addDatabase: "Adding a table",
          editDatabase: "Adjusting a table",
          removeDatabase: "Removing a table",
          grades: "Setting up grades",
          workspace: "Updating workspace settings",
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

  it("describes finished steps in friendly words, never the server’s technical text", () => {
    const activity = {
      ...createInitialAgentActivity("Improving"),
      discoveries: [
        {
          id: "tool-1",
          title: "Reviewed the whole workspace",
          detail: "pages: p-1 (add_page operation), unique ids",
          step: { tool: "summarize_workspace" },
        },
        {
          id: "tool-2",
          title: "Staged 3 change(s)",
          step: { tool: "apply_ops", ok: true, ops: ["add_page", "update_row", "update_row"] },
        },
      ],
    };
    render(<AgentProgressCard activity={activity} onStop={vi.fn()} stopping={false} canStop />);
    expect(screen.getByText("Reading your workspace")).toBeInTheDocument();
    expect(screen.getByText("Adding a page · Updating entries")).toBeInTheDocument();
    expect(screen.queryByText(/Staged|add_page|unique ids|Reviewed the whole/)).not.toBeInTheDocument();
  });

  it("shows a neutral line for steps from an older server without step data", () => {
    const activity = {
      ...createInitialAgentActivity("Improving"),
      discoveries: [{ id: "tool-1", title: "Staged 2 change(s)" }],
    };
    render(<AgentProgressCard activity={activity} onStop={vi.fn()} stopping={false} canStop />);
    expect(screen.getByText("Working on your workspace")).toBeInTheDocument();
    expect(screen.queryByText(/Staged/)).not.toBeInTheDocument();
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

  it("shows the plan’s goal and a prominent Stop task control", () => {
    const onStop = vi.fn();
    render(
      <AgentProgressCard
        activity={{
          ...createInitialAgentActivity("Working"),
          plan: { summary: "Add a midterm to each course", areas: [] },
        }}
        onStop={onStop}
        stopping={false}
        canStop
      />,
    );

    expect(screen.getByText("Add a midterm to each course")).toBeInTheDocument();
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
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
