// @vitest-environment node
/**
 * The notifications store on a real Postgres: the FOR UPDATE SKIP LOCKED
 * claim, the lease, and the ON CONFLICT sent-log under real concurrency.
 *
 * Opt-in (CI has no database):
 *   STUDYOS_DB_TESTS=1 with DATABASE_URL pointing at a THROWAWAY database
 *   (the local one on :54329), then
 *   npx pnpm@10 exec vitest run src/lib/notifications/store.db.test.ts
 * Only touches rows of its own random test users and removes them after.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/report-error", () => ({ reportError: () => undefined }));
vi.mock("@/lib/notifications/config", () => ({
  pushConfigured: () => true,
  vapidPublicKey: () => "BKey",
  vapidConfig: () => null,
}));

const enabled = process.env.STUDYOS_DB_TESTS === "1";

describe.skipIf(!enabled)("notifications store on Postgres", () => {
  const run = `ntest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const users: string[] = [];
  const user = (tag: string) => {
    const id = `${run}_${tag}`;
    users.push(id);
    return id;
  };
  const db = async () => (await import("@/lib/db")).prisma;

  afterAll(async () => {
    const prisma = await db();
    await prisma.notificationLog.deleteMany({ where: { userId: { in: users } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: users } } });
    await prisma.pushSubscription.deleteMany({ where: { userId: { in: users } } });
    await prisma.dailyStudyPlan.deleteMany({ where: { userId: { in: users } } });
    await prisma.agentRun.deleteMany({ where: { userId: { in: users } } });
    await prisma.$disconnect();
  });

  it("claims each due student once across concurrent runs", async () => {
    const prisma = await db();
    const { prismaNotificationStore: store } = await import("./store");
    const ids = Array.from({ length: 12 }, (_, i) => user(`claim${i}`));
    const past = new Date(Date.now() - 60_000);
    await prisma.notificationPreference.createMany({ data: ids.map((userId) => ({ userId, nextCheckAt: past })) });
    const now = new Date();
    const lease = new Date(now.getTime() + 300_000);
    const batches = await Promise.all(Array.from({ length: 4 }, () => store.claimDueUsers(now, 50, lease)));
    const claimed = batches.flat().map((u) => u.userId).filter((id) => ids.includes(id));
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(new Set(claimed)).toEqual(new Set(ids));
    // Leased: a further run sees nobody until released.
    const again = (await store.claimDueUsers(now, 50, lease)).filter((u) => ids.includes(u.userId));
    expect(again).toEqual([]);
    await store.release(ids[0], null);
    const row = await prisma.notificationPreference.findUnique({ where: { userId: ids[0] } });
    expect(row).toMatchObject({ nextCheckAt: null, leaseUntil: null });
  });

  it("claims a reminder exactly once, however many runs race for it", async () => {
    const { prismaNotificationStore: store } = await import("./store");
    const userId = user("log");
    const entry = { userId, dedupeKey: "daily:2026-11-12", kind: "daily" as const, localDate: "2026-11-12", message: true };
    const results = await Promise.all(Array.from({ length: 8 }, () => store.claim(entry)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.countMessages(userId, "2026-11-12")).toBe(1);
    await store.finish(results.find(Boolean)!, "skipped", false, new Date());
    expect(await store.countMessages(userId, "2026-11-12")).toBe(0);
  });

  it("dispatches end to end over Postgres without repeats when runs overlap", async () => {
    const prisma = await db();
    const { prismaNotificationStore: store } = await import("./store");
    const { runNotificationDispatch } = await import("./dispatch");
    const { FakeChannel } = await import("./test-fakes");
    const userId = user("e2e");
    await prisma.notificationPreference.create({
      data: { userId, timeZone: "UTC", deadlineEnabled: false, streakEnabled: false, quietEnabled: false, nextCheckAt: new Date(0) },
    });
    const channel = new FakeChannel();
    channel.devices.set(userId, 1);
    // No workspaces: the planner builds an empty plan, so the note is skipped.
    const now = () => new Date("2026-11-12T08:00:00Z");
    await Promise.all([1, 2, 3].map(() => runNotificationDispatch({ store, channels: [channel], now })));
    const logs = await prisma.notificationLog.findMany({ where: { userId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ dedupeKey: "daily:2026-11-12", status: "skipped" });
    // The server-built plan was stored for the Today view.
    expect(await prisma.dailyStudyPlan.count({ where: { userId, localDate: "2026-11-12" } })).toBe(1);
    const pref = await prisma.notificationPreference.findUnique({ where: { userId } });
    expect(pref?.nextCheckAt?.toISOString()).toBe("2026-11-13T08:00:00.000Z");
  });

  it("keeps nextCheckAt in step with devices and choices", async () => {
    const prisma = await db();
    const service = await import("./service");
    const userId = user("svc");
    const endpoint = `https://fcm.googleapis.com/fcm/send/${run}`;
    await service.addPushSubscription(
      userId,
      { ok: true, endpoint, p256dh: "p", auth: "a" },
      { timeZone: "Asia/Tokyo", locale: "ja", label: "iPhone" },
    );
    let pref = await prisma.notificationPreference.findUnique({ where: { userId } });
    expect(pref).toMatchObject({ timeZone: "Asia/Tokyo", locale: "ja" });
    expect(pref?.nextCheckAt).toBeInstanceOf(Date);
    await service.saveNotificationPreferences(userId, { dailyEnabled: false, deadlineEnabled: false, streakEnabled: false });
    pref = await prisma.notificationPreference.findUnique({ where: { userId } });
    expect(pref?.nextCheckAt).toBeNull();
    await service.saveNotificationPreferences(userId, { dailyEnabled: true });
    expect(await service.removePushSubscriptions(userId, { endpoint })).toBe(1);
    pref = await prisma.notificationPreference.findUnique({ where: { userId } });
    expect(pref?.nextCheckAt).toBeNull();
  });
});
