// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  referralCode: { count: vi.fn() },
  referral: { groupBy: vi.fn() },
  creditLedger: { aggregate: vi.fn(), groupBy: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: m }));

import { ACTIVITY_WINDOW_DAYS, formatBuildDelay, referralMetrics, TOP_REFERRERS_SHOWN } from "./metrics";

const NOW = new Date("2026-11-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
type Where = { createdAt?: { gte: Date }; status?: string; reason?: { in: string[] } };
const daysBefore = (where?: Where) => (where?.createdAt ? (NOW.getTime() - where.createdAt.gte.getTime()) / DAY : null);
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");

beforeEach(() => {
  m.referralCode.count.mockImplementation(async (args?: { where?: Where }) => (args?.where ? 12 : 40));
  m.creditLedger.aggregate.mockImplementation(async ({ where }: { where: Where }) => ({
    _sum: { delta: where.createdAt ? 900 : 4200 },
  }));
  // Ranked by the inviter bonuses in their own ledger.
  m.creditLedger.groupBy.mockResolvedValue([
    { userId: "user_b", _count: { userId: 7 } },
    { userId: "user_a", _count: { userId: 20 } },
  ]);
  // The evidence per inviter, as Postgres returns it (COUNT cast to int, the median a double).
  m.$queryRaw.mockResolvedValue([
    { referrerId: "user_a", rewarded: 31, deleted: 12, inactive: 17, medianToBuildSeconds: 95.5 },
    { referrerId: "user_b", rewarded: 7, deleted: 0, inactive: BigInt(1), medianToBuildSeconds: null },
  ]);
  m.referral.groupBy.mockImplementation(async ({ by, where }: { by: string[]; where: Where }) => {
    if (by.includes("referrerOutcome")) {
      return [
        { referrerOutcome: "granted", _count: { _all: 6 } },
        { referrerOutcome: "capped_total", _count: { _all: 3 } },
      ];
    }
    expect(daysBefore(where)).toBe(30);
    return [
      { status: "pending", rejectReason: null, _count: { _all: 4 } },
      { status: "rewarded", rejectReason: null, _count: { _all: 9 } },
      { status: "rejected", rejectReason: "self_referral", _count: { _all: 2 } },
      { status: "rejected", rejectReason: "account_not_new", _count: { _all: 5 } },
      { status: "rejected", rejectReason: "mailbox_reused", _count: { _all: 2 } },
    ];
  });
});

describe("the operator console's Referrals numbers", () => {
  it("codes made, referrals of the last 30 days by status and reason, credits granted, top inviters with their evidence", async () => {
    expect(await referralMetrics(NOW)).toEqual({
      codes: { total: 40, month: 12 },
      month: { pending: 4, rewarded: 9, rejected: 9 },
      rejectedBy: [
        { reason: "account_not_new", count: 5 },
        { reason: "mailbox_reused", count: 2 },
        { reason: "self_referral", count: 2 },
      ],
      inviterOutcomes: [
        { outcome: "granted", count: 6 },
        { outcome: "capped_total", count: 3 },
      ],
      credits: { month: 900, total: 4200 },
      topReferrers: [
        { userId: "user_a", granted: 20, rewarded: 31, deleted: 12, inactive: 17, medianToBuildSeconds: 95.5 },
        { userId: "user_b", granted: 7, rewarded: 7, deleted: 0, inactive: 1, medianToBuildSeconds: null },
      ],
    });
  });

  it("ranks inviters by their referral_referrer ledger rows (which outlive a friend's deletion), not by Referral rows", async () => {
    await referralMetrics(NOW);
    for (const [args] of m.creditLedger.aggregate.mock.calls) {
      expect(args.where.reason).toEqual({ in: ["referral_referee", "referral_referrer"] });
    }
    expect(m.creditLedger.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["userId"], where: { reason: "referral_referrer" }, take: TOP_REFERRERS_SHOWN }),
    );
    expect(m.referral.groupBy.mock.calls.some(([a]) => a.by.includes("referrerId"))).toBe(false);
    expect(TOP_REFERRERS_SHOWN).toBe(5);
  });

  it("reads the evidence for the top inviters only, in one aggregate query", async () => {
    await referralMetrics(NOW);
    expect(m.$queryRaw).toHaveBeenCalledTimes(1);
    const call = m.$queryRaw.mock.calls[0];
    const sql = sqlOf(call);
    expect(call.slice(1)).toContainEqual(["user_b", "user_a"]);
    expect(call.slice(1)).toContain(ACTIVITY_WINDOW_DAYS);
    expect(ACTIVITY_WINDOW_DAYS).toBe(7);
    // Friends since deleted are the anonymised rows.
    expect(sql).toContain(`r."refereeId" IS NULL`);
    // Inactive: no study day, no focus session in the window, no workspace edited since the reward.
    for (const table of ['"StudyDay"', '"FocusSession"', '"Workspace"']) expect(sql).toContain(table);
    expect(sql).toContain("percentile_cont(0.5)");
    expect(sql).toContain(`r."qualifiedAt" - r."createdAt"`);
    expect(sql).toContain("GROUP BY");
  });

  it("an inviter with no Referral rows left still ranks, with zeros", async () => {
    m.$queryRaw.mockResolvedValue([]);
    const { topReferrers } = await referralMetrics(NOW);
    expect(topReferrers[0]).toEqual({ userId: "user_a", granted: 20, rewarded: 0, deleted: 0, inactive: 0, medianToBuildSeconds: null });
  });

  it("reads zero when nothing happened, without the evidence query", async () => {
    m.referralCode.count.mockResolvedValue(0);
    m.creditLedger.aggregate.mockResolvedValue({ _sum: { delta: null } });
    m.creditLedger.groupBy.mockResolvedValue([]);
    m.referral.groupBy.mockResolvedValue([]);
    expect(await referralMetrics(NOW)).toEqual({
      codes: { total: 0, month: 0 },
      month: { pending: 0, rewarded: 0, rejected: 0 },
      rejectedBy: [],
      inviterOutcomes: [],
      credits: { month: 0, total: 0 },
      topReferrers: [],
    });
    expect(m.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("formatBuildDelay", () => {
  it("says a median link-to-build time in the unit that reads best", () => {
    expect(formatBuildDelay(null)).toBe("–");
    expect(formatBuildDelay(42)).toBe("42 s");
    expect(formatBuildDelay(12 * 60)).toBe("12 min");
    expect(formatBuildDelay(3.5 * 3600)).toBe("3.5 h");
    expect(formatBuildDelay(2.1 * 86_400)).toBe("2.1 d");
    expect(formatBuildDelay(Number.NaN)).toBe("–");
  });
});
