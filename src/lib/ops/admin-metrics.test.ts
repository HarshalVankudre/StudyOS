// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    creditAccount: { count: fn() },
    subscription: { groupBy: fn() },
    billingEvent: { groupBy: fn() },
    creditLedger: { count: fn(), groupBy: fn() },
    usageEvent: { count: fn() },
    agentRun: { groupBy: fn(), findMany: fn() },
    workspace: { count: fn() },
    feedback: { findMany: fn(), groupBy: fn() },
    $queryRaw: fn(),
    getUserList: fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: m }));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { getUserList: m.getUserList } }),
}));

import {
  accountMetrics,
  activeStudents,
  aiUsageMetrics,
  contactEmails,
  contentMetrics,
  creditsSpentSince,
  feedbackInbox,
  parseInboxFilter,
  revenueMetrics,
  spendAction,
  truncate,
} from "./admin-metrics";

const NOW = new Date("2026-11-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysBefore = (date: Date | undefined) => (NOW.getTime() - (date?.getTime() ?? NOW.getTime())) / DAY;

beforeEach(() => {
  for (const delegate of Object.values(m)) {
    if (typeof delegate === "function") delegate.mockReset();
    else for (const f of Object.values(delegate)) (f as ReturnType<typeof vi.fn>).mockReset();
  }
});

describe("accounts", () => {
  it("counts all accounts, new ones per window and active students", async () => {
    m.creditAccount.count.mockImplementation(async (args?: { where?: { createdAt: { gte: Date } } }) => {
      if (!args) return 120;
      const days = daysBefore(args.where?.createdAt.gte);
      return days === 1 ? 3 : days === 7 ? 15 : 40;
    });
    m.$queryRaw.mockResolvedValue([{ week: BigInt(22), month: BigInt(61) }]);
    expect(await accountMetrics(NOW)).toEqual({
      total: 120,
      new: { day: 3, week: 15, month: 40 },
      active: { week: 22, month: 61 },
    });
  });

  it("counts active students in one query over workspaces, study days, focus sessions, AI charges and app events", async () => {
    m.$queryRaw.mockResolvedValue([{ week: 2, month: 5 }]);
    expect(await activeStudents(NOW)).toEqual({ week: 2, month: 5 });
    expect(m.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = m.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...Date[]];
    const sql = strings.join("?");
    for (const table of ['"Workspace"', '"StudyDay"', '"FocusSession"', '"CreditLedger"', '"UsageEvent"']) expect(sql).toContain(table);
    expect(sql).toContain("COUNT(DISTINCT");
    // An operator's deduction (Support tools) is not the student being active.
    expect(sql).toContain(`"reason" <> 'admin_adjust'`);
    // Bounded by the 30-day window, never the whole table.
    expect(values.map(daysBefore).sort((a, b) => a - b)).toEqual([7, 30, 30, 30, 30, 30]);
  });

  it("reads zero when there is no activity", async () => {
    m.$queryRaw.mockResolvedValue([]);
    expect(await activeStudents(NOW)).toEqual({ week: 0, month: 0 });
  });
});

describe("revenue", () => {
  it("groups subscriptions by status, billing events by kind and counts packs sold", async () => {
    m.subscription.groupBy.mockResolvedValue([
      { status: "canceled", _count: { _all: 2 } },
      { status: "active", _count: { _all: 9 } },
    ]);
    m.billingEvent.groupBy.mockResolvedValue([
      { kind: "refund", _count: { _all: 1 }, _sum: { amountCents: 799 } },
      { kind: "pro_month", _count: { _all: 9 }, _sum: { amountCents: 7191 } },
      { kind: "dispute", _count: { _all: 1 }, _sum: { amountCents: null } },
    ]);
    m.creditLedger.count.mockImplementation(async ({ where }: { where: { createdAt?: { gte: Date } } }) =>
      where.createdAt ? 4 : 11,
    );
    const revenue = await revenueMetrics(NOW);
    expect(revenue.subscriptions).toEqual([
      { status: "active", count: 9 },
      { status: "canceled", count: 2 },
    ]);
    expect(revenue.billingEvents).toEqual([
      { kind: "pro_month", count: 9, amountCents: 7191 },
      { kind: "refund", count: 1, amountCents: 799 },
      { kind: "dispute", count: 1, amountCents: 0 },
    ]);
    expect(revenue.packsSold).toEqual({ month: 4, total: 11 });
    expect(daysBefore(m.billingEvent.groupBy.mock.calls[0][0].where.createdAt.gte)).toBe(30);
    for (const [query] of m.creditLedger.count.mock.calls) expect(query.where.reason).toBe("credit_purchase");
  });
});

describe("AI usage", () => {
  it("maps ledger reasons to the action they pay for, and leaves grants out", () => {
    expect(spendAction("generate_hold")).toBe("generate");
    expect(spendAction("generate_release")).toBe("generate");
    expect(spendAction("generate_cancelled")).toBe("generate");
    expect(spendAction("agent_failed")).toBe("agent");
    expect(spendAction("study_kit")).toBe("study_kit");
    expect(spendAction("sandbox_run_hold")).toBe("sandbox_run");
    for (const grant of ["free_signup", "pro_monthly", "credit_purchase", "credit_reversal", "credit_reversal_restored", "admin_adjust"]) {
      expect(spendAction(grant)).toBeNull();
    }
  });

  it("never counts invite bonuses (referral_*) as credits spent", async () => {
    for (const reason of ["referral_referee", "referral_referrer", "referral_anything_later"]) {
      expect(spendAction(reason), reason).toBeNull();
    }
    m.creditLedger.groupBy.mockResolvedValue([
      { reason: "generate_hold", _sum: { delta: -30 } },
      { reason: "referral_referee", _sum: { delta: 400 } },
      { reason: "referral_referrer", _sum: { delta: 300 } },
    ]);
    expect(await creditsSpentSince(new Date(0))).toEqual({ total: 30, byAction: [{ action: "generate", credits: 30 }] });
  });

  it("nets holds against what was given back, per action", async () => {
    m.creditLedger.groupBy.mockResolvedValue([
      { reason: "generate_hold", _sum: { delta: -300 } },
      { reason: "generate", _sum: { delta: 40 } }, // a cheaper settle returned 40
      { reason: "generate_release", _sum: { delta: 100 } }, // one failed build given back
      { reason: "agent_hold", _sum: { delta: -50 } },
      { reason: "free_signup", _sum: { delta: 500 } },
      { reason: "study_kit_hold", _sum: { delta: -20 } },
      { reason: "study_kit_release", _sum: { delta: 20 } },
      // An operator's deduction (Support tools) is not AI spending.
      { reason: "admin_adjust", _sum: { delta: -700 } },
    ]);
    expect(await creditsSpentSince(new Date(0))).toEqual({
      total: 210,
      byAction: [
        { action: "generate", credits: 160 },
        { action: "agent", credits: 50 },
      ],
    });
  });

  it("reports spend per window, builds, kits, agent runs and recent failures", async () => {
    m.creditLedger.groupBy.mockImplementation(async ({ where }: { where: { createdAt: { gte: Date } } }) => {
      const days = daysBefore(where.createdAt.gte);
      return [{ reason: "agent_hold", _sum: { delta: days === 1 ? -5 : days === 7 ? -30 : -100 } }];
    });
    m.usageEvent.count.mockImplementation(async ({ where }: { where: { kind: string; createdAt: { gte: Date } } }) => {
      const days = daysBefore(where.createdAt.gte);
      const base = where.kind === "evt:generate_complete" ? 1 : 0;
      return base + (days === 1 ? 1 : days === 7 ? 5 : 12);
    });
    m.agentRun.groupBy.mockResolvedValue([
      { status: "completed", _count: { _all: 18 } },
      { status: "failed", _count: { _all: 2 } },
      { status: "running", _count: { _all: 1 } },
    ]);
    m.agentRun.findMany.mockResolvedValue([
      { id: "r1", agentKey: "daily-study", trigger: "schedule", error: "x".repeat(500), startedAt: NOW },
      { id: "r2", agentKey: "daily-study", trigger: "manual", error: null, startedAt: NOW },
    ]);
    const ai = await aiUsageMetrics(NOW);
    expect(ai.creditsSpent.day.total).toBe(5);
    expect(ai.creditsSpent.week.total).toBe(30);
    expect(ai.creditsSpent.month.total).toBe(100);
    expect(ai.workspacesBuilt).toEqual({ day: 2, week: 6, month: 13 });
    expect(ai.studyKits).toEqual({ day: 1, week: 5, month: 12 });
    expect(ai.agentRuns).toEqual({ total: 21, completed: 18, failed: 2, running: 1, failureRate: 0.1 });
    expect(ai.recentFailures[0].error).toHaveLength(240);
    expect(ai.recentFailures[0].error.endsWith("…")).toBe(true);
    expect(ai.recentFailures[1].error).toBe("(no error text)");
    // Failed runs: newest first, bounded.
    const query = m.agentRun.findMany.mock.calls[0][0];
    expect(query).toMatchObject({ where: { status: "failed" }, orderBy: { startedAt: "desc" }, take: 8 });
    expect(daysBefore(query.where.startedAt.gte)).toBe(30);
  });

  it("has no failure rate before any run finished", async () => {
    m.creditLedger.groupBy.mockResolvedValue([]);
    m.usageEvent.count.mockResolvedValue(0);
    m.agentRun.groupBy.mockResolvedValue([{ status: "running", _count: { _all: 1 } }]);
    m.agentRun.findMany.mockResolvedValue([]);
    expect((await aiUsageMetrics(NOW)).agentRuns.failureRate).toBeNull();
  });
});

describe("content", () => {
  it("counts workspaces, new ones this week and the trash", async () => {
    m.workspace.count.mockImplementation(async (args?: { where: Record<string, unknown> }) => {
      if (!args) return 300;
      if ("deletedAt" in args.where) return 7;
      return 25;
    });
    expect(await contentMetrics(NOW)).toEqual({ total: 300, createdWeek: 25, inTrash: 7 });
    const week = m.workspace.count.mock.calls.find(([a]) => a?.where?.createdAt)?.[0];
    expect(daysBefore(week.where.createdAt.gte)).toBe(7);
  });
});

describe("feedback inbox", () => {
  const rows = [
    { id: "f2", userId: "user_b", kind: "bug", message: "Crash", pagePath: "/app", locale: "en", contactOk: true, status: "new", createdAt: NOW },
    { id: "f1", userId: "user_a", kind: "idea", message: "More themes", pagePath: null, locale: "de", contactOk: false, status: "new", createdAt: NOW },
  ];

  beforeEach(() => {
    m.feedback.findMany.mockResolvedValue(rows);
    m.feedback.groupBy.mockResolvedValue([
      { status: "new", _count: { _all: 2 } },
      { status: "done", _count: { _all: 5 } },
    ]);
  });

  it("lists the newest messages for a status, with counts per status", async () => {
    m.getUserList.mockResolvedValue({
      data: [{ id: "user_b", primaryEmailAddress: { emailAddress: "b@uni.edu" }, emailAddresses: [] }],
    });
    const inbox = await feedbackInbox("new");
    expect(m.feedback.findMany.mock.calls[0][0]).toMatchObject({
      where: { status: "new" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    expect(inbox.counts).toEqual({ all: 7, new: 2, read: 0, done: 5 });
    expect(inbox.items.map((i) => [i.id, i.email])).toEqual([
      ["f2", "b@uni.edu"],
      ["f1", null],
    ]);
  });

  it("looks up addresses only for students who agreed to be contacted, in one call", async () => {
    m.getUserList.mockResolvedValue({ data: [] });
    await feedbackInbox("all");
    expect(m.feedback.findMany.mock.calls[0][0].where).toEqual({});
    expect(m.getUserList).toHaveBeenCalledTimes(1);
    expect(m.getUserList).toHaveBeenCalledWith({ userId: ["user_b"], limit: 1 });
  });

  it("still loads when Clerk fails (the console shows the user id instead)", async () => {
    m.getUserList.mockRejectedValue(new Error("clerk down"));
    const inbox = await feedbackInbox("new");
    expect(inbox.items.map((i) => i.email)).toEqual([null, null]);
  });

  it("does not call Clerk when nobody asked to be contacted", async () => {
    expect(await contactEmails([])).toEqual(new Map());
    expect(m.getUserList).not.toHaveBeenCalled();
  });

  it("parses the filter from the query string, defaulting to new", () => {
    expect(parseInboxFilter("done")).toBe("done");
    expect(parseInboxFilter("all")).toBe("all");
    expect(parseInboxFilter(["read", "done"])).toBe("read");
    expect(parseInboxFilter("deleted")).toBe("new");
    expect(parseInboxFilter(undefined)).toBe("new");
  });
});

describe("truncate", () => {
  it("keeps short text and shortens long text with an ellipsis", () => {
    expect(truncate("  short  ", 10)).toBe("short");
    expect(truncate("abcdefghijk", 5)).toBe("abcd…");
    expect(truncate(null, 5)).toBe("");
  });
});
