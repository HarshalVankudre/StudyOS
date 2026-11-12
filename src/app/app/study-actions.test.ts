import { beforeEach, describe, expect, it, vi } from "vitest";
import { utcDay, shiftDay } from "@/lib/study/days";
import { zeroCounts } from "@/lib/study/stats";

const m = vi.hoisted(() => ({
  userId: "user_1" as string | null,
  workspaceFindMany: vi.fn(),
  studyDayUpsert: vi.fn(),
  studyDayUpdate: vi.fn(),
  studyDayFindMany: vi.fn(),
  usageEventFindMany: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: { findMany: m.workspaceFindMany },
    studyDay: { upsert: m.studyDayUpsert, update: m.studyDayUpdate, findMany: m.studyDayFindMany },
    usageEvent: { findMany: m.usageEventFindMany },
  },
}));

import { getStudyDashboardAction, getStudyStatsAction, recordReviewsAction } from "./study-actions";

const utcToday = utcDay(new Date());
const counts = (o: Partial<ReturnType<typeof zeroCounts>>) => ({ ...zeroCounts(), ...o });
const row = (localDate: string, o: Partial<ReturnType<typeof zeroCounts>> = {}) => ({
  userId: "user_1",
  workspaceId: "w1",
  localDate,
  ...counts(o),
});

beforeEach(() => {
  m.userId = "user_1";
  for (const fn of [m.workspaceFindMany, m.studyDayUpsert, m.studyDayUpdate, m.studyDayFindMany, m.usageEventFindMany]) {
    fn.mockReset();
  }
  m.workspaceFindMany.mockResolvedValue([{ id: "w1" }]);
  m.studyDayUpsert.mockResolvedValue({});
  m.studyDayFindMany.mockResolvedValue([]);
  m.usageEventFindMany.mockResolvedValue([]);
});

describe("recordReviewsAction", () => {
  it("increments the student's day in an owned workspace", async () => {
    const res = await recordReviewsAction([
      { workspaceId: "w1", localDate: utcToday, counts: counts({ reviews: 3, good: 3, reviewTotal: 2, reviewPassed: 2 }) },
    ]);
    expect(res).toEqual({ ok: true });
    expect(m.workspaceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: "user_1" }) }),
    );
    const arg = m.studyDayUpsert.mock.calls[0][0];
    expect(arg.where.userId_workspaceId_localDate).toEqual({ userId: "user_1", workspaceId: "w1", localDate: utcToday });
    expect(arg.create).toMatchObject({ reviews: 3, good: 3 });
    expect(arg.update.reviews).toEqual({ increment: 3 });
  });

  it("ignores other people's workspaces, impossible days and empty batches", async () => {
    m.workspaceFindMany.mockResolvedValue([]);
    await recordReviewsAction([{ workspaceId: "not-mine", localDate: utcToday, counts: counts({ reviews: 1 }) }]);
    expect(m.studyDayUpsert).not.toHaveBeenCalled();

    m.workspaceFindMany.mockResolvedValue([{ id: "w1" }]);
    await recordReviewsAction([
      { workspaceId: "w1", localDate: shiftDay(utcToday, -5), counts: counts({ reviews: 1 }) },
      { workspaceId: "w1", localDate: shiftDay(utcToday, 3), counts: counts({ reviews: 1 }) },
      { workspaceId: "w1", localDate: utcToday, counts: counts({}) },
    ]);
    expect(m.studyDayUpsert).not.toHaveBeenCalled();
  });

  it("accepts the neighbouring local days of far-east and far-west students", async () => {
    await recordReviewsAction([
      { workspaceId: "w1", localDate: shiftDay(utcToday, 1), counts: counts({ practice: 1 }) },
      { workspaceId: "w1", localDate: shiftDay(utcToday, -1), counts: counts({ reviews: 1 }) },
    ]);
    expect(m.studyDayUpsert).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed input and unauthenticated calls", async () => {
    expect(await recordReviewsAction([{ workspaceId: "w1", localDate: "yesterday", counts: counts({}) }])).toEqual({ ok: false });
    expect(
      await recordReviewsAction([{ workspaceId: "w1", localDate: utcToday, counts: { ...counts({}), reviews: -4 } }]),
    ).toEqual({ ok: false });
    m.userId = null;
    expect(await recordReviewsAction([])).toEqual({ ok: false });
  });

  it("falls back to an update when two tabs create the same day at once", async () => {
    m.studyDayUpsert.mockRejectedValueOnce(new Error("Unique constraint failed"));
    m.studyDayUpdate.mockResolvedValue({});
    expect(
      await recordReviewsAction([{ workspaceId: "w1", localDate: utcToday, counts: counts({ reviews: 2 }) }]),
    ).toEqual({ ok: true });
    expect(m.studyDayUpdate.mock.calls[0][0].data.reviews).toEqual({ increment: 2 });
  });
});

describe("getStudyStatsAction", () => {
  it("combines per-day rows with legacy session events bucketed in the student's zone", async () => {
    // Student in UTC-7. Legacy event at 05:00 UTC today = 22:00 yesterday local.
    const offset = 420;
    const now = new Date();
    const localToday = utcDay(new Date(now.getTime() - offset * 60_000));
    const legacy = new Date(`${shiftDay(localToday, 0)}T05:00:00Z`);
    m.usageEventFindMany.mockResolvedValue([{ createdAt: legacy }]);
    m.studyDayFindMany.mockResolvedValue([row(shiftDay(localToday, -2), { reviews: 4 }), row(localToday, { practice: 2 })]);
    const s = await getStudyStatsAction(offset);
    // -2 (row), -1 (legacy, local evening), today (practice) → 3 days.
    expect(s.current).toBe(3);
    expect(s.studiedToday).toBe(true);
  });

  it("returns an empty streak for signed-out users", async () => {
    m.userId = null;
    expect((await getStudyStatsAction(0)).current).toBe(0);
  });
});

describe("getStudyDashboardAction", () => {
  it("builds per-day reviews, retention and an all-workspace forecast", async () => {
    const today = utcDay(new Date());
    m.studyDayFindMany.mockResolvedValue([
      row(today, { reviews: 10, reviewTotal: 8, reviewPassed: 6 }),
      row(shiftDay(today, -3), { reviews: 5, reviewTotal: 2, reviewPassed: 2 }),
    ]);
    m.workspaceFindMany.mockResolvedValue([
      {
        data: JSON.stringify({
          pages: [{ blocks: [{ type: "flashcards", cards: [
            { id: "a", front: "q", back: "a", reps: 2, dueAt: shiftDay(today, 1) },
            { id: "b", front: "q", back: "a" },
          ] }] }],
        }),
      },
      { data: "not json" },
    ]);
    const d = await getStudyDashboardAction({ offsetMinutes: 0 });
    expect(d).not.toBeNull();
    expect(d!.perDay).toHaveLength(28);
    expect(d!.perDay[27].reviews).toBe(10);
    expect(d!.retention).toBeCloseTo(0.8);
    expect(d!.reviews30).toBe(15);
    expect(d!.forecast!.points[1].count).toBe(1);
    expect(d!.forecast!.newWaiting).toBe(1);
  });

  it("scopes rows to one workspace and leaves the forecast to the client", async () => {
    const d = await getStudyDashboardAction({ offsetMinutes: 0, workspaceId: "w1" });
    expect(m.studyDayFindMany.mock.calls[0][0].where.workspaceId).toBe("w1");
    expect(d!.forecast).toBeNull();
    expect(m.workspaceFindMany).not.toHaveBeenCalled();
  });
});
