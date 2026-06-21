// src/lib/ai/agent-loop.test.ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("./openrouter", () => ({
  streamChatCompletion: mocks.chat,
  chatCompletion: mocks.chat,
}));

import { runAgentLoop, selectAllowedTools } from "./agent-loop";
import { TaskCancelledError } from "./tasks/cancellation";
import type { AgentStreamEvent } from "./agent-shared";
import { toolRegistry } from "./tools/registry";
import { skillRegistry } from "./skills/registry";
import { z } from "zod";

const WS = {
  id: "ws1", name: "S",
  databases: [],
  pages: [{ id: "p1", title: "Home", blocks: [] }],
} as never;

const budget = { wallTimeMs: 90_000, maxModelTurns: 8, maxToolCalls: 12, maxRepairs: 2 };

function run(scripts: string[]) {
  mocks.chat.mockReset();
  for (const s of scripts) mocks.chat.mockResolvedValueOnce(s);
  const events: AgentStreamEvent[] = [];
  return runAgentLoop({
    workspace: WS, history: [], message: "rename home to Dashboard",
    model: "m", budget, locale: "en", taskId: "t1", ownerId: "user_test",
    emit: (e) => { events.push(e); },
    now: () => 0,
  }).then((res) => ({ res, events }));
}

describe("runAgentLoop", () => {
  it("returns a plain reply without changing the workspace", async () => {
    const { res } = await run(['{"action":"reply","reply":"Hi there"}']);
    expect(res.changed).toBe(false);
    expect(res.reply).toBe("Hi there");
  });

  it("executes a skill, applies ops, and reports changed", async () => {
    const { res, events } = await run([
      '{"action":"execute","skillId":"precise-edit","summary":"Rename","affectedAreaIds":["p1"]}',
      '{"action":"tool","tool":"apply_ops","input":{"ops":[{"op":"update_page","pageId":"p1","title":"Dashboard"}]}}',
      '{"action":"final","reply":"Renamed the page."}',
    ]);
    expect(res.changed).toBe(true);
    expect(res.workspace?.pages[0].title).toBe("Dashboard");
    expect(events.some((e) => e.type === "plan")).toBe(true);
  });

  it("asks a clarifying question", async () => {
    const { res } = await run([
      '{"action":"clarify","reply":"Which page?","choices":[{"id":"a","label":"Home","value":"the home page"},{"id":"b","label":"Notes","value":"the notes page"}]}',
    ]);
    expect(res.choices?.length).toBe(2);
    expect(res.changed).toBe(false);
  });

  it("wall-time budget stops the loop before executing", async () => {
    mocks.chat.mockReset();
    mocks.chat.mockResolvedValueOnce(
      '{"action":"execute","skillId":"precise-edit","summary":"x","affectedAreaIds":["p1"]}',
    );
    const events: AgentStreamEvent[] = [];
    let tick = 0;
    const res = await runAgentLoop({
      workspace: WS, history: [], message: "rename home to Dashboard",
      model: "m",
      budget: { wallTimeMs: 0, maxModelTurns: 8, maxToolCalls: 12, maxRepairs: 2 },
      locale: "en", taskId: "t1", ownerId: "user_test",
      emit: (e) => { events.push(e); },
      now: () => tick++,
    });
    expect(res.changed).toBe(false);
    // Only the planner ran — the execute loop body was entirely skipped.
    // If the budget guard were removed there would be ≥2 calls.
    expect(mocks.chat).toHaveBeenCalledTimes(1);
  });

  it("degrades to a graceful reply when the planner runs out of budget", async () => {
    mocks.chat.mockReset();
    // With a zero wall budget the planner call is aborted up front; the mocked
    // model rejects (as the aborted fetch would), and the loop must finalize
    // with a plain reply instead of throwing a hard error.
    mocks.chat.mockRejectedValue(new Error("aborted"));
    const events: AgentStreamEvent[] = [];
    let tick = 0;
    const res = await runAgentLoop({
      workspace: WS, history: [], message: "do something",
      model: "m",
      budget: { wallTimeMs: 0, maxModelTurns: 8, maxToolCalls: 12, maxRepairs: 2 },
      locale: "en", taskId: "t1", ownerId: "user_test",
      emit: (e) => { events.push(e); },
      now: () => tick++,
    });
    expect(res.changed).toBe(false);
    expect(typeof res.reply).toBe("string");
    expect(res.reply.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("tool outside skill toolIds is refused and loop reaches final", async () => {
    const { res } = await run([
      '{"action":"execute","skillId":"precise-edit","summary":"Rename","affectedAreaIds":["p1"]}',
      '{"action":"tool","tool":"controlled_fetch","input":{"url":"https://x.com"}}',
      '{"action":"final","reply":"done"}',
    ]);
    expect(res.changed).toBe(false);
    expect(res.reply).toBe("done");
    // Prove the refusal observation was injected: 3 model calls (plan, refused step, final step)
    // and the final step's messages include the refusal text.
    expect(mocks.chat).toHaveBeenCalledTimes(3);
    const finalMsgs = mocks.chat.mock.calls[2][1] as Array<{ role: string; content: string }>;
    expect(
      finalMsgs.some((m) => /not available/i.test(m.content) && m.content.includes("controlled_fetch")),
    ).toBe(true);
  });

  it("failed apply_ops does not mutate the candidate", async () => {
    const { res } = await run([
      '{"action":"execute","skillId":"precise-edit","summary":"Rename","affectedAreaIds":["p1"]}',
      '{"action":"tool","tool":"apply_ops","input":{"ops":[{"op":"update_page","pageId":"does-not-exist","title":"X"}]}}',
      '{"action":"final","reply":"could not"}',
    ]);
    expect(res.changed).toBe(false);
    expect(res.reply).toBe("could not");
    // Prove apply_ops was actually invoked, returned ok:false, and the loop fed
    // the failure observation back to the model without mutating the candidate.
    expect(mocks.chat).toHaveBeenCalledTimes(3);
    const finalMsgs = mocks.chat.mock.calls[2][1] as Array<{ role: string; content: string }>;
    expect(
      finalMsgs.some(
        (m) => m.content.includes("Observation from apply_ops") && m.content.includes('"ok":false'),
      ),
    ).toBe(true);
  });

  it("stops the active model turn when the task signal aborts", async () => {
    mocks.chat.mockReset();
    const controller = new AbortController();
    mocks.chat.mockImplementationOnce(
      async (
        _model: string,
        _messages: unknown,
        _maxTokens: number,
        options?: { signal?: AbortSignal },
      ) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        }),
    );

    const pending = runAgentLoop({
      workspace: WS,
      history: [],
      message: "rename",
      model: "m",
      budget,
      locale: "en",
      taskId: "t1",
      ownerId: "user_test",
      signal: controller.signal,
      emit: vi.fn(),
      now: () => 0,
    });
    controller.abort(new TaskCancelledError());

    await expect(pending).rejects.toBeInstanceOf(TaskCancelledError);
  });

  it("streams the model's reasoning as thinking events", async () => {
    mocks.chat.mockReset();
    // The planner call surfaces reasoning via the onReasoning callback, then
    // resolves a plain reply so the turn ends without an edit.
    mocks.chat.mockImplementationOnce(
      async (
        _model: string,
        _messages: unknown,
        _maxTokens: number,
        opts?: { onReasoning?: (text: string) => void },
      ) => {
        opts?.onReasoning?.("Let me ");
        opts?.onReasoning?.("think about this.");
        return '{"action":"reply","reply":"Hi"}';
      },
    );
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      workspace: WS, history: [], message: "hello",
      model: "m", budget, locale: "en", taskId: "t1", ownerId: "user_test",
      emit: (e) => { events.push(e); },
      now: () => 0,
    });
    const thinking = events.filter(
      (e): e is Extract<AgentStreamEvent, { type: "thinking" }> => e.type === "thinking",
    );
    expect(thinking.length).toBe(2);
    expect(thinking.map((e) => e.delta).join("")).toBe("Let me think about this.");
    expect(thinking[0].phase).toBe("planning");
  });
});

describe("loop tool gating + ownerId", () => {
  it("ownerId is forwarded into the tool context", async () => {
    // Register a spy tool that captures the ctx it receives.
    const capturedOwnerIds: (string | undefined)[] = [];
    toolRegistry.register({
      id: "test_spy_owner_tool",
      description: "spy: records ctx.ownerId",
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      limits: { timeoutMs: 5000 },
      networkPermission: "none",
      enabled: true,
      handler: (_input, ctx) => {
        capturedOwnerIds.push(ctx.ownerId);
        return { ok: true };
      },
    });

    // Register a skill that uses the spy tool.
    skillRegistry.register({
      id: "test-spy-skill",
      version: "1.0.0",
      instructions: "spy skill",
      toolIds: ["test_spy_owner_tool"],
    });

    mocks.chat.mockReset();
    // Planner: execute via our test skill
    mocks.chat.mockResolvedValueOnce(
      '{"action":"execute","skillId":"test-spy-skill","summary":"spy","affectedAreaIds":["p1"]}',
    );
    // Step 1: call the spy tool
    mocks.chat.mockResolvedValueOnce(
      '{"action":"tool","tool":"test_spy_owner_tool","input":{}}',
    );
    // Step 2: finalize
    mocks.chat.mockResolvedValueOnce('{"action":"final","reply":"done"}');

    await runAgentLoop({
      workspace: WS, history: [], message: "run spy",
      model: "m", budget, locale: "en",
      taskId: "task_spy", ownerId: "user_owner_42",
      emit: vi.fn(), now: () => 0,
    });

    expect(capturedOwnerIds).toContain("user_owner_42");
  });

  it("a registered-but-disabled tool is excluded from selectAllowedTools", () => {
    // Register a disabled tool.
    toolRegistry.register({
      id: "test_disabled_stub",
      description: "disabled stub",
      input: z.object({}),
      output: z.object({}),
      limits: { timeoutMs: 1000 },
      networkPermission: "none",
      enabled: false,
      handler: () => ({}),
    });

    // Register an enabled tool alongside it to prove enabled ones still pass through.
    toolRegistry.register({
      id: "test_enabled_stub",
      description: "enabled stub",
      input: z.object({}),
      output: z.object({}),
      limits: { timeoutMs: 1000 },
      networkPermission: "none",
      enabled: true,
      handler: () => ({}),
    });

    const result = selectAllowedTools(["test_enabled_stub", "test_disabled_stub"]);
    expect(result).toContain("test_enabled_stub");
    expect(result).not.toContain("test_disabled_stub");
  });
});
