import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleWorkspace } from "@/lib/workspace/sample";

const mocks = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("./openrouter", () => ({
  streamChatCompletion: mocks.stream,
}));

import { executeAgentEdit, planAgentTurn, workspaceAreas } from "./agent";

describe("legacy agent streaming", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test";
    mocks.stream.mockReset();
  });

  it("streams planner reasoning and forwards the task signal", async () => {
    const controller = new AbortController();
    const reasoning: string[] = [];
    mocks.stream.mockImplementationOnce(
      async (
        _model: string,
        _messages: unknown,
        _maxTokens: number,
        options: {
          signal?: AbortSignal;
          onReasoning?: (text: string) => void;
        },
      ) => {
        expect(options.signal).toBe(controller.signal);
        options.onReasoning?.("Checking the workspace.");
        return '{"action":"reply","reply":"Done"}';
      },
    );

    await planAgentTurn(sampleWorkspace, [], "help", "model", "en", {
      signal: controller.signal,
      onReasoning: (text) => reasoning.push(text),
    });

    expect(reasoning).toEqual(["Checking the workspace."]);
  });

  it("streams editor reasoning and applies the returned operations", async () => {
    const reasoning: string[] = [];
    mocks.stream.mockImplementationOnce(
      async (
        _model: string,
        _messages: unknown,
        _maxTokens: number,
        options: { onReasoning?: (text: string) => void },
      ) => {
        options.onReasoning?.("Preparing the smallest change.");
        return JSON.stringify({
          reply: "Renamed it.",
          ops: [{ op: "update_workspace", name: "Renamed workspace" }],
        });
      },
    );

    const result = await executeAgentEdit(
      sampleWorkspace,
      [],
      "rename it",
      {
        action: "edit",
        plan: "Rename the workspace",
        affectedAreaIds: [workspaceAreas(sampleWorkspace)[0].id],
        affectedAreas: [workspaceAreas(sampleWorkspace)[0]],
      },
      "model",
      "en",
      { onReasoning: (text) => reasoning.push(text) },
    );

    expect(result.workspace?.name).toBe("Renamed workspace");
    expect(reasoning).toEqual(["Preparing the smallest change."]);
  });
});
