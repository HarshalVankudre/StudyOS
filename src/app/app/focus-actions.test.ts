import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userId: "user_1" as string | null,
  focusCreate: vi.fn(),
  focusGroupBy: vi.fn(),
  focusCount: vi.fn(),
  workspaceFindFirst: vi.fn(),
  tombstone: vi.fn(),
  config: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("@/lib/db", () => ({
  prisma: {
    focusSession: { create: m.focusCreate, groupBy: m.focusGroupBy, count: m.focusCount },
    workspace: { findFirst: m.workspaceFindFirst },
    deletedAccount: { findUnique: m.tombstone },
    dailyStudyAgentConfig: { findUnique: m.config },
  },
}));

import { MAX_SESSIONS_PER_DAY } from "@/lib/study/focus";
import { getFocusSummary, recordFocusSession } from "./focus-actions";

// 2026-11-13 23:30 UTC: already the 14th in Berlin, still the 13th in New York.
const NOW = Date.parse("2026-11-13T23:30:00Z");
const MIN = 60_000;

const input = (o: Partial<Parameters<typeof recordFocusSession>[0]> = {}) => ({
  clientId: "c0ffee00-1111-2222-3333-444455556666",
  startedAt: NOW - 25 * MIN,
  seconds: 1500,
  completed: true,
  label: "History essay",
  course: "Semester HQ",
  workspaceId: "ws1",
  itemKey: "deadline:ws1:db:essay",
  timeZone: "Europe/Berlin",
  ...o,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  m.userId = "user_1";
  for (const fn of [m.focusCreate, m.focusGroupBy, m.focusCount, m.workspaceFindFirst, m.tombstone, m.config]) fn.mockReset();
  m.focusCount.mockResolvedValue(0);
  m.focusCreate.mockResolvedValue({});
  m.workspaceFindFirst.mockResolvedValue({ id: "ws1" });
  m.tombstone.mockResolvedValue(null);
  m.config.mockResolvedValue(null);
  m.focusGroupBy.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordFocusSession", () => {
  it("saves a finished block on the student's local day, linked to their workspace and item", async () => {
    expect(await recordFocusSession(input())).toEqual({ ok: true, stored: true });
    expect(m.focusCreate).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        clientId: "c0ffee00-1111-2222-3333-444455556666",
        workspaceId: "ws1",
        itemKey: "deadline:ws1:db:essay",
        label: "History essay · Semester HQ",
        // Started 23:05 UTC: the 14th in Berlin.
        localDate: "2026-11-14",
        startedAt: new Date(NOW - 25 * MIN),
        seconds: 1500,
        completed: true,
      },
    });
  });

  it("reads the day in the browser's zone, else the planner's zone, else UTC", async () => {
    await recordFocusSession(input({ timeZone: "America/New_York" }));
    expect(m.focusCreate.mock.calls[0][0].data.localDate).toBe("2026-11-13");

    m.config.mockResolvedValue({ timeZone: "Asia/Tokyo" });
    await recordFocusSession(input({ clientId: "second-block-0001", timeZone: "Not/AZone" }));
    expect(m.focusCreate.mock.calls[1][0].data.localDate).toBe("2026-11-14");

    m.config.mockResolvedValue(null);
    await recordFocusSession(input({ clientId: "third-block-00001", timeZone: undefined }));
    expect(m.focusCreate.mock.calls[2][0].data.localDate).toBe("2026-11-13");
  });

  it("requires a signed-in student", async () => {
    m.userId = null;
    expect(await recordFocusSession(input())).toEqual({ ok: false, reason: "unauthenticated" });
    expect(m.focusCreate).not.toHaveBeenCalled();
  });

  it("refuses malformed input", async () => {
    const bad = [
      input({ clientId: "x" }),
      input({ clientId: "has spaces in it" }),
      input({ seconds: -5 }),
      input({ seconds: Number.POSITIVE_INFINITY }),
      input({ startedAt: 1.5 }),
      { ...input(), completed: "yes" },
      { ...input(), workspaceId: "" },
      { ...input(), label: "x".repeat(2_000) },
      null,
    ];
    for (const value of bad) {
      expect(await recordFocusSession(value as never), JSON.stringify(value)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(m.focusCreate).not.toHaveBeenCalled();
  });

  it("refuses starts more than a day old or in the future (beyond a little clock skew)", async () => {
    expect(await recordFocusSession(input({ startedAt: NOW - 25 * 60 * MIN }))).toEqual({ ok: false, reason: "invalid" });
    expect(await recordFocusSession(input({ startedAt: NOW + 10 * MIN }))).toEqual({ ok: false, reason: "invalid" });
    // Two minutes ahead is a clock out of sync, not a fake.
    expect(await recordFocusSession(input({ startedAt: NOW + 2 * MIN, seconds: 60 }))).toEqual({ ok: true, stored: true });
  });

  it("does not store sessions under a minute", async () => {
    expect(await recordFocusSession(input({ seconds: 59 }))).toEqual({ ok: true, stored: false });
    expect(m.focusCreate).not.toHaveBeenCalled();
  });

  it("cuts sessions to three hours and to the time that really passed", async () => {
    await recordFocusSession(input({ startedAt: NOW - 20 * 60 * MIN, seconds: 6 * 3600 }));
    expect(m.focusCreate.mock.calls[0][0].data.seconds).toBe(3 * 3600);
    // Started 25 minutes ago but claims 2 hours: at most 25 min + 5 min skew.
    await recordFocusSession(input({ clientId: "second-block-0001", seconds: 7200 }));
    expect(m.focusCreate.mock.calls[1][0].data.seconds).toBe(30 * 60);
  });

  it("checks the workspace is the student's and not in the trash, and drops the link if not", async () => {
    m.workspaceFindFirst.mockResolvedValue(null);
    expect(await recordFocusSession(input())).toEqual({ ok: true, stored: true });
    expect(m.workspaceFindFirst).toHaveBeenCalledWith({
      where: { id: "ws1", ownerId: "user_1", deletedAt: null },
      select: { id: true },
    });
    // The minutes are kept; the foreign or trashed workspace and its item are not.
    expect(m.focusCreate.mock.calls[0][0].data).toMatchObject({ workspaceId: null, itemKey: null, seconds: 1500 });
  });

  it("saves sessions about nothing in particular", async () => {
    await recordFocusSession(input({ workspaceId: null, itemKey: null, label: "  ", course: null }));
    expect(m.workspaceFindFirst).not.toHaveBeenCalled();
    expect(m.focusCreate.mock.calls[0][0].data).toMatchObject({ workspaceId: null, itemKey: null, label: null });
  });

  it("counts a retried save once (same clientId)", async () => {
    m.focusCreate.mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    expect(await recordFocusSession(input())).toEqual({ ok: true, stored: true });
    expect(await recordFocusSession(input())).toEqual({ ok: true, stored: true, duplicate: true });
  });

  it("says when the database fails, so the browser keeps the save for later", async () => {
    m.focusCreate.mockRejectedValueOnce(new Error("db down"));
    expect(await recordFocusSession(input())).toEqual({ ok: false, reason: "failed" });
  });

  it("drops saves beyond a day's worth of blocks, counting the last 24 hours of this student", async () => {
    m.focusCount.mockResolvedValue(MAX_SESSIONS_PER_DAY);
    await expect(recordFocusSession(input())).resolves.toEqual({ ok: true, stored: false });
    expect(m.focusCreate).not.toHaveBeenCalled();
    expect(m.focusCount).toHaveBeenCalledWith({
      where: { userId: "user_1", createdAt: { gte: new Date(NOW - 24 * 60 * 60 * 1000) } },
    });
  });

  it("writes nothing for an account being erased", async () => {
    m.tombstone.mockResolvedValue({ userId: "user_1" });
    expect(await recordFocusSession(input())).toEqual({ ok: false, reason: "unauthenticated" });
    expect(m.focusCreate).not.toHaveBeenCalled();
  });
});

describe("getFocusSummary", () => {
  it("sums per local day in the planner's zone, owner-scoped", async () => {
    m.config.mockResolvedValue({ timeZone: "Europe/Berlin" });
    m.focusGroupBy.mockResolvedValue([
      { localDate: "2026-11-14", _sum: { seconds: 1500 } },
      { localDate: "2026-11-13", _sum: { seconds: 3000 } },
    ]);
    const summary = await getFocusSummary();
    expect(summary).toMatchObject({ today: "2026-11-14", todayMinutes: 25, streak: 2, weekMinutes: 75 });
    expect(summary?.week).toHaveLength(7);
    const query = m.focusGroupBy.mock.calls[0][0];
    expect(query.where.userId).toBe("user_1");
    expect(query.where.localDate.lte).toBe("2026-11-14");
    expect(query.by).toEqual(["localDate"]);
  });

  it("uses a time zone it is given", async () => {
    const summary = await getFocusSummary({ timeZone: "America/New_York" });
    expect(summary?.today).toBe("2026-11-13");
    expect(m.config).not.toHaveBeenCalled();
  });

  it("is empty without a student, and null (never a crash) when the database fails", async () => {
    m.focusGroupBy.mockRejectedValueOnce(new Error("relation does not exist"));
    expect(await getFocusSummary()).toBeNull();
    m.userId = null;
    expect(await getFocusSummary()).toBeNull();
  });
});
