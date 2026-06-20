// src/lib/ai/agent-loop.test.ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("./openrouter", () => ({ chatCompletion: mocks.chat }));

import { runAgentLoop } from "./agent-loop";
import type { AgentStreamEvent } from "./agent-shared";

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
    model: "m", budget, locale: "en", taskId: "t1",
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
      locale: "en", taskId: "t1",
      emit: (e) => { events.push(e); },
      now: () => tick++,
    });
    expect(res.changed).toBe(false);
  });

  it("tool outside skill toolIds is refused and loop reaches final", async () => {
    const { res } = await run([
      '{"action":"execute","skillId":"precise-edit","summary":"Rename","affectedAreaIds":["p1"]}',
      '{"action":"tool","tool":"controlled_fetch","input":{"url":"https://x.com"}}',
      '{"action":"final","reply":"done"}',
    ]);
    expect(res.changed).toBe(false);
    expect(res.reply).toBe("done");
  });

  it("failed apply_ops does not mutate the candidate", async () => {
    const { res } = await run([
      '{"action":"execute","skillId":"precise-edit","summary":"Rename","affectedAreaIds":["p1"]}',
      '{"action":"tool","tool":"apply_ops","input":{"ops":[{"op":"update_page","pageId":"does-not-exist","title":"X"}]}}',
      '{"action":"final","reply":"could not"}',
    ]);
    expect(res.changed).toBe(false);
    expect(res.reply).toBe("could not");
  });
});
