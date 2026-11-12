import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("./openrouter", () => ({
  streamChatCompletion: mocks.chat,
  chatCompletion: mocks.chat,
}));

import { runAgentLoop } from "./agent-loop";
import { executeAgentEdit, planAgentTurn } from "./agent";
import { studentClock } from "./student-clock";
import type { ChatMessage } from "./openrouter";

const WS = {
  id: "ws1",
  name: "S",
  databases: [],
  pages: [{ id: "p1", title: "Home", blocks: [] }],
} as never;

// Thursday evening in New York; already Friday in UTC.
const CLOCK = studentClock("America/New_York", new Date("2026-11-13T01:30:00Z"));

function lastUserMessage(callIndex: number): string {
  const messages = mocks.chat.mock.calls[callIndex][1] as ChatMessage[];
  return messages.filter((message) => message.role === "user").at(-1)!.content;
}

function systemMessage(callIndex: number): string {
  const messages = mocks.chat.mock.calls[callIndex][1] as ChatMessage[];
  return messages.find((message) => message.role === "system")!.content;
}

beforeEach(() => {
  mocks.chat.mockReset();
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
});

describe("the agent knows the student's date", () => {
  it("tool loop: planner and step prompts carry the local date, weekday and zone", async () => {
    mocks.chat
      .mockResolvedValueOnce(
        '{"action":"execute","skillId":"study-planner","summary":"Add midterm","affectedAreaIds":["p1"]}',
      )
      .mockResolvedValueOnce('{"action":"final","reply":"Nothing to change."}');
    await runAgentLoop({
      workspace: WS,
      history: [],
      message: "add a midterm next Friday",
      model: "m",
      budget: { wallTimeMs: 90_000, maxModelTurns: 8, maxToolCalls: 12, maxRepairs: 2 },
      locale: "en",
      taskId: "t1",
      ownerId: "user_test",
      emit: () => {},
      now: () => 0,
      clock: CLOCK,
    });
    for (const call of [0, 1]) {
      const user = lastUserMessage(call);
      expect(user).toContain("Thursday, 2026-11-12, 20:30 in America/New_York (UTC-05:00)");
      expect(user).toContain("Fri 2026-11-20");
      // Kept out of the cacheable system prompt.
      expect(systemMessage(call)).not.toContain("2026-11-12");
    }
  });

  it("legacy planner and editor prompts carry it too", async () => {
    mocks.chat.mockResolvedValueOnce(
      '{"action":"edit","plan":"Add a midterm","affectedAreaIds":["p1"]}',
    );
    const decision = await planAgentTurn(WS, [], "add a midterm next Friday", "m", "en", {
      clock: CLOCK,
    });
    expect(lastUserMessage(0)).toContain("Thursday, 2026-11-12");
    expect(decision.action).toBe("edit");

    mocks.chat.mockResolvedValueOnce(
      '{"reply":"Done.","ops":[{"op":"update_page","pageId":"p1","title":"Home"}]}',
    );
    await executeAgentEdit(
      WS,
      [],
      "add a midterm next Friday",
      decision as Extract<typeof decision, { action: "edit" }>,
      "m",
      "en",
      { clock: CLOCK },
    );
    expect(lastUserMessage(1)).toContain("in America/New_York");
  });
});
