import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userId: "user_1" as string | null,
  studyGroupBy: vi.fn(),
  focusGroupBy: vi.fn(),
  focusFindMany: vi.fn(),
  usageFindMany: vi.fn(),
  workspaceFindMany: vi.fn(),
  config: vi.fn(),
  reminders: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: m.reportError }));
vi.mock("@/lib/db", () => ({
  prisma: {
    studyDay: { groupBy: m.studyGroupBy },
    focusSession: { groupBy: m.focusGroupBy, findMany: m.focusFindMany },
    usageEvent: { findMany: m.usageFindMany },
    workspace: { findMany: m.workspaceFindMany },
    dailyStudyAgentConfig: { findUnique: m.config },
    notificationPreference: { findUnique: m.reminders },
  },
}));

import { getInsights, insightsZone, loadPeriodTotals } from "./insights-store";
import { MAX_FOCUS_STARTS } from "./insights";

// 2026-11-13 23:30 UTC: already the 14th in Berlin, still the 13th in New York.
const NOW = Date.parse("2026-11-13T23:30:00Z");

type Args = { by: string[]; where: Record<string, unknown> };

const sums = (o: Record<string, number> = {}) => ({
  reviews: 0,
  practice: 0,
  newCards: 0,
  reviewTotal: 0,
  reviewPassed: 0,
  quizAnswers: 0,
  quizCorrect: 0,
  ...o,
});

function callBy(fn: ReturnType<typeof vi.fn>, by: string): Args {
  const call = fn.mock.calls.find((c) => (c[0] as Args).by[0] === by);
  if (!call) throw new Error(`no groupBy by ${by}`);
  return call[0] as Args;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  m.userId = "user_1";
  m.config.mockResolvedValue(null);
  m.reminders.mockResolvedValue(null);
  m.studyGroupBy.mockImplementation(async (args: Args) => {
    if (args.by[0] === "localDate") {
      return [
        { localDate: "2026-11-12", _sum: sums({ reviews: 10, reviewTotal: 4, reviewPassed: 3 }) },
        { localDate: "2026-11-10", _sum: sums({ quizAnswers: 4, quizCorrect: 2 }) },
        // Only new-card counters, no answers: not a study day for the streak.
        { localDate: "2026-11-09", _sum: sums({ newCards: 2 }) },
        { localDate: "2026-09-01", _sum: sums({ reviews: 1 }) },
      ];
    }
    return [
      { workspaceId: "ws_live", _sum: sums({ reviews: 10, quizAnswers: 4, quizCorrect: 2 }) },
      { workspaceId: "ws_trashed", _sum: sums({ practice: 3 }) },
    ];
  });
  m.focusGroupBy.mockImplementation(async (args: Args) => {
    if (args.by[0] === "localDate") {
      return [{ localDate: "2026-11-12", _sum: { seconds: 1800 }, _count: { _all: 2 } }];
    }
    return [
      { workspaceId: "ws_live", _sum: { seconds: 1200 } },
      { workspaceId: null, _sum: { seconds: 600 } },
    ];
  });
  m.focusFindMany.mockResolvedValue([
    { startedAt: new Date("2026-11-12T08:00:00Z"), seconds: 1200 },
    { startedAt: new Date("2026-11-12T18:00:00Z"), seconds: 600 },
  ]);
  // A legacy review session at 23:00 UTC on the 11th: still the 11th in New York.
  m.usageFindMany.mockResolvedValue([{ createdAt: new Date("2026-11-11T23:00:00Z") }]);
  // Only live, owned workspaces come back (the query filters the rest out).
  m.workspaceFindMany.mockResolvedValue([{ id: "ws_live", name: "Biology", icon: "🧬" }]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getInsights", () => {
  it("requires a signed-in student and reads nothing otherwise", async () => {
    m.userId = null;
    expect(await getInsights({ period: "7d" })).toBeNull();
    expect(m.studyGroupBy).not.toHaveBeenCalled();
    expect(m.focusGroupBy).not.toHaveBeenCalled();
  });

  it("reads only the signed-in student's rows, in small grouped queries over capped day ranges", async () => {
    const r = await getInsights({ period: "7d", timeZone: "America/New_York" });
    expect(r?.today).toBe("2026-11-13");

    for (const fn of [m.studyGroupBy, m.focusGroupBy, m.focusFindMany, m.usageFindMany]) {
      for (const [args] of fn.mock.calls) expect((args as Args).where.userId).toBe("user_1");
    }

    // Per day: the streak's 400 days, which hold both periods.
    expect(callBy(m.studyGroupBy, "localDate")).toMatchObject({
      by: ["localDate"],
      where: { userId: "user_1", localDate: { gte: "2025-10-09", lte: "2026-11-13" } },
    });
    // Focus per day: this period and the one before (14 days).
    expect(callBy(m.focusGroupBy, "localDate")).toEqual({
      by: ["localDate"],
      where: { userId: "user_1", localDate: { gte: "2026-10-31", lte: "2026-11-13" } },
      _sum: { seconds: true },
      _count: { _all: true },
    });
    // Per course: this period only.
    expect(callBy(m.studyGroupBy, "workspaceId").where).toEqual({
      userId: "user_1",
      localDate: { gte: "2026-11-07", lte: "2026-11-13" },
    });
    expect(callBy(m.focusGroupBy, "workspaceId").where).toEqual({
      userId: "user_1",
      localDate: { gte: "2026-11-07", lte: "2026-11-13" },
    });
    // Session starts: two columns, this period, capped.
    expect(m.focusFindMany).toHaveBeenCalledWith({
      where: { userId: "user_1", localDate: { gte: "2026-11-07", lte: "2026-11-13" } },
      select: { startedAt: true, seconds: true },
      orderBy: { startedAt: "desc" },
      take: MAX_FOCUS_STARTS,
    });
    expect(m.usageFindMany).toHaveBeenCalledWith({
      where: { userId: "user_1", kind: "evt:study_reviewed", createdAt: { gte: expect.any(Date) } },
      select: { createdAt: true },
    });
    // Names only for the student's own workspaces that are not in the trash.
    expect(m.workspaceFindMany).toHaveBeenCalledWith({
      where: { ownerId: "user_1", deletedAt: null, id: { in: ["ws_live", "ws_trashed"] } },
      select: { id: true, name: true, icon: true },
    });
  });

  it("turns the rows into the page's numbers, with unknown courses under Other", async () => {
    const r = await getInsights({ period: "7d", timeZone: "America/New_York" });
    // Active: the 12th (reviews, focus) and the 10th (quiz); the 9th had no answers.
    expect(r?.totals).toMatchObject({ cards: 10, focusMinutes: 30, activeDays: 2, recallRate: 0.75, quizAccuracy: 0.5 });
    expect(r?.courses.map((c) => [c.id, c.name, c.focusMinutes, c.cards])).toEqual([
      ["ws_live", "Biology", 20, 10],
      [null, null, 10, 3],
    ]);
    expect(r?.rhythm.sessions).toBe(2);
    // Study days: the 12th and 10th from StudyDay (the 9th had no answers), and
    // the legacy session on the 11th in New York: three days in a row to the 12th.
    expect(r?.streak.current).toBe(3);
  });

  it("reads days in the given zone, else the daily plan's, else UTC", async () => {
    m.config.mockResolvedValue({ timeZone: "Europe/Berlin" });
    const berlin = await getInsights({ period: "30d" });
    expect(berlin?.timeZone).toBe("Europe/Berlin");
    expect(berlin?.today).toBe("2026-11-14");
    expect(berlin?.period).toBe("30d");
    expect(callBy(m.studyGroupBy, "workspaceId").where).toMatchObject({ localDate: { gte: "2026-10-16", lte: "2026-11-14" } });

    m.config.mockResolvedValue({ timeZone: "Not/AZone" });
    const fallback = await getInsights({ period: "nonsense", timeZone: "also bad" });
    expect(fallback?.timeZone).toBe("UTC");
    expect(fallback?.today).toBe("2026-11-13");
    expect(fallback?.period).toBe("7d");
  });

  it("skips the workspace lookup when no course has activity", async () => {
    m.studyGroupBy.mockResolvedValue([]);
    m.focusGroupBy.mockResolvedValue([]);
    m.focusFindMany.mockResolvedValue([]);
    m.usageFindMany.mockResolvedValue([]);
    const r = await getInsights();
    expect(m.workspaceFindMany).not.toHaveBeenCalled();
    expect(r?.totals.activeDays).toBe(0);
    expect(r?.everStudied).toBe(false);
  });

  it("reports a failure and returns null instead of throwing", async () => {
    m.focusGroupBy.mockRejectedValue(new Error("db down"));
    expect(await getInsights({ period: "7d" })).toBeNull();
    expect(m.reportError).toHaveBeenCalledWith(expect.any(Error), { source: "insights", userId: "user_1" });
  });
});

describe("insightsZone", () => {
  it("prefers a valid zone without reading the plan", async () => {
    expect(await insightsZone("user_1", "Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(m.config).not.toHaveBeenCalled();
    m.config.mockResolvedValue({ timeZone: "Europe/Berlin" });
    expect(await insightsZone("user_1", "Mars/Base")).toBe("Europe/Berlin");
    expect(m.config).toHaveBeenCalledWith({ where: { userId: "user_1" }, select: { timeZone: true } });
  });

  it("falls back to the reminder settings' zone, and a stored UTC default never wins over a real zone", async () => {
    m.config.mockResolvedValue({ timeZone: "UTC" });
    m.reminders.mockResolvedValue({ timeZone: "America/New_York" });
    expect(await insightsZone("user_1")).toBe("America/New_York");
    m.config.mockResolvedValue(null);
    m.reminders.mockResolvedValue(null);
    expect(await insightsZone("user_1")).toBe("UTC");
  });
});

describe("loadPeriodTotals (no session: the weekly recap)", () => {
  it("reads only the given student's period, in two small grouped queries, without a signed-in user", async () => {
    m.userId = null;
    const r = await loadPeriodTotals("user_2", "7d", "2026-11-13");
    const week = { gte: "2026-11-07", lte: "2026-11-13" };
    expect(m.studyGroupBy).toHaveBeenCalledTimes(1);
    expect(m.studyGroupBy.mock.calls[0][0]).toMatchObject({ by: ["localDate"], where: { userId: "user_2", localDate: week } });
    expect(m.focusGroupBy).toHaveBeenCalledTimes(1);
    expect(m.focusGroupBy.mock.calls[0][0]).toEqual({
      by: ["localDate"],
      where: { userId: "user_2", localDate: week },
      _sum: { seconds: true },
      _count: { _all: true },
    });
    // No streak history, session starts, legacy events, courses or zone lookup.
    for (const fn of [m.focusFindMany, m.usageFindMany, m.workspaceFindMany, m.config]) expect(fn).not.toHaveBeenCalled();
    expect(r.window).toEqual({ from: "2026-11-07", to: "2026-11-13", days: 7 });
  });

  it("adds up the same numbers the insights page shows for those days", async () => {
    const { totals } = await loadPeriodTotals("user_1", "7d", "2026-11-13");
    // The 12th (reviews, focus) and the 10th (quiz) were active; the 9th had no answers.
    expect(totals).toMatchObject({ focusMinutes: 30, cards: 10, quizAnswers: 4, activeDays: 2 });
    const page = await getInsights({ period: "7d", timeZone: "America/New_York" });
    expect(page?.totals).toEqual(totals);
  });

  it("is zero for a week without study", async () => {
    m.studyGroupBy.mockResolvedValue([]);
    m.focusGroupBy.mockResolvedValue([]);
    const { totals } = await loadPeriodTotals("user_1", "7d", "2026-11-13");
    expect(totals).toMatchObject({ focusMinutes: 0, cards: 0, quizAnswers: 0, activeDays: 0 });
  });
});
