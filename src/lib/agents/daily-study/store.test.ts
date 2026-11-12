import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";
import { planSourcesKey } from "./planner";
import { applyCompletion } from "./reconcile";
import type { DailyStudyPlanItem } from "./types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  configFindUnique: vi.fn(),
  configUpsert: vi.fn(),
  planFindUnique: vi.fn(),
  planFindFirst: vi.fn(),
  planUpsert: vi.fn(),
  planUpdateMany: vi.fn(),
  runFindMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdateMany: vi.fn(),
  workspaceFindMany: vi.fn(),
  updateWorkspaceWith: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/workspace/store", () => ({ updateWorkspaceWith: mocks.updateWorkspaceWith }));
vi.mock("@/lib/db", () => ({
  prisma: {
    dailyStudyAgentConfig: {
      findUnique: mocks.configFindUnique,
      upsert: mocks.configUpsert,
    },
    dailyStudyPlan: {
      findUnique: mocks.planFindUnique,
      findFirst: mocks.planFindFirst,
      upsert: mocks.planUpsert,
      updateMany: mocks.planUpdateMany,
    },
    agentRun: {
      findMany: mocks.runFindMany,
      create: mocks.runCreate,
      updateMany: mocks.runUpdateMany,
    },
    workspace: { findMany: mocks.workspaceFindMany },
  },
}));

import {
  getAgentCenterSnapshot,
  getDailyStudyAgentOverview,
  localDateInTimeZone,
  normalizeTimeZone,
  runDailyStudyAgent,
  setDailyStudyItemCompleted,
} from "./store";

const WORKSPACE: Workspace = {
  id: "ws-1",
  name: "Semester HQ",
  pages: [
    {
      id: "home",
      title: "Home",
      blocks: [
        { id: "todo-1", type: "todo", text: "Email the tutor", checked: false },
        { id: "view", type: "database_view", databaseId: "db", viewId: "v" },
      ],
    },
  ],
  databases: [
    {
      id: "db",
      name: "Assignments",
      properties: [
        { id: "name", name: "Assignment", type: "text" },
        { id: "due", name: "Due", type: "date" },
        {
          id: "status",
          name: "Status",
          type: "status",
          options: [
            { id: "todo", label: "To do" },
            { id: "done", label: "Done" },
          ],
        },
      ],
      rows: [{ id: "essay", cells: { name: "Essay", due: "2026-11-12", status: "todo" } }],
      views: [{ id: "v", name: "Table", type: "table" }],
    },
  ],
};

let stored: Workspace;

function planRow(items: DailyStudyPlanItem[] | object[], overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    userId: "user-1",
    localDate: "2026-11-12",
    timeZone: "UTC",
    summary: "",
    items: JSON.stringify(items),
    version: 2,
    // Built from the workspaces as they are now, unless a test says otherwise.
    details: JSON.stringify({
      budgetMinutes: 60,
      workload: null,
      exams: [],
      progress: {},
      sources: planSourcesKey([WORKSPACE]),
    }),
    sourceCount: 1,
    candidateCount: 2,
    generatedAt: new Date("2026-11-12T08:00:00.000Z"),
    ...overrides,
  };
}

function todoItem(overrides: Partial<DailyStudyPlanItem> = {}): DailyStudyPlanItem {
  return {
    id: "task:ws-1:home:todo-1",
    kind: "task",
    mode: "finish",
    title: "Email the tutor",
    workspaceName: "Semester HQ",
    section: "Home",
    target: { workspaceId: "ws-1", pageId: "home", blockId: "todo-1" },
    minutes: 15,
    reason: { code: "open_task" },
    completed: false,
    ...overrides,
  };
}

describe("Daily Study Agent store", () => {
  beforeEach(() => {
    stored = structuredClone(WORKSPACE);
    mocks.auth.mockResolvedValue({ userId: "user-1" });
    mocks.configFindUnique.mockResolvedValue({ enabled: true, dailyMinutes: 90, timeZone: "UTC" });
    mocks.planFindUnique.mockResolvedValue(null);
    mocks.planFindFirst.mockResolvedValue(null);
    mocks.planUpdateMany.mockResolvedValue({ count: 1 });
    mocks.planUpsert.mockImplementation(async ({ create }) => ({ id: "plan-1", ...create }));
    mocks.runFindMany.mockResolvedValue([]);
    mocks.configUpsert.mockResolvedValue({ userId: "user-1", enabled: true, dailyMinutes: 60, timeZone: "UTC" });
    mocks.runCreate.mockResolvedValue({ id: "run-1" });
    mocks.runUpdateMany.mockResolvedValue({ count: 1 });
    mocks.workspaceFindMany.mockImplementation(async () => [{ id: "ws-1", data: JSON.stringify(stored) }]);
    // A faithful stand-in for the version-checked save: mutate a copy, keep it.
    mocks.updateWorkspaceWith.mockImplementation(async (_id: string, mutate: (d: Workspace) => { changed: boolean; result: unknown }) => {
      const draft = structuredClone(stored);
      const { changed, result } = mutate(draft);
      if (!changed) return { status: "unchanged", result };
      stored = draft;
      return { status: "saved", version: 2, result };
    });
  });

  afterEach(() => vi.useRealTimers());

  it("reads only the signed-in user's data", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T10:00:00.000Z"));
    await getAgentCenterSnapshot(7);
    expect(mocks.configFindUnique).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mocks.planFindUnique).toHaveBeenCalledWith({
      where: { userId_localDate: { userId: "user-1", localDate: "2026-11-12" } },
    });
    expect(mocks.runFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", agentKey: "daily-study" }, take: 7 }),
    );
  });

  it("uses the student's local day around midnight", () => {
    const lateUtc = new Date("2026-11-12T23:30:00.000Z");
    expect(localDateInTimeZone("UTC", lateUtc)).toBe("2026-11-12");
    expect(localDateInTimeZone("Europe/Berlin", lateUtc)).toBe("2026-11-13");
    expect(localDateInTimeZone("Asia/Tokyo", lateUtc)).toBe("2026-11-13");
    expect(localDateInTimeZone("America/Los_Angeles", lateUtc)).toBe("2026-11-12");
    const earlyUtc = new Date("2026-11-13T02:00:00.000Z");
    expect(localDateInTimeZone("America/New_York", earlyUtc)).toBe("2026-11-12");
    expect(localDateInTimeZone("Pacific/Kiritimati", new Date("2026-11-12T10:30:00.000Z"))).toBe("2026-11-13");
    expect(normalizeTimeZone("Not/AZone")).toBe("UTC");
  });

  it("builds a structured, versioned plan and a language-neutral run summary", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T09:00:00.000Z"));
    const plan = await runDailyStudyAgent({ trigger: "manual", timeZone: "UTC", todayMinutes: 75 });

    const saved = mocks.planUpsert.mock.calls[0][0].create;
    expect(saved).toMatchObject({ userId: "user-1", localDate: "2026-11-12", version: 2, summary: "" });
    expect(JSON.parse(saved.details)).toMatchObject({ budgetMinutes: 75, budgetOverride: true });
    expect(plan?.items.map((i) => i.id)).toEqual([
      "deadline:ws-1:db:essay",
      "task:ws-1:home:todo-1",
    ]);
    // No English sentences are stored: reasons are codes.
    expect(saved.items).not.toMatch(/Due today|Overdue/);
    const runUpdate = mocks.runUpdateMany.mock.calls[0][0];
    expect(JSON.parse(runUpdate.data.summary)).toEqual({ v: 2, items: 2, minutes: 75, workspaces: 1 });
  });

  it("rolls yesterday's unfinished items into today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T09:00:00.000Z"));
    mocks.planFindFirst.mockResolvedValue({
      localDate: "2026-11-09",
      version: 2,
      details: "{}",
      items: JSON.stringify([todoItem({ id: "task:ws-1:home:todo-1", completed: false })]),
    });
    const plan = await runDailyStudyAgent({ trigger: "manual", timeZone: "UTC" });
    expect(mocks.planFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", localDate: { lt: "2026-11-12", gte: "2026-10-29" } },
      }),
    );
    expect(plan?.items.find((i) => i.kind === "task")?.carry).toEqual({ from: "2026-11-09", count: 1 });
    expect(plan?.details).toMatchObject({ previousDate: "2026-11-09", carried: 1 });
  });

  it("automatic runs reuse today's plan but upgrade an English (version 1) plan", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T09:00:00.000Z"));
    mocks.planFindUnique.mockResolvedValue(planRow([todoItem()]));
    await runDailyStudyAgent({ trigger: "auto", timeZone: "UTC" });
    expect(mocks.planUpsert).not.toHaveBeenCalled();

    mocks.planFindUnique.mockResolvedValue(
      planRow(
        [{ id: "task:ws-1:home:todo-1", completed: true, title: "Email the tutor", reason: "This is still open." }],
        { version: 1, details: "{}", summary: "1 focused session across 1 workspace." },
      ),
    );
    const upgraded = await runDailyStudyAgent({ trigger: "auto", timeZone: "UTC" });
    expect(mocks.planUpsert).toHaveBeenCalledTimes(1);
    // What the student had checked off stays checked (and plan-only, as before).
    expect(upgraded?.items.find((i) => i.id === "task:ws-1:home:todo-1")).toMatchObject({ completed: true });
  });

  it("upgrades a version 1 plan for today when it is read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T09:00:00.000Z"));
    mocks.planFindUnique.mockResolvedValue(
      planRow([{ id: "deadline:ws-1:db:essay", completed: false }], { version: 1, details: "{}" }),
    );
    const snapshot = await getAgentCenterSnapshot();
    expect(mocks.planUpsert).toHaveBeenCalledTimes(1);
    expect(snapshot.plan?.items[0]).toMatchObject({ id: "deadline:ws-1:db:essay", reason: { code: "due_today" } });
    expect(typeof snapshot.plan?.generatedAt).toBe("string");
  });

  it("shows completion made in the editor on the plan", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T09:00:00.000Z"));
    (stored.pages[0].blocks[0] as { checked: boolean }).checked = true;
    mocks.planFindUnique.mockResolvedValue(planRow([todoItem()]));
    const snapshot = await getAgentCenterSnapshot();
    expect(snapshot.plan?.items[0].completed).toBe(true);
    expect(mocks.planUpdateMany).toHaveBeenCalledTimes(1);
  });

  describe("checking items off", () => {
    it("checks the to-do in the workspace, and unchecking reopens it", async () => {
      mocks.planFindFirst.mockResolvedValue(planRow([todoItem()]));
      const done = await setDailyStudyItemCompleted("plan-1", "task:ws-1:home:todo-1", true);
      expect(done).toEqual({ ok: true, completed: true, wroteThrough: true });
      expect(stored.pages[0].blocks[0]).toMatchObject({ checked: true });
      const savedItems = JSON.parse(mocks.planUpdateMany.mock.calls[0][0].data.items);
      expect(savedItems[0]).toMatchObject({ completed: true });
      expect(mocks.planUpdateMany.mock.calls[0][0].where).toEqual({ id: "plan-1", userId: "user-1" });

      mocks.planFindFirst.mockResolvedValue(planRow(savedItems));
      const undone = await setDailyStudyItemCompleted("plan-1", "task:ws-1:home:todo-1", false);
      expect(undone).toEqual({ ok: true, completed: false, wroteThrough: true });
      expect(stored.pages[0].blocks[0]).toMatchObject({ checked: false });
    });

    it("gives a row its done status and restores the old one on undo", async () => {
      const rowItem = todoItem({
        id: "deadline:ws-1:db:essay",
        kind: "deadline",
        target: { workspaceId: "ws-1", pageId: "home", databaseId: "db", rowId: "essay" },
        reason: { code: "due_today" },
      });
      mocks.planFindFirst.mockResolvedValue(planRow([rowItem]));
      await setDailyStudyItemCompleted("plan-1", rowItem.id, true);
      expect(stored.databases[0].rows[0].cells.status).toBe("done");
      const savedItems = JSON.parse(mocks.planUpdateMany.mock.calls[0][0].data.items);
      expect(savedItems[0]).toMatchObject({ completed: true, restore: "todo" });

      mocks.planFindFirst.mockResolvedValue(planRow(savedItems));
      await setDailyStudyItemCompleted("plan-1", rowItem.id, false);
      expect(stored.databases[0].rows[0].cells.status).toBe("todo");
    });

    it("records a work session without touching the row, unless the student says it is finished", async () => {
      const session = todoItem({
        id: "deadline:ws-1:db:essay",
        kind: "deadline",
        mode: "session",
        target: { workspaceId: "ws-1", pageId: "home", databaseId: "db", rowId: "essay" },
        reason: { code: "due_soon", days: 4 },
      });
      mocks.planFindFirst.mockResolvedValue(planRow([session]));
      const plain = await setDailyStudyItemCompleted("plan-1", session.id, true);
      expect(plain).toMatchObject({ ok: true, wroteThrough: false });
      expect(mocks.updateWorkspaceWith).not.toHaveBeenCalled();
      expect(stored.databases[0].rows[0].cells.status).toBe("todo");

      const finished = await setDailyStudyItemCompleted("plan-1", session.id, true, { finish: true });
      expect(finished).toMatchObject({ ok: true, wroteThrough: true });
      expect(stored.databases[0].rows[0].cells.status).toBe("done");
    });

    it("reports a conflict instead of overwriting newer work", async () => {
      mocks.planFindFirst.mockResolvedValue(planRow([todoItem()]));
      mocks.updateWorkspaceWith.mockResolvedValue({ status: "conflict" });
      expect(await setDailyStudyItemCompleted("plan-1", "task:ws-1:home:todo-1", true)).toEqual({
        ok: false,
        reason: "conflict",
      });
      expect(mocks.planUpdateMany).not.toHaveBeenCalled();
    });

    it("ignores plans of other users and unknown items", async () => {
      mocks.planFindFirst.mockResolvedValue(null);
      expect(await setDailyStudyItemCompleted("plan-x", "item", true)).toEqual({ ok: false, reason: "not_found" });
      expect(mocks.planFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "plan-x", userId: "user-1" } }));
    });
  });

  describe("refreshing today's plan when the workspaces change", () => {
    const at = () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-12T09:00:00.000Z"));
    };
    const details = (extra: Record<string, unknown> = {}) =>
      JSON.stringify({ budgetMinutes: 60, workload: null, exams: [], progress: {}, ...extra });

    it("plans again when the first workspace appears after an empty sign-up plan", async () => {
      at();
      // Built at sign-up, before any workspace existed: nothing to do.
      mocks.planFindUnique.mockResolvedValue(
        planRow([], { details: details({ sources: planSourcesKey([]) }), sourceCount: 0 }),
      );
      const { plan } = await getDailyStudyAgentOverview();
      expect(plan?.items.map((i) => i.id)).toEqual(["deadline:ws-1:db:essay", "task:ws-1:home:todo-1"]);
      // Only the plan that was read is replaced (a concurrent check-off wins).
      const update = mocks.planUpdateMany.mock.calls[0][0];
      expect(update.where).toEqual({ id: "plan-1", userId: "user-1", items: "[]" });
      expect(JSON.parse(update.data.details).sources).toBe(planSourcesKey([WORKSPACE]));
      expect(mocks.planUpsert).not.toHaveBeenCalled();
    });

    it("leaves an up-to-date plan alone", async () => {
      at();
      mocks.planFindUnique.mockResolvedValue(planRow([todoItem()]));
      const { plan } = await getDailyStudyAgentOverview();
      expect(plan?.items.map((i) => i.id)).toEqual(["task:ws-1:home:todo-1"]);
      expect(mocks.planUpdateMany).not.toHaveBeenCalled();
    });

    it("keeps what is checked off, today's chosen time, and does not grow the day", async () => {
      at();
      mocks.planFindUnique.mockResolvedValue(
        planRow([todoItem({ completed: true, minutes: 15, completedAt: "2026-11-12T08:30:00.000Z" })], {
          details: details({ budgetMinutes: 30, budgetOverride: true, sources: planSourcesKey([]) }),
        }),
      );
      // The to-do was checked through the plan, so it is checked in the workspace too.
      (stored.pages[0].blocks[0] as { checked: boolean }).checked = true;
      const { plan } = await getDailyStudyAgentOverview();
      expect(plan?.items.find((i) => i.id === "task:ws-1:home:todo-1")).toMatchObject({ completed: true });
      expect(plan?.details).toMatchObject({ budgetMinutes: 30, budgetOverride: true });
      const total = plan!.items.reduce((sum, i) => sum + i.minutes, 0);
      expect(total).toBeLessThanOrEqual(30);
      expect(plan?.items.some((i) => i.id === "deadline:ws-1:db:essay")).toBe(true);
    });

    it("picks up rows a deadline import added", async () => {
      at();
      mocks.planFindUnique.mockResolvedValue(planRow([todoItem()]));
      stored.databases[0].rows.push({
        id: "imported-quiz",
        cells: { name: "Quiz 4", due: "2026-11-13", status: "todo" },
      });
      const { plan } = await getDailyStudyAgentOverview();
      expect(plan?.items.map((i) => i.id)).toContain("deadline:ws-1:db:imported-quiz");
      expect(mocks.planUpdateMany).toHaveBeenCalledTimes(1);
    });

    it("never shows items from a trashed workspace, and plans from the others", async () => {
      at();
      const other = (overrides: Partial<DailyStudyPlanItem>) =>
        todoItem({
          workspaceName: "Old term",
          target: { workspaceId: "ws-trashed", pageId: "home", blockId: "todo-1" },
          ...overrides,
        });
      mocks.planFindUnique.mockResolvedValue(
        planRow(
          [
            other({ id: "task:ws-trashed:home:todo-1", completed: true }),
            other({ id: "task:ws-trashed:home:todo-2", completed: false }),
            todoItem(),
          ],
          { details: details({ sources: planSourcesKey([WORKSPACE, { ...WORKSPACE, id: "ws-trashed" }]) }) },
        ),
      );
      const { plan } = await getDailyStudyAgentOverview();
      expect(mocks.workspaceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: "user-1", deletedAt: null } }),
      );
      expect(plan?.items.length).toBeGreaterThan(0);
      expect(plan?.items.every((i) => i.target.workspaceId === "ws-1")).toBe(true);
      // The done item is still stored, so restoring the workspace brings it back.
      const saved = JSON.parse(mocks.planUpdateMany.mock.calls[0][0].data.items) as DailyStudyPlanItem[];
      expect(saved.find((i) => i.id === "task:ws-trashed:home:todo-1")).toMatchObject({ completed: true });
      expect(saved.some((i) => i.id === "task:ws-trashed:home:todo-2")).toBe(false);
    });

    it("hides a trashed workspace's items even when the plan is otherwise current", async () => {
      at();
      mocks.planFindUnique.mockResolvedValue(
        planRow([
          todoItem({
            id: "task:ws-trashed:home:todo-1",
            completed: true,
            target: { workspaceId: "ws-trashed", pageId: "home", blockId: "todo-1" },
          }),
          todoItem(),
        ]),
      );
      const { plan } = await getDailyStudyAgentOverview();
      expect(plan?.items.map((i) => i.id)).toEqual(["task:ws-1:home:todo-1"]);
    });

    it("yields to a check-off that landed while it was planning", async () => {
      at();
      const fresher = planRow([todoItem({ completed: true })]);
      mocks.planFindUnique
        .mockResolvedValueOnce(planRow([todoItem()], { details: details({ sources: planSourcesKey([]) }) }))
        .mockResolvedValueOnce(fresher);
      mocks.planUpdateMany.mockResolvedValueOnce({ count: 0 });
      const { plan } = await getDailyStudyAgentOverview();
      expect(plan?.items).toEqual([expect.objectContaining({ id: "task:ws-1:home:todo-1", completed: true })]);
    });

    it("rebuilding a manual run keeps check-offs from a trashed workspace out of the summary", async () => {
      at();
      mocks.planFindUnique.mockResolvedValue(
        planRow([
          todoItem({
            id: "task:ws-trashed:home:todo-1",
            completed: true,
            target: { workspaceId: "ws-trashed", pageId: "home", blockId: "todo-1" },
          }),
        ]),
      );
      await runDailyStudyAgent({ trigger: "manual", timeZone: "UTC" });
      const summary = JSON.parse(mocks.runUpdateMany.mock.calls[0][0].data.summary);
      expect(summary.workspaces).toBe(1);
    });
  });

  it("applyCompletion is what the store writes through", () => {
    const w = structuredClone(WORKSPACE);
    expect(applyCompletion(w, todoItem(), true).applied).toBe(true);
  });
});
