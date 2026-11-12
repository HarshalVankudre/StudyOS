import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    workspace: { findMany: fn(), deleteMany: fn() },
    workspaceChange: { deleteMany: fn() },
    agentTask: { deleteMany: fn() },
    dailyStudyPlan: { findMany: fn(), deleteMany: fn() },
    dailyStudyAgentConfig: { findUnique: fn(), deleteMany: fn() },
    agentRun: { findMany: fn(), deleteMany: fn() },
    usageEvent: { findMany: fn(), deleteMany: fn(), count: fn(), create: fn() },
    creditAccount: { findUnique: fn(), deleteMany: fn() },
    creditLedger: { findMany: fn(), deleteMany: fn() },
    subscription: { findUnique: fn(), deleteMany: fn() },
    asset: { findMany: fn(), deleteMany: fn() },
    calendarToken: { findUnique: fn(), deleteMany: fn() },
    studyDay: { findMany: fn(), deleteMany: fn() },
    $transaction: vi.fn(),
    storeDelete: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: m }));
vi.mock("@/lib/assets/storage", () => ({ gcsAssetStore: () => ({ delete: m.storeDelete }) }));

import { allowDataExport, buildUserDataExport, EXPORT_LIMIT } from "./export-user-data";
import { eraseUserData } from "./erase-user-data";

beforeEach(() => {
  m.workspace.findMany.mockResolvedValue([
    { id: "w1", name: "Fall", icon: null, data: '{"name":"Fall","pages":[]}', version: 3, createdAt: new Date(0), updatedAt: new Date(0) },
  ]);
  m.dailyStudyPlan.findMany.mockResolvedValue([{ localDate: "2026-11-11", timeZone: "UTC", summary: "s", items: "[]", generatedAt: new Date(0) }]);
  m.dailyStudyAgentConfig.findUnique.mockResolvedValue(null);
  m.agentRun.findMany.mockResolvedValue([]);
  m.usageEvent.findMany.mockResolvedValue([]);
  m.creditAccount.findUnique.mockResolvedValue({ balance: 120, createdAt: new Date(0), updatedAt: new Date(0) });
  m.creditLedger.findMany.mockResolvedValue([{ delta: 200, reason: "signup", createdAt: new Date(0) }]);
  m.subscription.findUnique.mockResolvedValue({ status: "active", currentPeriodEnd: null, stripeCustomerId: "cus_secret", stripeSubscriptionId: "sub_1", updatedAt: new Date(0) });
  m.asset.findMany.mockResolvedValue([]);
  m.studyDay.findMany.mockResolvedValue([{ workspaceId: "w1", localDate: "2026-11-11", reviews: 12 }]);
  m.calendarToken.findUnique.mockResolvedValue({ createdAt: new Date(0) });
});

describe("buildUserDataExport", () => {
  it("bundles workspaces, study records, plans, credits and subscription status", async () => {
    const data = await buildUserDataExport("user_1", { email: "s@uni.edu" }, new Date("2026-11-12T00:00:00Z"));
    expect(data.workspaces[0].data).toEqual({ name: "Fall", pages: [] });
    expect(data.study.dailyPlans[0].items).toEqual([]);
    expect(data.credits.balance).toBe(120);
    expect(data.study.reviewsPerDay).toEqual([{ workspaceId: "w1", localDate: "2026-11-11", reviews: 12 }]);
    expect(data.credits.ledger).toHaveLength(1);
    expect(data.subscription.status).toBe("active");
    expect(data.account).toEqual({ userId: "user_1", email: "s@uni.edu", name: null });
    expect(data.exportedAt).toBe("2026-11-12T00:00:00.000Z");
    // Every query is scoped to the user.
    expect(m.workspace.findMany.mock.calls[0][0].where).toEqual({ ownerId: "user_1" });
    expect(m.creditLedger.findMany.mock.calls[0][0].where).toEqual({ userId: "user_1" });
  });

  it("never includes credentials (calendar token value, Stripe ids)", async () => {
    const json = JSON.stringify(await buildUserDataExport("user_1"));
    expect(json).not.toContain("cus_secret");
    expect(json).not.toContain("sub_1");
    expect(m.calendarToken.findUnique.mock.calls[0][0].select).toEqual({ createdAt: true });
  });
});

describe("allowDataExport", () => {
  it("records an export under the limit and refuses past it", async () => {
    m.usageEvent.count.mockResolvedValue(0);
    m.usageEvent.create.mockResolvedValue({});
    expect(await allowDataExport("user_1")).toBe(true);
    expect(m.usageEvent.create).toHaveBeenCalledWith({ data: { userId: "user_1", kind: "data_export" } });
    m.usageEvent.count.mockResolvedValue(EXPORT_LIMIT.max);
    expect(await allowDataExport("user_1")).toBe(false);
  });
});

describe("eraseUserData", () => {
  it("removes asset bytes and every owned row in one transaction", async () => {
    m.asset.findMany.mockResolvedValue([{ storageKey: "k1" }, { storageKey: "k2" }]);
    await eraseUserData("user_1");
    expect(m.storeDelete).toHaveBeenCalledTimes(2);
    expect(m.$transaction).toHaveBeenCalledTimes(1);
    expect(m.$transaction.mock.calls[0][0]).toHaveLength(13);
    expect(m.studyDay.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.workspace.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "user_1" } });
    expect(m.subscription.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
  });
});
