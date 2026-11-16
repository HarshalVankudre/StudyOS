// @vitest-environment node
/**
 * Saving notification choices (what PUT /api/notifications/settings runs):
 * validation before anything is stored, and the next look scheduled from
 * the new choices. Prisma is an in-memory stand-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  devices: 1,
  upsert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    notificationPreference: {
      findUnique: async () => (db.row ? { ...db.row } : null),
      upsert: db.upsert,
      update: db.update,
    },
    pushSubscription: { count: async () => db.devices },
    dailyStudyAgentConfig: { findUnique: async () => null },
  },
}));
vi.mock("./config", () => ({ pushConfigured: () => true, vapidPublicKey: () => "BKey" }));

import { DEFAULT_PREFERENCES, toRow } from "./preferences";
import { getNotificationSettings, saveNotificationPreferences } from "./service";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Friday 13 November 2026, noon UTC.
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
  db.row = null;
  db.devices = 1;
  db.upsert.mockImplementation(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
    db.row = db.row ? { ...db.row, ...update } : { ...create };
    return db.row;
  });
  db.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    db.row = { ...db.row, ...data };
    return db.row;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("saving the weekly recap choice", () => {
  it("rejects a day, time or switch that is not valid, and stores nothing", async () => {
    for (const bad of [
      { weeklyDay: 7 },
      { weeklyDay: -1 },
      { weeklyDay: "Sunday" },
      { weeklyMinute: 1440 },
      { weeklyMinute: 12.5 },
      { weeklyEnabled: "true" },
      { weeklyEnabled: true, weeklyWhenever: true },
    ]) {
      expect(await saveNotificationPreferences("user_1", bad), JSON.stringify(bad)).toEqual({ ok: false });
    }
    expect(db.upsert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("stores a valid choice for the student and schedules the next look at their recap", async () => {
    const result = await saveNotificationPreferences("user_1", {
      timeZone: "Europe/Berlin",
      dailyEnabled: false,
      deadlineEnabled: false,
      streakEnabled: false,
      weeklyEnabled: true,
      weeklyDay: 0,
      weeklyMinute: 18 * 60,
    });
    expect(result).toEqual({
      ok: true,
      preferences: expect.objectContaining({ weeklyEnabled: true, weeklyDay: 0, weeklyMinute: 1080 }),
    });
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_1" },
        create: expect.objectContaining({ userId: "user_1", weeklyEnabled: true, weeklyDay: 0, weeklyMinute: 1080 }),
      }),
    );
    // Sunday 15 November, 18:00 in Berlin.
    expect(db.update).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      data: { nextCheckAt: new Date("2026-11-15T17:00:00.000Z") },
    });
  });

  it("keeps the recap off for a student who never turned it on", async () => {
    db.row = { userId: "user_1", ...toRow(DEFAULT_PREFERENCES) };
    const result = await saveNotificationPreferences("user_1", { streakEnabled: false });
    expect(result).toMatchObject({ ok: true, preferences: { weeklyEnabled: false } });
    expect((await getNotificationSettings("user_1")).preferences).toMatchObject({ weeklyEnabled: false, weeklyDay: 0, weeklyMinute: 1080 });
  });
});
