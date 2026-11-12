// POST /api/agent: up-front refusals, stale-base refusal, charging by
// outcome and chat persistence. Model work is faked; no network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  snapshot: vi.fn(),
  apply: vi.fn(),
  balance: vi.fn(),
  plan: vi.fn(),
  usageLimit: vi.fn(),
  activeTasks: vi.fn(),
  createTask: vi.fn(),
  claim: vi.fn(),
  markDone: vi.fn(),
  markError: vi.fn(),
  isCancelled: vi.fn(),
  runLoop: vi.fn(),
  settle: vi.fn(),
  append: vi.fn(),
  history: vi.fn(),
  report: vi.fn(),
  reserve: vi.fn(),
  releaseHold: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: m.auth }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/db", () => ({
  prisma: { dailyStudyAgentConfig: { findUnique: async () => null } },
}));
vi.mock("@/lib/billing", () => ({ getUserPlan: m.plan }));
vi.mock("@/lib/credits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credits")>()),
  getCreditBalance: m.balance,
  reserveCredits: m.reserve,
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: m.usageLimit,
  MAX_CONCURRENT_AGENT_TASKS: 3,
}));
vi.mock("@/lib/workspace/version-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace/version-service")>()),
  getWorkspaceSnapshot: m.snapshot,
  applyAgentWorkspaceChange: m.apply,
}));
vi.mock("@/lib/ai/tasks/store", () => ({
  appendTaskEvent: async () => {},
  claimTaskForFinalization: m.claim,
  countActiveTasks: m.activeTasks,
  createTask: m.createTask,
  isTaskCancelled: m.isCancelled,
  markTaskDone: m.markDone,
  markTaskError: m.markError,
}));
vi.mock("@/lib/flags", () => ({ agentSandboxEnabled: () => false }));
vi.mock("@/lib/ai/agent-loop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/agent-loop")>()),
  runAgentLoop: m.runLoop,
}));
vi.mock("@/lib/ai/agent-charging", () => ({ settleAgentTurn: m.settle, releaseAgentHold: m.releaseHold }));
vi.mock("@/lib/ai/agent-history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/agent-history")>()),
  appendChatMessages: m.append,
  loadModelHistory: m.history,
}));
vi.mock("@/lib/ops/report-error", () => ({ reportError: m.report }));

import { POST } from "./route";
import { TaskCancelledError } from "@/lib/ai/tasks/cancellation";
import { recordUsage } from "@/lib/ai/usage-meter";
import { AgentResultTooLargeError } from "@/lib/ai/limits";
import { sampleWorkspace } from "@/lib/workspace/sample";
import { WorkspaceVersionConflictError } from "@/lib/workspace/version-service";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId: "ws1", message: "add a quiz on Chapter 3 next Friday", ...body }),
  });
}

async function events(response: Response) {
  const text = await response.text();
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.auth.mockResolvedValue({ userId: "user_1" });
  m.snapshot.mockResolvedValue({ workspace: sampleWorkspace, version: 7 });
  m.plan.mockResolvedValue("free");
  m.balance.mockResolvedValue(150);
  m.usageLimit.mockResolvedValue({ allowed: true });
  m.activeTasks.mockResolvedValue(0);
  m.createTask.mockResolvedValue({ id: "task_1" });
  m.claim.mockResolvedValue(true);
  m.markDone.mockResolvedValue(true);
  m.markError.mockResolvedValue(undefined);
  m.isCancelled.mockResolvedValue(false);
  m.history.mockResolvedValue([]);
  m.append.mockResolvedValue(undefined);
  m.settle.mockResolvedValue(3);
  m.reserve.mockImplementation(async (_u: string, o: { estimate: number }) => ({ id: "hold_1", userId: "user_1", amount: o.estimate, reason: "agent" }));
  m.releaseHold.mockResolvedValue(undefined);
});

describe("up-front refusals (nothing runs, nothing is charged)", () => {
  it("refuses with the estimated cost and the balance when the student can't afford it", async () => {
    m.balance.mockResolvedValue(1);
    const out = await events(await POST(request({})));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "error", code: "insufficient_credits" });
    expect(out[0].message).toMatch(/needs about \d+ credits and you have 1/);
    expect(m.createTask).not.toHaveBeenCalled();
    expect(m.runLoop).not.toHaveBeenCalled();
    expect(m.settle).not.toHaveBeenCalled();
    expect(m.append).not.toHaveBeenCalled();
    expect(m.reserve).not.toHaveBeenCalled();
  });

  it("reserves the estimate before any model work; a parallel request that loses the race is refused", async () => {
    m.reserve.mockResolvedValueOnce(null);
    m.balance.mockResolvedValueOnce(150).mockResolvedValueOnce(0);
    const out = await events(await POST(request({})));
    expect(m.reserve).toHaveBeenCalledWith("user_1", expect.objectContaining({ reason: "agent" }));
    const { estimate, min } = m.reserve.mock.calls[0][1];
    expect(min).toBe(estimate);
    expect(out[0]).toMatchObject({ type: "error", code: "insufficient_credits" });
    expect(m.runLoop).not.toHaveBeenCalled();
  });

  it("refuses a stale base version before any model runs", async () => {
    const out = await events(await POST(request({ baseVersion: 6 })));
    expect(out).toEqual([
      expect.objectContaining({ type: "error", code: "stale_workspace", message: expect.stringMatching(/still being saved/) }),
    ]);
    expect(m.runLoop).not.toHaveBeenCalled();
    expect(m.balance).not.toHaveBeenCalled();
  });
});

describe("a turn that runs", () => {
  it("passes a ceiling of min(balance, per-turn cap), the student's zone, and the stored history", async () => {
    m.history.mockResolvedValue([{ role: "user", content: "earlier" }]);
    m.runLoop.mockResolvedValue({ reply: "Hi", changed: false });
    await events(await POST(request({ timeZone: "Europe/Berlin" })));
    const params = m.runLoop.mock.calls[0][0];
    expect(params.budget.maxCostUsd).toBeCloseTo(30 * 0.003, 10); // free cap 30 < balance 150
    expect(params.clock.timeZone).toBe("Europe/Berlin");
    expect(params.history).toEqual([{ role: "user", content: "earlier" }]);
  });

  it("applies, charges as completed, stores both messages and strips the change note", async () => {
    m.runLoop.mockImplementation(async () => {
      recordUsage({ input_tokens: 1_000, output_tokens: 500 }, "claude-haiku-5-5");
      return { reply: "Added.", changed: true, workspace: sampleWorkspace, changeNote: "added row [r1]" };
    });
    m.apply.mockResolvedValue({ workspace: sampleWorkspace, version: 8, changeId: "chg_1" });
    const out = await events(await POST(request({ displayText: "Quiz" })));
    const result = out.find((e) => e.type === "result");
    expect(result.response).toMatchObject({ reply: "Added.", changeId: "chg_1", creditsCost: 3 });
    expect(result.response).not.toHaveProperty("changeNote");
    expect(m.settle).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "completed", userId: "user_1", hold: expect.objectContaining({ id: "hold_1" }) }),
    );
    expect(m.settle.mock.calls[0][0].usage.costUsd).toBeGreaterThan(0);
    const stored = m.append.mock.calls.flatMap((c) => c[2]);
    expect(stored[0]).toMatchObject({ role: "user", content: "Quiz", modelContent: "add a quiz on Chapter 3 next Friday" });
    expect(stored[1]).toMatchObject({ role: "assistant", content: "Added.", changeNote: "added row [r1]", changeId: "chg_1" });
  });

  it("a cancelled turn is charged for the tokens it used", async () => {
    m.runLoop.mockImplementation(async () => {
      recordUsage({ input_tokens: 2_000, output_tokens: 100 }, "claude-haiku-5-5");
      throw new TaskCancelledError();
    });
    await events(await POST(request({})));
    expect(m.settle).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "cancelled", usage: expect.objectContaining({ promptTokens: 2_000 }) }),
    );
    expect(m.append.mock.calls.at(-1)![2]).toEqual([{ role: "assistant", content: "Task stopped." }]);
  });

  it("a failed turn is settled as failed (free within the daily allowance) and reported", async () => {
    m.runLoop.mockRejectedValue(new Error("model exploded"));
    const out = await events(await POST(request({})));
    expect(out.at(-1)).toMatchObject({ type: "error", code: "failed" });
    expect(m.settle).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }));
    expect(m.report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ source: "api", route: "/api/agent", method: "POST", userId: "user_1", workspaceId: "ws1", taskId: "task_1" }),
    );
  });

  it("hands the apply the workspace the agent started from, so newer saves can be merged", async () => {
    m.runLoop.mockResolvedValue({ reply: "Renamed.", changed: true, workspace: { ...sampleWorkspace, name: "New" } });
    m.apply.mockResolvedValue({ workspace: sampleWorkspace, version: 9, changeId: "chg_2" });
    const out = await events(await POST(request({ baseVersion: 7 })));
    expect(m.apply).toHaveBeenCalledWith("ws1", 7, expect.objectContaining({ name: "New" }), sampleWorkspace);
    expect(out.find((e) => e.type === "result").response).toMatchObject({ changeId: "chg_2" });
    expect(m.settle).toHaveBeenCalledWith(expect.objectContaining({ outcome: "completed" }));
  });

  it("an overlap with edits saved during the task is a clear refusal that is never charged", async () => {
    m.runLoop.mockImplementation(async () => {
      recordUsage({ input_tokens: 1_000, output_tokens: 500 }, "claude-haiku-5-5");
      return { reply: "Renamed.", changed: true, workspace: sampleWorkspace };
    });
    m.apply.mockRejectedValue(new WorkspaceVersionConflictError("Workspace changed during the task"));
    const out = await events(await POST(request({})));
    expect(out.at(-1)).toMatchObject({
      type: "error",
      code: "workspace_conflict",
      message: expect.stringMatching(/edited somewhere else.*Nothing was charged/),
    });
    expect(m.settle).not.toHaveBeenCalled();
    expect(m.releaseHold).toHaveBeenCalledWith(expect.objectContaining({ id: "hold_1" }));
    // An expected outcome, not a server error.
    expect(m.report).not.toHaveBeenCalled();
    expect(m.markError).toHaveBeenCalledWith("task_1", "workspace_conflict");
  });

  it("a result too large to save is a clean failure that is never charged", async () => {
    m.runLoop.mockResolvedValue({ reply: "x", changed: true, workspace: sampleWorkspace });
    m.apply.mockRejectedValue(new AgentResultTooLargeError(3_000_000));
    const out = await events(await POST(request({})));
    expect(out.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/too large to save/) });
    expect(m.settle).not.toHaveBeenCalled();
    // The reserved estimate goes back in full.
    expect(m.releaseHold).toHaveBeenCalledWith(expect.objectContaining({ id: "hold_1" }));
  });
});
