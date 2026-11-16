// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ $queryRaw: vi.fn(), reportError: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: m.$queryRaw } }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: m.reportError }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));

import {
  activationMetrics,
  cohortWeekStarts,
  funnelCounts,
  funnelSteps,
  rateText,
  retentionShare,
  shapeCohorts,
  share,
  shareText,
  utcWeekStart,
  windowPassed,
  type CohortQueryRow,
} from "./activation-metrics";

// A Friday afternoon: the current cohort week began Monday 9 November 2026.
const NOW = new Date("2026-11-13T15:30:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (date: Date) => date.toISOString().slice(0, 10);

const row = (week: string, counts: Partial<Omit<CohortQueryRow, "week">> = {}): CohortQueryRow => ({
  week: new Date(`${week}T00:00:00Z`),
  signups: 0,
  built: 0,
  studied: 0,
  week1: 0,
  week2: 0,
  pro: 0,
  funnelSignedUp: 0,
  funnelBuilt: 0,
  funnelStudied: 0,
  funnelReturned: 0,
  funnelPro: 0,
  ...counts,
});

beforeEach(() => {
  m.$queryRaw.mockReset();
  m.reportError.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("week bucketing", () => {
  it("starts every week on Monday 00:00 UTC", () => {
    expect(utcWeekStart(new Date("2026-11-09T00:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(utcWeekStart(NOW).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    // Sunday night is still the week that began on the Monday before.
    expect(utcWeekStart(new Date("2026-11-15T23:59:59.999Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    // One millisecond before Monday belongs to the previous week.
    expect(utcWeekStart(new Date("2026-11-08T23:59:59.999Z")).toISOString()).toBe("2026-11-02T00:00:00.000Z");
    // Across a year boundary (1 January 2027 is a Friday).
    expect(utcWeekStart(new Date("2027-01-01T08:00:00Z")).toISOString()).toBe("2026-12-28T00:00:00.000Z");
  });

  it("lists the current week and the seven before it, newest first", () => {
    expect(cohortWeekStarts(NOW).map(iso)).toEqual([
      "2026-11-09",
      "2026-11-02",
      "2026-10-26",
      "2026-10-19",
      "2026-10-12",
      "2026-10-05",
      "2026-09-28",
      "2026-09-21",
    ]);
  });
});

describe("percent cells", () => {
  it("divides, with no rate when there is nobody to count", () => {
    expect(share(2, 5)).toEqual({ count: 2, rate: 0.4 });
    expect(share(0, 0)).toEqual({ count: 0, rate: null });
  });

  it("counts a window as passed only once the cohort's last signup has had all of it", () => {
    const week = new Date("2026-10-19T00:00:00Z");
    // Week 1 ends 14 days after signup; the last signup of that week was just before 26 October.
    expect(windowPassed(week, 14, new Date("2026-11-08T23:59:59Z"))).toBe(false);
    expect(windowPassed(week, 14, new Date("2026-11-09T00:00:00Z"))).toBe(true);
    expect(windowPassed(week, 21, new Date("2026-11-09T00:00:00Z"))).toBe(false);
    expect(windowPassed(week, 21, new Date("2026-11-16T00:00:00Z"))).toBe(true);
  });

  it("leaves a retention cell blank (null), not 0%, until its window has passed", () => {
    const week = new Date("2026-11-02T00:00:00Z");
    expect(retentionShare(0, 4, week, 14, NOW)).toBeNull();
    expect(shareText(retentionShare(0, 4, week, 14, NOW))).toBe("");
    expect(retentionShare(1, 4, week, 14, new Date(week.getTime() + 21 * DAY))).toEqual({ count: 1, rate: 0.25 });
  });

  it("prints whole percents, a dash for nothing to divide by, and never a false 0% or 100%", () => {
    expect(shareText(null)).toBe("");
    expect(shareText({ count: 0, rate: null })).toBe("–");
    expect(shareText({ count: 0, rate: 0 })).toBe("0%");
    expect(rateText(1 / 3)).toBe("33%");
    expect(rateText(2 / 3)).toBe("67%");
    expect(rateText(1)).toBe("100%");
    expect(rateText(1 / 400)).toBe("<1%");
    expect(rateText(399 / 400)).toBe(">99%");
    expect(rateText(null)).toBe("–");
  });
});

describe("shapeCohorts", () => {
  it("fills all eight weeks newest first, with zero weeks and blank open windows", () => {
    const rows = [
      row("2026-11-09", { signups: 4, built: 3, studied: 1, week1: 0, week2: 0, pro: 0 }),
      row("2026-10-19", { signups: 5, built: 4, studied: 3, week1: 2, week2: 1, pro: 1 }),
      row("2026-09-21", { signups: 10, built: 8, studied: 6, week1: 5, week2: 4, pro: 2 }),
    ];
    const cohorts = shapeCohorts(rows, NOW);
    expect(cohorts.map((c) => [iso(c.weekStart), c.signups, c.current])).toEqual([
      ["2026-11-09", 4, true],
      ["2026-11-02", 0, false],
      ["2026-10-26", 0, false],
      ["2026-10-19", 5, false],
      ["2026-10-12", 0, false],
      ["2026-10-05", 0, false],
      ["2026-09-28", 0, false],
      ["2026-09-21", 10, false],
    ]);
    const [current, , , oct19, , , , sep21] = cohorts;
    expect(current.built).toEqual({ count: 3, rate: 0.75 });
    // The current week: neither window has passed for anyone yet.
    expect(current.week1).toBeNull();
    expect(current.week2).toBeNull();
    // 19 October: week 1 (to day 14) passed on 9 November, week 2 (to day 21) not until the 16th.
    expect(oct19.week1).toEqual({ count: 2, rate: 0.4 });
    expect(oct19.week2).toBeNull();
    expect(oct19.pro).toEqual({ count: 1, rate: 0.2 });
    expect(sep21.week2).toEqual({ count: 4, rate: 0.4 });
    // A week nobody signed up in: zero signups, no rate (a dash), still blank where the window is open.
    expect(cohorts[1]).toMatchObject({ signups: 0, built: { count: 0, rate: null }, week1: null });
    expect(cohorts[4].week2).toEqual({ count: 0, rate: null });
  });
});

describe("funnel", () => {
  it("sums the weeks and rates each step against the one before and against signups", () => {
    const counts = funnelCounts([
      row("2026-11-09", { funnelSignedUp: 6, funnelBuilt: 4, funnelStudied: 2, funnelReturned: 1, funnelPro: 0 }),
      row("2026-11-02", { funnelSignedUp: 4, funnelBuilt: 4, funnelStudied: 2, funnelReturned: 1, funnelPro: 1 }),
    ]);
    expect(counts).toEqual({ signedUp: 10, built: 8, studied: 4, returned: 2, pro: 1 });
    expect(funnelSteps(counts)).toEqual([
      { key: "signedUp", count: 10, fromPrevious: null, ofSignups: 1 },
      { key: "built", count: 8, fromPrevious: 0.8, ofSignups: 0.8 },
      { key: "studied", count: 4, fromPrevious: 0.5, ofSignups: 0.4 },
      { key: "returned", count: 2, fromPrevious: 0.5, ofSignups: 0.2 },
      { key: "pro", count: 1, fromPrevious: 0.5, ofSignups: 0.1 },
    ]);
  });

  it("has no rates where the step before is empty", () => {
    const steps = funnelSteps({ signedUp: 3, built: 0, studied: 0, returned: 0, pro: 0 });
    expect(steps.map((s) => s.fromPrevious)).toEqual([null, 0, null, null, null]);
    expect(funnelSteps({ signedUp: 0, built: 0, studied: 0, returned: 0, pro: 0 }).every((s) => s.ofSignups === null)).toBe(
      true,
    );
  });
});

describe("activationMetrics", () => {
  it("runs one aggregate query over the recent signups and shapes it", async () => {
    m.$queryRaw.mockResolvedValue([
      row("2026-11-09", { signups: 2, built: 1, funnelSignedUp: 2, funnelBuilt: 1 }),
      row("2026-10-12", { signups: 3, built: 3, studied: 2, week1: 1, week2: 1, pro: 1 }),
    ]);
    const result = await activationMetrics(NOW, ["user_op"]);
    expect(m.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result?.cohorts).toHaveLength(8);
    expect(result?.cohorts[0]).toMatchObject({ signups: 2, built: { count: 1, rate: 0.5 } });
    expect(result?.cohorts[4]).toMatchObject({ signups: 3, week1: { count: 1, rate: 1 / 3 } });
    expect(result?.funnel.map((s) => s.count)).toEqual([2, 1, 0, 0, 0]);

    const [strings, ...values] = m.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join("?");
    for (const table of ['"CreditAccount"', '"Workspace"', '"StudyDay"', '"FocusSession"', '"CreditLedger"', '"UsageEvent"', '"Subscription"']) {
      expect(sql).toContain(table);
    }
    // Exclusions: the 'local' owner, operator adjustments and the operators' accounts.
    expect(sql).toContain(`a."userId" <> 'local'`);
    expect(sql).toContain(`l."reason" <> 'admin_adjust'`);
    expect(sql).toContain(`NOT (a."userId" = ANY(?::text[]))`);
    expect(values).toContainEqual(["user_op"]);
    // Bounded: signups since the oldest cohort Monday; the funnel from 30 days back.
    const dates = values.filter((v): v is Date => v instanceof Date).map((d) => d.toISOString());
    expect(dates).toEqual(["2026-09-21T00:00:00.000Z", new Date(NOW.getTime() - 30 * DAY).toISOString()]);
    // Each student's flags are worked out once, not once per COUNT(*) FILTER.
    expect(sql).toContain("flags AS MATERIALIZED");
    expect(sql).toContain("date_trunc('week', b.at)");
    // Only tagged-template parameters: no value is spliced into the SQL text.
    expect(sql).not.toContain("user_op");
  });

  it("leaves out the operators listed in STUDYOS_ADMIN_USER_IDS by default", async () => {
    vi.stubEnv("STUDYOS_ADMIN_USER_IDS", "user_a, user_b");
    m.$queryRaw.mockResolvedValue([]);
    await activationMetrics(NOW);
    const [, ...values] = m.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(values).toContainEqual(["user_a", "user_b"]);
  });

  it("reads all zeros with no signups", async () => {
    m.$queryRaw.mockResolvedValue([]);
    const result = await activationMetrics(NOW, []);
    expect(result?.cohorts.every((c) => c.signups === 0 && c.built.rate === null)).toBe(true);
    expect(result?.funnel.map((s) => s.count)).toEqual([0, 0, 0, 0, 0]);
  });

  it("reports a failure and returns null so the rest of the console still loads", async () => {
    m.$queryRaw.mockRejectedValue(new Error("db down"));
    expect(await activationMetrics(NOW, [])).toBeNull();
    expect(m.reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: "admin" }));
  });
});
