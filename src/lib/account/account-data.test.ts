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
    creditHold: { findMany: fn(), deleteMany: fn() },
    billingEvent: { findMany: fn() },
    billingIntent: { findMany: fn() },
    subscription: { findUnique: fn(), deleteMany: fn() },
    asset: { findMany: fn(), deleteMany: fn() },
    calendarToken: { findUnique: fn(), deleteMany: fn() },
    calendarFeed: { findMany: fn(), deleteMany: fn() },
    studyMaterial: { findMany: fn(), deleteMany: fn() },
    agentChatMessage: { findMany: fn(), deleteMany: fn() },
    studyDay: { findMany: fn(), deleteMany: fn() },
    notificationPreference: { findUnique: fn(), deleteMany: fn() },
    pushSubscription: { findMany: fn(), deleteMany: fn() },
    notificationLog: { findMany: fn(), deleteMany: fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    storeDelete: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: m }));
vi.mock("@/lib/assets/storage", () => ({ gcsAssetStore: () => ({ delete: m.storeDelete }) }));

import {
  allowDataExport,
  buildUserDataExport,
  EXPORT_CHAT_BATCH,
  EXPORT_LIMIT,
  EXPORT_WORKSPACE_BATCH,
  streamUserDataExport,
} from "./export-user-data";
import { eraseUserData, retryOrphanedAssetDeletes } from "./erase-user-data";

beforeEach(() => {
  m.workspace.findMany.mockResolvedValue([
    { id: "w1", name: "Fall", icon: null, data: '{"name":"Fall","pages":[]}', version: 3, createdAt: new Date(0), updatedAt: new Date(0) },
  ]);
  m.dailyStudyPlan.findMany.mockResolvedValue([
    {
      localDate: "2026-11-11", timeZone: "UTC", summary: "s", items: "[]", version: 2,
      details: '{"workload":{"minutes":90}}', generatedAt: new Date(0),
    },
  ]);
  m.creditHold.findMany.mockResolvedValue([{ amount: 9, reason: "study_kit", state: "settled", charged: 7, createdAt: new Date(0) }]);
  m.billingEvent.findMany.mockResolvedValue([{ kind: "refund", amountCents: 500, credits: 500, createdAt: new Date(0) }]);
  m.billingIntent.findMany.mockResolvedValue([]);
  m.dailyStudyAgentConfig.findUnique.mockResolvedValue(null);
  m.agentRun.findMany.mockResolvedValue([]);
  m.usageEvent.findMany.mockResolvedValue([]);
  m.creditAccount.findUnique.mockResolvedValue({ balance: 120, createdAt: new Date(0), updatedAt: new Date(0) });
  m.creditLedger.findMany.mockResolvedValue([{ delta: 200, reason: "signup", createdAt: new Date(0) }]);
  m.subscription.findUnique.mockResolvedValue({ status: "active", currentPeriodEnd: null, stripeCustomerId: "cus_secret", stripeSubscriptionId: "sub_1", updatedAt: new Date(0) });
  m.asset.findMany.mockResolvedValue([]);
  m.studyDay.findMany.mockResolvedValue([{ workspaceId: "w1", localDate: "2026-11-11", reviews: 12 }]);
  m.calendarToken.findUnique.mockResolvedValue({ createdAt: new Date(0) });
  m.studyMaterial.findMany.mockResolvedValue([
    { id: "mat1", workspaceId: "w1", title: "Lecture 3", kind: "pdf", pages: '["Page one text"]', createdAt: new Date(0) },
  ]);
  // Served the way Prisma would: ids when listing, rows for a page of ids.
  const chat = [{ id: "c1", workspaceId: "w1", role: "user", content: "add a quiz friday", createdAt: new Date(0) }];
  m.agentChatMessage.findMany.mockImplementation(async (query: { where: { id?: { in: string[] } } }) => {
    const ids = query.where.id?.in;
    return ids ? chat.filter((c) => ids.includes(c.id)) : chat.map((c) => ({ id: c.id }));
  });
  m.notificationPreference.findUnique.mockResolvedValue({
    timeZone: "Europe/Berlin", locale: "de", dailyEnabled: true, dailyMinute: 480, deadlineEnabled: true,
    deadlineMinute: 1080, deadlineLeads: "[7,2,1]", examLeads: "[14,7,2,1]", streakEnabled: false,
    quietEnabled: true, quietStart: 1320, quietEnd: 420, createdAt: new Date(0), updatedAt: new Date(0),
  });
  m.pushSubscription.findMany.mockResolvedValue([{ label: "iPhone", lastSuccessAt: null, createdAt: new Date(0) }]);
  m.notificationLog.findMany.mockResolvedValue([
    { kind: "daily", localDate: "2026-11-11", status: "sent", message: true, createdAt: new Date(0), sentAt: new Date(0) },
  ]);
  m.calendarFeed.findMany.mockResolvedValue([
    { workspaceId: "w1", databaseId: "d1", label: "canvas.uni.edu", platform: "canvas", settings: '{"series":[]}', lastSyncedAt: null, lastSummary: null, createdAt: new Date(0) },
  ]);
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

  it("exports connected calendar feeds by host, never their secret link", async () => {
    const data = await buildUserDataExport("user_1");
    expect(data.importedCalendars).toEqual([
      expect.objectContaining({ label: "canvas.uni.edu", platform: "canvas", settings: { series: [] } }),
    ]);
    const select = m.calendarFeed.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("urlSealed");
    expect(select).not.toHaveProperty("urlHash");
    expect(m.calendarFeed.findMany.mock.calls[0][0].where).toEqual({ userId: "user_1" });
  });
});

it("exports the student's uploaded study material with its page text", async () => {
  const data = await buildUserDataExport("user_1");
  expect(data.studyMaterials).toEqual([
    expect.objectContaining({ id: "mat1", title: "Lecture 3", pages: ["Page one text"] }),
  ]);
  expect(m.studyMaterial.findMany.mock.calls[0][0].where).toEqual({ ownerId: "user_1" });
});

it("exports the agent conversations, owner-scoped, without internal notes", async () => {
  const data = await buildUserDataExport("user_1");
  expect(data.agentConversations).toEqual([
    expect.objectContaining({ workspaceId: "w1", role: "user", content: "add a quiz friday" }),
  ]);
  for (const [query] of m.agentChatMessage.findMany.mock.calls) {
    expect(query.where.userId).toBe("user_1");
    expect(query.select).not.toHaveProperty("changeNote");
    expect(query.select).not.toHaveProperty("modelContent");
  }
});

it("streams agent messages in pages of ids, never in one query", async () => {
  const many = Array.from({ length: EXPORT_CHAT_BATCH * 2 + 5 }, (_, i) => ({
    id: `c${i}`, workspaceId: "w1", role: i % 2 ? "assistant" : "user", content: `message ${i}`, createdAt: new Date(i),
  }));
  m.agentChatMessage.findMany.mockImplementation(async (query: { where: { id?: { in: string[] } } }) => {
    const ids = query.where.id?.in;
    return ids ? many.filter((c) => ids.includes(c.id)) : many.map((c) => ({ id: c.id }));
  });
  const data = await buildUserDataExport("user_1");
  expect(data.agentConversations.map((c: { id: string }) => c.id)).toEqual(many.map((c) => c.id));
  const pages = m.agentChatMessage.findMany.mock.calls.filter(([q]) => q.where.id);
  expect(pages).toHaveLength(3);
  for (const [query] of pages) expect(query.where.id.in.length).toBeLessThanOrEqual(EXPORT_CHAT_BATCH);
});

it("exports the planner's details and version, quiz counts, credit holds and billing events", async () => {
  const data = await buildUserDataExport("user_1");
  expect(data.study.dailyPlans[0]).toMatchObject({ version: 2, details: { workload: { minutes: 90 } } });
  expect(m.studyDay.findMany.mock.calls[0][0].select).toMatchObject({ quizAnswers: true, quizCorrect: true });
  expect(data.credits.holds).toEqual([expect.objectContaining({ reason: "study_kit", charged: 7 })]);
  expect(data.billing.events).toEqual([expect.objectContaining({ kind: "refund", amountCents: 500 })]);
  expect(m.billingEvent.findMany.mock.calls[0][0].select).not.toHaveProperty("stripeObjectId");
  expect(m.billingIntent.findMany.mock.calls[0][0].select).not.toHaveProperty("stripeSubscriptionId");
});

it("exports notification choices, devices and the sent-log, never a push endpoint", async () => {
  const data = await buildUserDataExport("user_1");
  expect(data.notifications.preferences).toEqual(
    expect.objectContaining({ timeZone: "Europe/Berlin", deadlineLeads: [7, 2, 1], examLeads: [14, 7, 2, 1] }),
  );
  expect(data.notifications.devices).toEqual([expect.objectContaining({ label: "iPhone" })]);
  expect(data.notifications.sent).toEqual([expect.objectContaining({ kind: "daily", status: "sent" })]);
  const select = m.pushSubscription.findMany.mock.calls[0][0].select;
  expect(select).not.toHaveProperty("endpoint");
  expect(select).not.toHaveProperty("p256dh");
  expect(select).not.toHaveProperty("auth");
  for (const model of [m.pushSubscription.findMany, m.notificationLog.findMany]) {
    expect(model.mock.calls[0][0].where).toEqual({ userId: "user_1" });
  }
  expect(m.notificationPreference.findUnique.mock.calls[0][0].where).toEqual({ userId: "user_1" });
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

describe("streamUserDataExport", () => {
  /** Five 1 MB workspaces, served the way Prisma would (by the query's `where`). */
  function fiveBigWorkspaces() {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `w${i}`, name: `WS ${i}`, icon: null, version: 1, deletedAt: null,
      createdAt: new Date(i), updatedAt: new Date(i),
      data: JSON.stringify({ name: `WS ${i}`, pages: [], blob: "x".repeat(1_000_000) }),
    }));
    m.workspace.findMany.mockImplementation(async (query: { where: { id?: { in: string[] } } }) => {
      const ids = query.where.id?.in;
      return ids ? rows.filter((r) => ids.includes(r.id)) : rows.map((r) => ({ id: r.id }));
    });
    return rows;
  }

  it("lists ids first, then reads workspaces a batch at a time, only as the download is pulled", async () => {
    fiveBigWorkspaces();
    const stream = await streamUserDataExport("user_1", {}, new Date("2026-11-12T00:00:00Z"));
    expect(stream).toBeInstanceOf(ReadableStream);
    const reader = stream.getReader();
    await reader.read(); // the header
    // Nothing heavy has been read yet.
    const heavyQueries = () =>
      m.workspace.findMany.mock.calls.filter((c) => (c[0] as { select: { data?: boolean } }).select.data);
    expect(heavyQueries()).toHaveLength(0);

    const decoder = new TextDecoder();
    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value);
    }
    // Every heavy query asked for at most one batch of ids, scoped to the owner.
    expect(heavyQueries()).toHaveLength(Math.ceil(5 / EXPORT_WORKSPACE_BATCH));
    for (const [query] of heavyQueries()) {
      expect(query.where.ownerId).toBe("user_1");
      expect(query.where.id.in.length).toBeLessThanOrEqual(EXPORT_WORKSPACE_BATCH);
    }
    expect(rest.length).toBeGreaterThan(5_000_000);
  });

  it("concatenates to one valid JSON document, workspaces in their listed order", async () => {
    fiveBigWorkspaces();
    const text = await new Response(await streamUserDataExport("user_1")).text();
    const data = JSON.parse(text);
    expect(data.format).toBe("studyos-data-export");
    expect(data.workspaces.map((w: { id: string }) => w.id)).toEqual(["w0", "w1", "w2", "w3", "w4"]);
    expect(data.workspaces[2].data.name).toBe("WS 2");
    expect(data.studyMaterials).toHaveLength(1);
    expect(data.credits.balance).toBe(120);
  });

  it("rejects up front when the database fails (a clean 500, not a broken file)", async () => {
    m.creditLedger.findMany.mockRejectedValueOnce(new Error("db down"));
    await expect(streamUserDataExport("user_1")).rejects.toThrow("db down");
  });
});

describe("eraseUserData", () => {
  it("keeps the rows of assets whose file could not be deleted, for the retry job", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.asset.findMany.mockResolvedValue([
      { id: "a1", storageKey: "k1" },
      { id: "a2", storageKey: "k2" },
    ]);
    m.storeDelete.mockImplementation(async (key: string) => {
      if (key === "k2") throw new Error("storage unavailable");
    });
    expect(await eraseUserData("user_1")).toEqual({ assetsPending: 1 });
    expect(m.asset.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "user_1", id: { in: ["a1"] } } });
  });

  it("retries files of deleted accounts and removes each row once its file is gone", async () => {
    m.$queryRaw.mockResolvedValue([
      { id: "a1", storageKey: "k1" },
      { id: "a2", storageKey: "k2" },
    ]);
    m.storeDelete.mockImplementation(async (key: string) => {
      if (key === "k1") throw new Error("still down");
    });
    expect(await retryOrphanedAssetDeletes()).toEqual({ retried: 2, deleted: 1 });
    expect(m.asset.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a2"] } } });
    const sql = (m.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(sql).toContain('JOIN "DeletedAccount"');
  });

  it("removes asset bytes and every owned row in one transaction", async () => {
    m.asset.findMany.mockResolvedValue([{ id: "a1", storageKey: "k1" }, { id: "a2", storageKey: "k2" }]);
    await eraseUserData("user_1");
    expect(m.storeDelete).toHaveBeenCalledTimes(2);
    expect(m.$transaction).toHaveBeenCalledTimes(1);
    // Every user-owned model (schema-coverage.test.ts checks none is missing).
    expect(m.$transaction.mock.calls[0][0]).toHaveLength(20);
    // Credits reserved by requests in flight go with the account.
    expect(m.creditHold.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.agentChatMessage.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.studyMaterial.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "user_1" } });
    expect(m.calendarFeed.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.notificationPreference.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.notificationLog.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.studyDay.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.workspace.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "user_1" } });
    expect(m.subscription.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
  });
});
