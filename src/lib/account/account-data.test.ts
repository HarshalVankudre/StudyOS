import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    focusSession: { findMany: fn(), deleteMany: fn() },
    notificationPreference: { findUnique: fn(), deleteMany: fn() },
    pushSubscription: { findMany: fn(), deleteMany: fn() },
    notificationLog: { findMany: fn(), deleteMany: fn() },
    feedback: { findMany: fn(), deleteMany: fn() },
    pageShare: { findMany: fn(), deleteMany: fn() },
    shareReport: { deleteMany: fn() },
    referralCode: { findUnique: fn(), deleteMany: fn() },
    referral: { findMany: fn(), findUnique: fn(), deleteMany: fn(), updateMany: fn() },
    contractNotice: { findMany: fn(), updateMany: fn() },
    notebook: { findMany: fn(), deleteMany: fn() },
    notebookFolder: { findMany: fn(), deleteMany: fn() },
    notebookPage: { findMany: fn(), deleteMany: fn() },
    notebookFile: { findMany: fn(), findFirst: fn(), deleteMany: fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    storeDelete: vi.fn(),
    pdfDelete: vi.fn(),
    pdfRead: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: m }));
vi.mock("@/lib/assets/storage", () => ({ gcsAssetStore: () => ({ delete: m.storeDelete }) }));
vi.mock("@/lib/notebooks/server/file-store", () => ({ deletePdfObjects: m.pdfDelete, readPdfBytes: m.pdfRead }));

import {
  allowDataExport,
  buildUserDataExport,
  EXPORT_CHAT_BATCH,
  EXPORT_EXCLUDED_MODELS,
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
  m.focusSession.findMany.mockResolvedValue([
    { workspaceId: "w1", itemKey: "deadline:w1:db:essay", label: "History essay · Fall", localDate: "2026-11-11", startedAt: new Date(0), seconds: 1500, completed: true, createdAt: new Date(0) },
  ]);
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
    weeklyEnabled: true, weeklyDay: 0, weeklyMinute: 1080,
    quietEnabled: true, quietStart: 1320, quietEnd: 420,
    emailEnabled: true, emailBouncedAt: null, createdAt: new Date(0), updatedAt: new Date(0),
  });
  m.pushSubscription.findMany.mockResolvedValue([{ label: "iPhone", lastSuccessAt: null, createdAt: new Date(0) }]);
  m.notificationLog.findMany.mockResolvedValue([
    { kind: "daily", localDate: "2026-11-11", status: "sent", message: true, createdAt: new Date(0), sentAt: new Date(0) },
  ]);
  m.notebook.findMany.mockResolvedValue([]);
  m.notebookFolder.findMany.mockResolvedValue([]);
  m.notebookPage.findMany.mockResolvedValue([]);
  m.notebookFile.findMany.mockResolvedValue([]);
  m.notebookFile.findFirst.mockResolvedValue(null);
  m.pdfDelete.mockImplementation(async (keys: string[]) => ({ deleted: keys, failed: 0 }));
  m.pdfRead.mockImplementation(async (row: { data: Uint8Array | null }) => row.data);
  m.calendarFeed.findMany.mockResolvedValue([
    { workspaceId: "w1", databaseId: "d1", label: "canvas.uni.edu", platform: "canvas", settings: '{"series":[]}', lastSyncedAt: null, lastSummary: null, createdAt: new Date(0) },
  ]);
  m.feedback.findMany.mockResolvedValue([
    { kind: "idea", message: "Dark mode for flashcards", pagePath: "/app/w1", locale: "en", contactOk: true, status: "new", createdAt: new Date(0) },
  ]);
  m.pageShare.findMany.mockResolvedValue([
    { workspaceId: "w1", pageId: "p1", createdAt: new Date(0), revokedAt: null, viewCount: 7, lastViewedAt: new Date(0) },
  ]);
  m.referralCode.findUnique.mockResolvedValue({ code: "K7MPQ2XR", createdAt: new Date(0) });
  m.contractNotice.findMany.mockResolvedValue([]);
  m.referral.findMany.mockResolvedValue([
    { createdAt: new Date(1000), rewardedAt: new Date(2000) },
    { createdAt: new Date(3000), rewardedAt: null },
  ]);
  m.referral.findUnique.mockResolvedValue({ status: "rewarded", createdAt: new Date(0), rewardedAt: new Date(500) });
});

it("exports the student's invite link, the friends they invited by date only, and whether they were invited", async () => {
  const data = await buildUserDataExport("user_1");
  expect(data.referrals).toEqual({
    inviteCode: { code: "K7MPQ2XR", createdAt: new Date(0).toISOString() },
    friendsInvited: 2,
    invited: [
      { joinedAt: new Date(1000).toISOString(), rewardedAt: new Date(2000).toISOString() },
      { joinedAt: new Date(3000).toISOString(), rewardedAt: null },
    ],
    invitedBy: { status: "rewarded", invitedAt: new Date(0).toISOString(), rewardedAt: new Date(500).toISOString() },
  });
  // Never the other side's identity: no user ids, no inviter's code. Only
  // friends who joined (pending or rewarded), never refused attempts.
  const made = m.referral.findMany.mock.calls[0][0];
  expect(made.where).toEqual({ referrerId: "user_1", status: { in: ["pending", "rewarded"] } });
  expect(made.select).toEqual({ createdAt: true, rewardedAt: true });
  const by = m.referral.findUnique.mock.calls[0][0];
  expect(by.where).toEqual({ refereeId: "user_1" });
  // Nor why an invite was refused (a fraud check's verdict).
  for (const field of ["referrerId", "refereeId", "code", "rejectReason"]) expect(by.select).not.toHaveProperty(field);
  expect(m.referralCode.findUnique.mock.calls[0][0].where).toEqual({ userId: "user_1" });
});

it("says only “not eligible” about a refused invite the student came through", async () => {
  m.referral.findUnique.mockResolvedValue({ status: "rejected", createdAt: new Date(0), rewardedAt: null });
  const data = await buildUserDataExport("user_1");
  expect(data.referrals.invitedBy).toEqual({ status: "not_eligible", invitedAt: new Date(0).toISOString(), rewardedAt: null });
  expect(JSON.stringify(data.referrals)).not.toMatch(/same_email|mailbox_reused|reject/);
});

it("exports no invites for a student who has none", async () => {
  m.referralCode.findUnique.mockResolvedValue(null);
  m.referral.findMany.mockResolvedValue([]);
  m.referral.findUnique.mockResolvedValue(null);
  const data = await buildUserDataExport("user_1");
  expect(data.referrals).toEqual({ inviteCode: null, friendsInvited: 0, invited: [], invitedBy: null });
});

it("exports the pages the student shared, scoped to them, never the link's token", async () => {
  const data = await buildUserDataExport("user_1");
  expect(data.sharedPages).toEqual([
    expect.objectContaining({ workspaceId: "w1", pageId: "p1", revokedAt: null, viewCount: 7 }),
  ]);
  const query = m.pageShare.findMany.mock.calls[0][0];
  expect(query.where).toEqual({ userId: "user_1" });
  expect(query.select).not.toHaveProperty("token");
  // Reports other people sent about the page are not part of the student's export.
  expect(EXPORT_EXCLUDED_MODELS).toContain("ShareReport");
});

it("exports the student's focus sessions with their study records, scoped to them", async () => {
  const data = await buildUserDataExport("user_1");
  expect(data.study.focusSessions).toEqual([
    expect.objectContaining({ label: "History essay · Fall", localDate: "2026-11-11", seconds: 1500, completed: true }),
  ]);
  const query = m.focusSession.findMany.mock.calls[0][0];
  expect(query.where).toEqual({ userId: "user_1" });
  // The browser's idempotency id is internal: not part of the export.
  expect(query.select).not.toHaveProperty("clientId");
});

it("exports the feedback the student sent, scoped to them", async () => {
  const data = await buildUserDataExport("user_1");
  expect(data.feedback).toEqual([
    expect.objectContaining({ kind: "idea", message: "Dark mode for flashcards", pagePath: "/app/w1", status: "new" }),
  ]);
  expect(m.feedback.findMany.mock.calls[0][0].where).toEqual({ userId: "user_1" });
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

  it("exports a database's grading scheme with its workspace (it lives in the workspace document)", async () => {
    const grading = {
      scale: "us_letter",
      categories: [{ id: "c1", name: "Exams", weight: 60, dropLowest: 0 }],
    };
    const doc = { name: "Fall", pages: [], databases: [{ id: "d1", name: "Assignments", grading }] };
    m.workspace.findMany.mockResolvedValue([
      { id: "w1", name: "Fall", icon: null, data: JSON.stringify(doc), version: 3, createdAt: new Date(0), updatedAt: new Date(0) },
    ]);
    const data = await buildUserDataExport("user_1");
    expect((data.workspaces[0].data as typeof doc).databases[0].grading).toEqual(grading);
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
  // The weekly recap choice is the student's data too.
  expect(m.notificationPreference.findUnique.mock.calls[0][0].select).toMatchObject({
    weeklyEnabled: true,
    weeklyDay: true,
    weeklyMinute: true,
  });
  expect(data.notifications.preferences).toEqual(
    expect.objectContaining({ weeklyEnabled: true, weeklyDay: 0, weeklyMinute: 1080 }),
  );
  // The email switch and a recorded rejection too; the address is never stored, so never exported from here.
  expect(m.notificationPreference.findUnique.mock.calls[0][0].select).toMatchObject({ emailEnabled: true, emailBouncedAt: true });
  expect(data.notifications.preferences).toEqual(expect.objectContaining({ emailEnabled: true, emailBouncedAt: null }));
  expect(Object.keys(m.notificationPreference.findUnique.mock.calls[0][0].select).some((k) => /address/i.test(k))).toBe(false);
});

describe("allowDataExport", () => {
  // The claim runs in an interactive transaction holding an advisory lock.
  const order: string[] = [];
  beforeEach(() => {
    order.length = 0;
    const tx = {
      $queryRaw: vi.fn(async () => {
        order.push("lock");
        return [];
      }),
      usageEvent: m.usageEvent,
    };
    m.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    m.usageEvent.count.mockImplementation(async () => {
      order.push("count");
      return 0;
    });
  });
  afterEach(() => {
    m.$transaction.mockReset();
    m.usageEvent.count.mockReset();
  });

  it("records an export under the limit and refuses past it", async () => {
    m.usageEvent.create.mockResolvedValue({});
    expect(await allowDataExport("user_1")).toBe(true);
    expect(m.usageEvent.create).toHaveBeenCalledWith({ data: { userId: "user_1", kind: "data_export" } });
    m.usageEvent.count.mockResolvedValue(EXPORT_LIMIT.max);
    expect(await allowDataExport("user_1")).toBe(false);
  });

  it("counts only after taking the user's lock, inside one transaction", async () => {
    m.usageEvent.create.mockResolvedValue({});
    await allowDataExport("user_1");
    expect(m.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.anything());
    expect(order).toEqual(["lock", "count"]);
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
    expect(m.$transaction.mock.calls[0][0]).toHaveLength(32);
    // Withdrawal and cancellation notices are legal records: kept, unlinked from the account.
    expect(m.contractNotice.updateMany).toHaveBeenCalledWith({ where: { userId: "user_1" }, data: { userId: null } });
    // The invite link and the invites the student made go; the invite they
    // came through is anonymised (kept for the operator's evidence).
    expect(m.referralCode.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.referral.deleteMany).toHaveBeenCalledWith({ where: { referrerId: "user_1" } });
    expect(m.referral.updateMany).toHaveBeenCalledWith({ where: { refereeId: "user_1" }, data: { refereeId: null } });
    // Shared page links, and the reports about them, go with the account.
    expect(m.pageShare.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.shareReport.deleteMany).toHaveBeenCalledWith({ where: { share: { userId: "user_1" } } });
    // Credits reserved by requests in flight go with the account.
    expect(m.creditHold.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.agentChatMessage.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.studyMaterial.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "user_1" } });
    expect(m.calendarFeed.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.notificationPreference.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.notificationLog.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.feedback.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.studyDay.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.focusSession.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
    expect(m.workspace.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "user_1" } });
    expect(m.subscription.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
  });
});

describe("handwritten notebooks in the data export and the erasure", () => {
  it("exports notebooks, folders, every page with its ink, and imported PDFs with their bytes", async () => {
    m.notebook.findMany.mockResolvedValue([
      { id: "nb1", title: "Bio", cover: "teal", folderId: "f1", workspaceId: null, paper: '{"size":"a4"}', pageCount: 1, version: 3, deletedAt: null, createdAt: new Date(0), updatedAt: new Date(0) },
    ]);
    m.notebookFolder.findMany.mockResolvedValue([{ id: "f1", name: "Semester 1", createdAt: new Date(0), updatedAt: new Date(0) }]);
    const page = {
      id: "pg1", notebookId: "nb1", position: 1, template: '{"kind":"ruled","paper":"white"}', width: 794, height: 1123,
      pdfFileId: null, pdfPage: null, ink: new Uint8Array([0x53, 0x4e, 0x01]), inkVersion: 2, strokeCount: 0,
      pdfText: "", inkText: "mitosis", inkTextVersion: 2, createdAt: new Date(0), updatedAt: new Date(0),
    };
    m.notebookPage.findMany.mockImplementation(async (q: { where: { id?: { in: string[] } } }) =>
      q.where.id?.in ? [page] : [{ id: "pg1" }],
    );
    // 200 KB, more than one base64 chunk.
    const pdf = new Uint8Array(200_000).map((_, i) => i % 251);
    m.notebookFile.findMany.mockResolvedValue([{ id: "file1" }]);
    m.notebookFile.findFirst.mockResolvedValue({
      id: "file1", notebookId: "nb1", name: "slides.pdf", mime: "application/pdf", sizeBytes: pdf.length, sha256: "ab",
      pageCount: 2, createdAt: new Date(0), storageKey: null, data: pdf,
    });

    const data = await buildUserDataExport("user_1");
    expect(data.notebooks).toEqual([expect.objectContaining({ id: "nb1", title: "Bio", paper: { size: "a4" } })]);
    expect(data.notebookFolders).toEqual([expect.objectContaining({ id: "f1", name: "Semester 1" })]);
    expect(data.notebookPages).toEqual([
      expect.objectContaining({ id: "pg1", ink: "U04B", inkFormat: "studyos-ink-v1", inkText: "mitosis", template: { kind: "ruled", paper: "white" } }),
    ]);
    expect(data.notebookFiles).toHaveLength(1);
    expect(data.notebookFiles[0]).toMatchObject({ id: "file1", name: "slides.pdf", unavailable: false });
    expect(Buffer.from(data.notebookFiles[0].data, "base64").equals(Buffer.from(pdf))).toBe(true);
    expect(m.notebookFile.findFirst.mock.calls[0][0].where).toEqual({ ownerId: "user_1", id: "file1" });
  });

  it("lists a PDF whose bytes cannot be read instead of breaking the download", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.notebookFile.findMany.mockResolvedValue([{ id: "file1" }]);
    m.notebookFile.findFirst.mockResolvedValue({
      id: "file1", notebookId: null, name: "a.pdf", mime: "application/pdf", sizeBytes: 9, sha256: "ab",
      pageCount: 1, createdAt: new Date(0), storageKey: "notebooks/user_1/file1.pdf", data: null,
    });
    m.pdfRead.mockRejectedValue(new Error("storage down"));
    const data = await buildUserDataExport("user_1");
    expect(data.notebookFiles).toEqual([expect.objectContaining({ id: "file1", unavailable: true, data: null })]);
  });

  it("erases every notebook row, keeping only PDF rows whose stored object could not be deleted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.notebookFile.findMany.mockResolvedValue([
      { id: "inline", storageKey: null },
      { id: "ok", storageKey: "k-ok" },
      { id: "stuck", storageKey: "k-stuck" },
    ]);
    m.pdfDelete.mockResolvedValue({ deleted: ["k-ok"], failed: 1 });
    expect(await eraseUserData("user_1")).toEqual({ assetsPending: 1 });
    expect(m.pdfDelete).toHaveBeenCalledWith(["k-ok", "k-stuck"]);
    expect(m.notebookFile.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "user_1", id: { in: ["inline", "ok"] } } });
    expect(m.notebookPage.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "user_1" } });
    expect(m.notebook.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "user_1" } });
    expect(m.notebookFolder.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "user_1" } });
  });
});
