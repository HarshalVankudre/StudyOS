// @vitest-environment node
/**
 * Check-then-insert limits under real concurrency, against a real Postgres
 * (second security review: twelve parallel agent requests ran nine loops
 * against a cap of three, and material storage caps could be overshot).
 *
 * Opt-in, because CI has no database:
 *   STUDYOS_DB_TESTS=1 with DATABASE_URL pointing at a THROWAWAY database
 *   (e.g. the local one on :54329), then
 *   npx pnpm@10 exec vitest run src/lib/limits.db.test.ts
 * It only touches rows of its own random `dbtest_` users and removes them
 * after. No model calls: the agent loop is a stub that waits and returns.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const enabled = process.env.STUDYOS_DB_TESTS === "1";

const h = vi.hoisted(() => ({ userId: "", running: 0, maxRunning: 0, started: 0 }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: h.userId }) }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: () => undefined }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/billing", () => ({ getUserPlan: async () => "free" }));
vi.mock("@/lib/flags", async (original) => ({
  ...(await original<typeof import("@/lib/flags")>()),
  agentSandboxEnabled: () => false,
}));
vi.mock("@/lib/workspace/version-service", async (original) => {
  const { sampleWorkspace } = await import("@/lib/workspace/sample");
  return {
    ...(await original<typeof import("@/lib/workspace/version-service")>()),
    getWorkspaceSnapshot: async () => ({ workspace: sampleWorkspace, version: 1 }),
  };
});
vi.mock("@/lib/ai/agent-history", async (original) => ({
  ...(await original<typeof import("@/lib/ai/agent-history")>()),
  appendChatMessages: async () => {},
  loadModelHistory: async () => [],
}));
vi.mock("@/lib/ai/agent-loop", async (original) => ({
  ...(await original<typeof import("@/lib/ai/agent-loop")>()),
  // A loop that holds its slot for a while and does no model work.
  runAgentLoop: async () => {
    h.started += 1;
    h.running += 1;
    h.maxRunning = Math.max(h.maxRunning, h.running);
    await new Promise((resolve) => setTimeout(resolve, 600));
    h.running -= 1;
    return { reply: "ok", changed: false };
  },
}));

describe.skipIf(!enabled)("limits on Postgres", () => {
  const run = `dbtest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const users: string[] = [];
  const user = (tag: string) => {
    const id = `${run}_${tag}`;
    users.push(id);
    return id;
  };
  const db = async () => (await import("@/lib/db")).prisma;

  afterAll(async () => {
    const prisma = await db();
    const where = { userId: { in: users } };
    await prisma.agentTask.deleteMany({ where });
    await prisma.usageEvent.deleteMany({ where });
    await prisma.creditLedger.deleteMany({ where });
    await prisma.creditHold.deleteMany({ where });
    await prisma.creditAccount.deleteMany({ where });
    await prisma.studyMaterial.deleteMany({ where: { ownerId: { in: users } } });
    await prisma.workspace.deleteMany({ where: { ownerId: { in: users } } });
  });

  it("twelve parallel task claims create exactly MAX_CONCURRENT_AGENT_TASKS tasks", async () => {
    const { createTaskWithinLimit } = await import("@/lib/ai/tasks/store");
    const { MAX_CONCURRENT_AGENT_TASKS } = await import("@/lib/usage-limits");
    h.userId = user("tasks");
    const claims = await Promise.all(
      Array.from({ length: 12 }, () =>
        createTaskWithinLimit({ workspaceId: `${run}_ws`, baseVersion: 1 }, MAX_CONCURRENT_AGENT_TASKS),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(MAX_CONCURRENT_AGENT_TASKS);
    const prisma = await db();
    expect(await prisma.agentTask.count({ where: { userId: h.userId } })).toBe(MAX_CONCURRENT_AGENT_TASKS);
  });

  it("twelve parallel agent requests never run more than three loops at once", async () => {
    const prisma = await db();
    h.userId = user("route");
    h.running = 0;
    h.maxRunning = 0;
    h.started = 0;
    await prisma.creditAccount.create({ data: { userId: h.userId, balance: 1000 } });
    const { POST } = await import("@/app/api/agent/route");
    const { MAX_CONCURRENT_AGENT_TASKS } = await import("@/lib/usage-limits");
    const request = () =>
      new Request("http://localhost/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: `${run}_ws`, message: "hi" }),
      });
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, async () => {
        const lines = (await (await POST(request())).text()).trim().split("\n").map((l) => JSON.parse(l));
        const last = lines.at(-1);
        return last.type === "error" ? last.code : last.type;
      }),
    );
    expect(h.maxRunning).toBeLessThanOrEqual(MAX_CONCURRENT_AGENT_TASKS);
    expect(h.started).toBeGreaterThan(0);
    expect(outcomes.filter((o) => o === "result")).toHaveLength(h.started);
    // Refused turns left no task holding a slot.
    const live = await prisma.agentTask.count({
      where: { userId: h.userId, status: { in: ["running", "finalizing"] } },
    });
    expect(live).toBe(0);
  }, 60_000);

  it("checkUsageLimit lets exactly the remaining requests through at the boundary", async () => {
    const prisma = await db();
    const { checkUsageLimit, USAGE_LIMITS } = await import("@/lib/usage-limits");
    const id = user("usage");
    const limit = USAGE_LIMITS.daily_plan.free;
    await prisma.usageEvent.createMany({
      data: Array.from({ length: limit - 3 }, () => ({ userId: id, kind: "daily_plan" })),
    });
    const results = await Promise.all(Array.from({ length: 12 }, () => checkUsageLimit(id, "daily_plan")));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(await prisma.usageEvent.count({ where: { userId: id, kind: "daily_plan" } })).toBe(limit);
  });

  it("the agent's free-failure allowance and outcome slots hold under parallel claims", async () => {
    const { claimFreeFailure, FREE_FAILURES_PER_DAY } = await import("@/lib/ai/agent-charging");
    const { claimOutcomeSlot, releaseOutcomeSlot, USAGE_LIMITS } = await import("@/lib/usage-limits");
    const id = user("failures");
    const free = await Promise.all(Array.from({ length: 10 }, () => claimFreeFailure(id)));
    expect(free.filter(Boolean)).toHaveLength(FREE_FAILURES_PER_DAY);

    const slots = await Promise.all(Array.from({ length: 10 }, () => claimOutcomeSlot(id, "generate_failed")));
    const granted = slots.filter((s) => s.allowed);
    expect(granted).toHaveLength(USAGE_LIMITS.generate_failed.free);
    // A withdrawn claim frees its slot again.
    await releaseOutcomeSlot(granted[0].slot);
    expect((await claimOutcomeSlot(id, "generate_failed")).allowed).toBe(true);
    expect((await claimOutcomeSlot(id, "generate_failed")).allowed).toBe(false);
  });

  it("parallel material adds cannot overshoot the per-student storage cap", async () => {
    const prisma = await db();
    const { createMaterial } = await import("@/lib/materials/store");
    const { MAX_STORED_CHARS_PER_USER, MAX_PAGE_CHARS } = await import("@/lib/materials/limits");
    const id = user("materials");
    const workspaceId = `${run}_materials_ws`;
    await prisma.workspace.create({ data: { id: workspaceId, ownerId: id, name: "W", data: "{}" } });
    // Each material is 1.5 M characters: two fit under 4 M, a third does not.
    const material = (n: number) =>
      Array.from({ length: 125 }, (_, i) => `${n}-${i} `.padEnd(MAX_PAGE_CHARS, "x"));
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, n) =>
        createMaterial({
          ownerId: id,
          workspaceId,
          title: `M${n}`,
          kind: "text",
          pages: material(n),
          sourcePages: 125,
          truncated: false,
        }),
      ),
    );
    const stored = await prisma.studyMaterial.aggregate({ where: { ownerId: id }, _sum: { charCount: true } });
    expect(stored._sum.charCount ?? 0).toBeLessThanOrEqual(MAX_STORED_CHARS_PER_USER);
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok && r.reason === "storage")).toHaveLength(4);
  }, 60_000);
});
