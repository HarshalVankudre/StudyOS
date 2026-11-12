import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleWorkspace } from "@/lib/workspace/sample";
import { AgentUndoButton } from "./AgentUndoButton";

vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({
    dict: {
      agentChat: {
        undo: "Undo",
        undoing: "Undoing…",
        undoFailed: "Could not undo",
        undoBlockedByEdits: "You edited after this change. Use Ctrl/Cmd+Z.",
      },
    },
  }),
}));

describe("AgentUndoButton", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the change id and returns the restored workspace", async () => {
    const onUndone = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ workspace: sampleWorkspace }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AgentUndoButton changeId="change-1" onUndone={onUndone} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/agent/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changeId: "change-1" }),
    });
    expect(onUndone).toHaveBeenCalledWith(sampleWorkspace);
  });

  it("shows a friendly error when Undo conflicts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Workspace changed" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    render(
      <AgentUndoButton changeId="change-1" onUndone={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("Could not undo")).toBeInTheDocument();
  });

  it("says plainly when later edits block Undo and points to the editor's undo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "x", reason: "newer_edits" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const onUnavailable = vi.fn();
    render(
      <AgentUndoButton changeId="change-1" onUndone={vi.fn()} onUnavailable={onUnavailable} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("You edited after this change. Use Ctrl/Cmd+Z.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(onUnavailable).toHaveBeenCalled();
  });
});
