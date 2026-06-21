import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentChat } from "./AgentChat";

beforeAll(() => {
  // jsdom doesn't implement Element.scrollTo; AgentChat auto-scrolls on update.
  Element.prototype.scrollTo = vi.fn();
});

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./AgentUndoButton", () => ({
  AgentUndoButton: () => null,
}));
vi.mock("./AgentProgressCard", () => ({
  AgentProgressCard: ({
    onStop,
    stopping,
    canStop,
  }: {
    onStop: () => void;
    stopping: boolean;
    canStop: boolean;
  }) => (
    <button onClick={onStop} disabled={!canStop || stopping}>
      {stopping ? "Stopping…" : "Stop task"}
    </button>
  ),
}));
vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({
    dict: {
      agentChat: {
        initialMessage: "Opening",
        title: "AI agent",
        phase: {
          inspecting: "Reviewing",
          planning: "Planning",
          updating: "Updating",
          validating: "Checking",
          saving: "Saving",
        },
        subtitleIdle: "Idle",
        closeChat: "Close chat",
        intro: "Ask me",
        suggestions: [],
        errorRequestFailed: "Request failed",
        errorEndedUnexpectedly: "Ended unexpectedly",
        errorSnag: "Error",
        errorCouldntComplete: "Could not complete",
        workspaceUpdated: "Workspace updated",
        undone: "Undone",
        send: "Send",
        placeholderBusy: "Working…",
        placeholderIdle: "Ask the agent…",
        inputHint: "Hint",
        stopFailed: "Could not stop",
        taskStopped: "Task stopped.",
      },
    },
  }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("AgentChat stop task", () => {
  it("waits for durable cancellation, aborts the stream, and shows Task stopped", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(
          encoder.encode('{"type":"task","taskId":"task-1"}\n'),
        );
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(stream))
      .mockResolvedValueOnce(
        Response.json({ status: "cancelled", interrupted: true }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} />,
    );
    await userEvent.type(
      screen.getByPlaceholderText("Ask the agent…"),
      "rename home",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Stop task" }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/agent/task/task-1/cancel", {
      method: "POST",
    });
    expect(await screen.findByText("Task stopped.")).toBeInTheDocument();
    streamController.close();
  });
});
