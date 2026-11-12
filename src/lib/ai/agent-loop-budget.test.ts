// Budget, graceful stop, truncation recovery and context size of the tool
// loop, against a faked model that reports usage like a real provider.
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("./openrouter", () => ({
  streamChatCompletion: mocks.chat,
  chatCompletion: mocks.chat,
}));

import {
  runAgentLoop,
  estimateAgentTurn,
  STEP_MAX_TOKENS,
  STEP_RETRY_MAX_TOKENS,
  PLAN_MAX_TOKENS,
} from "./agent-loop";
import { AiTruncatedError } from "./ai-errors";
import { recordUsage, withUsageMeter } from "./usage-meter";
import type { AgentBudget } from "./budgets";
import type { ChatMessage } from "./openrouter";
import type { Workspace } from "@/lib/workspace/types";

const GLM = "z-ai/glm-5.2";

function workspace(rows = 3): Workspace {
  return {
    id: "ws1",
    name: "Term",
    pages: [{ id: "p1", title: "Home", blocks: [] }],
    databases: [
      {
        id: "db1",
        name: "Assignments",
        properties: [
          { id: "t", name: "Title", type: "text" },
          { id: "d", name: "Due", type: "date" },
        ],
        rows: Array.from({ length: rows }, (_, i) => ({
          id: `r${i}`,
          cells: { t: `Assignment number ${i}`, d: "2026-11-20" },
        })),
        views: [{ id: "v1", name: "All", type: "table" }],
      },
    ],
  };
}

const PLAN = '{"action":"execute","skillId":"precise-edit","summary":"Rename","affectedAreaIds":["p1"]}';
const RENAME = '{"action":"tool","tool":"apply_ops","input":{"ops":[{"op":"update_page","pageId":"p1","title":"Dashboard"}]}}';
const LOOK = '{"action":"tool","tool":"summarize_workspace","input":{}}';

interface Call {
  messages: ChatMessage[];
  maxTokens: number;
  options: { cache?: boolean };
}

/** Scripted fake model; every call reports `usage` as the provider would. */
function script(
  steps: Array<string | Error | ((call: Call) => string)>,
  usage: Record<string, number> = { prompt_tokens: 5_000, completion_tokens: 600 },
  model = GLM,
) {
  const calls: Call[] = [];
  mocks.chat.mockReset();
  mocks.chat.mockImplementation(
    async (_model: string, messages: ChatMessage[], maxTokens: number, options: Call["options"]) => {
      const call = { messages: [...messages], maxTokens, options };
      calls.push(call);
      recordUsage(usage, model);
      const next = steps.length ? steps.shift()! : LOOK;
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next(call) : next;
    },
  );
  return calls;
}

function run(budget: Partial<AgentBudget>, ws = workspace(), model = GLM) {
  return withUsageMeter(() =>
    runAgentLoop({
      workspace: ws,
      history: [],
      message: "rename home to Dashboard",
      model,
      budget: { wallTimeMs: 90_000, maxModelTurns: 30, maxToolCalls: 30, maxRepairs: 2, ...budget },
      locale: "en",
      taskId: "t1",
      ownerId: "u1",
      emit: () => {},
      now: () => 0,
    }),
  );
}

describe("budget enforcement and graceful stop", () => {
  it("stops at the spend ceiling, keeps the change already made, and never exceeds it", async () => {
    const calls = script([PLAN, RENAME]);
    const { result, usage } = await run({ maxCostUsd: 0.05, stepScale: 10 });

    expect(result.changed).toBe(true);
    expect(result.workspace?.pages[0].title).toBe("Dashboard");
    expect(result.stopReason).toBe("budget");
    expect(result.reply).toMatch(/kept the 1 change/);
    expect(result.changeNote).toContain("update page [p1]");
    expect(usage.costUsd!).toBeLessThanOrEqual(0.05);
    // Far fewer calls than the 40 step allowance: the money ran out first.
    expect(calls.length).toBeLessThan(10);
    // Each call was sized so its worst case fit in what was left.
    for (const call of calls) expect(call.maxTokens).toBeLessThanOrEqual(STEP_MAX_TOKENS);
  });

  it("gives a simple edit a small step allowance (proportional to the request)", async () => {
    const calls = script([PLAN]); // then the model only ever looks around
    const { result } = await run({});
    // 1 planning call + 4 steps for a one-area precise edit.
    expect(calls).toHaveLength(5);
    expect(result.changed).toBe(false);
    expect(result.stopReason).toBe("budget");
    expect(result.reply).toMatch(/Nothing in your workspace changed/);
  });

  it("does not start a call it cannot afford", async () => {
    const calls = script([PLAN]);
    const { result } = await run({ maxCostUsd: 0.0005 });
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ changed: false, stopReason: "budget" });
  });

  it("finishes a simple edit in two calls when the apply carries the reply", async () => {
    const calls = script([
      PLAN,
      '{"action":"tool","tool":"apply_ops","input":{"ops":[{"op":"update_page","pageId":"p1","title":"Dashboard"}]},"reply":"Renamed Home to Dashboard."}',
    ]);
    const { result } = await run({});
    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ changed: true, reply: "Renamed Home to Dashboard." });
    expect(result.stopReason).toBeUndefined();
  });

  it("ignores the reply of a failed apply and lets the model fix it", async () => {
    const calls = script([
      PLAN,
      '{"action":"tool","tool":"apply_ops","input":{"ops":[{"op":"update_page","pageId":"nope","title":"X"}]},"reply":"Done!"}',
      '{"action":"final","reply":"Could not find it."}',
    ]);
    const { result } = await run({});
    expect(calls).toHaveLength(3);
    expect(result).toMatchObject({ changed: false, reply: "Could not find it." });
  });
});

describe("truncation recovery", () => {
  it("retries a cut-off step with more room instead of failing the turn", async () => {
    const calls = script([
      PLAN,
      new AiTruncatedError("cut", STEP_MAX_TOKENS, '{"action":"tool"'),
      (call) => {
        expect(call.maxTokens).toBe(STEP_RETRY_MAX_TOKENS);
        expect(call.messages.at(-1)!.content).toMatch(/cut off/);
        return '{"action":"tool","tool":"apply_ops","input":{"ops":[{"op":"update_page","pageId":"p1","title":"Dashboard"}]},"reply":"Renamed."}';
      },
    ]);
    const { result } = await run({});
    expect(calls).toHaveLength(3);
    expect(result).toMatchObject({ changed: true, reply: "Renamed." });
  });

  it("retries a cut-off plan once with a larger limit", async () => {
    const calls = script([new AiTruncatedError("cut", PLAN_MAX_TOKENS), '{"action":"reply","reply":"Hi"}']);
    const { result } = await run({});
    expect(calls.map((c) => c.maxTokens)).toEqual([PLAN_MAX_TOKENS, PLAN_MAX_TOKENS * 2]);
    expect(result.reply).toBe("Hi");
  });

  it("stops gracefully, keeping staged changes, when truncation repeats past the repair budget", async () => {
    script([
      PLAN,
      RENAME,
      new AiTruncatedError("cut", STEP_MAX_TOKENS),
      new AiTruncatedError("cut", STEP_RETRY_MAX_TOKENS),
    ]);
    const { result } = await run({ maxRepairs: 1 });
    expect(result).toMatchObject({ changed: true, stopReason: "budget" });
    expect(result.workspace?.pages[0].title).toBe("Dashboard");
  });
});

describe("what the model is sent", () => {
  it("sends an outline plus focus areas, not the whole workspace on every step", async () => {
    const big = workspace(400);
    const calls = script([
      '{"action":"execute","skillId":"precise-edit","summary":"Rename","affectedAreaIds":["p1"]}',
      LOOK,
      '{"action":"final","reply":"ok"}',
    ]);
    await run({}, big);
    const full = JSON.stringify(big).length;
    for (const call of calls) {
      const text = call.messages.map((m) => m.content).join("\n");
      expect(text).not.toContain("Assignment number 300");
      expect(text).toContain("+388 more");
    }
    const firstPrompt = calls[0].messages.map((m) => m.content).join("").length;
    expect(firstPrompt).toBeLessThan(full);
  });

  it("keeps one growing conversation with a stable prefix and asks for caching", async () => {
    const calls = script([PLAN, LOOK, '{"action":"final","reply":"ok"}']);
    await run({});
    for (let i = 1; i < calls.length; i += 1) {
      const previous = calls[i - 1].messages;
      // Each call's prompt starts with the whole previous prompt, byte for byte.
      expect(calls[i].messages.slice(0, previous.length)).toEqual(previous);
    }
    expect(calls.every((c) => c.options.cache === true)).toBe(true);
    // Nothing volatile in the system prompt.
    expect(calls[0].messages[0].content).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("documents merging view edits and the new view fields to the model", async () => {
    const calls = script(['{"action":"reply","reply":"ok"}']);
    await run({});
    const system = calls[0].messages[0].content;
    expect(system).toContain("update_view MERGES");
    expect(system).toContain("next_days");
    expect(system).toContain('"preset":{"kind":"upcoming"');
  });

  it("estimates the smallest edit, cheaper on a caching Claude model than on GLM", () => {
    const input = { workspace: workspace(50), history: [], message: "add a quiz friday", locale: "en" as const };
    const glm = estimateAgentTurn({ ...input, model: GLM });
    const haiku = estimateAgentTurn({ ...input, model: "claude-haiku-5-5" });
    expect(glm.prefixTokens).toBeGreaterThan(1_000);
    expect(haiku.simpleTurnUsd).toBeLessThan(glm.simpleTurnUsd / 5);
    expect(glm.simpleTurnUsd).toBeGreaterThan(0);
  });
});
