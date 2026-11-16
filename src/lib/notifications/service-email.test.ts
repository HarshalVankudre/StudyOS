// @vitest-environment node
/**
 * The email switch in the service: turning it on needs a verified address,
 * it carries the device's zone and language, it puts an email-only student
 * on the dispatch's schedule, and the unsubscribe link turns it off.
 * Prisma and Clerk are in-memory stand-ins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressLookup } from "@/lib/email/address";

const db = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  devices: 0,
  address: { kind: "verified", email: "me@example.com" } as AddressLookup,
  lookups: [] as { userId: string; fresh?: boolean }[],
  emailConfigured: true,
  /** What the re-seed's query returns, page by page. */
  pages: [] as Record<string, unknown>[][],
  queries: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    notificationPreference: {
      findUnique: async () => (db.row ? { ...db.row } : null),
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        db.row = db.row ? { ...db.row, ...update } : { ...create };
        return db.row;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        db.row = { ...db.row, ...data };
        return db.row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!db.row) return { count: 0 };
        const matches = Object.entries(where).every(([k, v]) => k === "userId" || db.row![k] === v);
        if (!matches) return { count: 0 };
        db.row = { ...db.row, ...data };
        return { count: 1 };
      },
    },
    pushSubscription: { count: async () => db.devices },
    dailyStudyAgentConfig: { findUnique: async () => null },
    $queryRaw: async (strings: TemplateStringsArray) => {
      db.queries.push(strings.join("?"));
      return db.pages.shift() ?? [];
    },
  },
}));
vi.mock("./config", () => ({ pushConfigured: () => false, vapidPublicKey: () => null }));
vi.mock("@/lib/email/config", () => ({ emailConfigured: () => db.emailConfigured }));
vi.mock("@/lib/email/address", () => ({
  emailAddresses: {
    lookup: async (userId: string, options?: { fresh?: boolean }) => {
      db.lookups.push({ userId, fresh: options?.fresh });
      return db.address;
    },
  },
}));

import { bounceHash } from "@/lib/email/bounce";
import { DEFAULT_PREFERENCES, toRow } from "./preferences";
import {
  getNotificationSettings,
  refreshNextCheck,
  reseedNotificationSchedules,
  setEmailReminders,
  unsubscribeEmail,
} from "./service";

const SECRET = "sk_test_service_email";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Friday 13 November 2026, noon UTC.
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
  db.row = null;
  db.devices = 0;
  db.address = { kind: "verified", email: "me@example.com" };
  db.lookups = [];
  db.emailConfigured = true;
  db.pages = [];
  db.queries = [];
  vi.stubEnv("CLERK_SECRET_KEY", SECRET);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** A refusal of `address` on record (its keyed hash, as the email channel stores it). */
const refusalOf = (address: string) => ({
  emailBouncedAt: new Date(0),
  emailBouncedHash: bounceHash(address, { CLERK_SECRET_KEY: SECRET }),
});

describe("turning email on", () => {
  it("needs a verified primary address, asked of Clerk afresh", async () => {
    db.address = { kind: "unverified", email: "new@example.com" };
    expect(await setEmailReminders("user_1", true)).toEqual({ ok: false, reason: "unverified" });
    db.address = { kind: "missing" };
    expect(await setEmailReminders("user_1", true)).toEqual({ ok: false, reason: "no_address" });
    db.address = { kind: "unavailable" };
    expect(await setEmailReminders("user_1", true)).toEqual({ ok: false, reason: "unavailable" });
    expect(db.row).toBeNull();
    expect(db.lookups.every((l) => l.fresh === true)).toBe(true);
  });

  it("stores the switch with the device's zone and language, and schedules an email-only student", async () => {
    const result = await setEmailReminders("user_1", true, { timeZone: "Europe/Berlin", locale: "de" });
    expect(result).toEqual({
      ok: true,
      email: { enabled: true, address: "me@example.com", verified: true, bounced: false, unavailable: false },
    });
    expect(db.row).toMatchObject({ userId: "user_1", emailEnabled: true, timeZone: "Europe/Berlin", locale: "de" });
    // No device at all: email alone puts the student on the schedule (18:00 Berlin, the deadline check).
    expect(db.row!.nextCheckAt).toEqual(new Date("2026-11-13T17:00:00.000Z"));
  });

  it("clears an earlier rejection: the student says the address works again", async () => {
    db.row = { userId: "user_1", ...toRow(DEFAULT_PREFERENCES), emailEnabled: true, ...refusalOf("me@example.com") };
    const result = await setEmailReminders("user_1", true);
    expect(result).toMatchObject({ ok: true, email: { enabled: true, bounced: false } });
    expect(db.row).toMatchObject({ emailBouncedAt: null, emailBouncedHash: null });
  });

  it("turns off whatever Clerk says, without asking Clerk afresh, and leaves an email-only student unscheduled", async () => {
    await setEmailReminders("user_1", true);
    db.lookups = [];
    db.address = { kind: "unavailable" };
    expect(await setEmailReminders("user_1", false)).toMatchObject({ ok: true, email: { enabled: false } });
    expect(db.row).toMatchObject({ emailEnabled: false, nextCheckAt: null });
    expect(db.lookups).toEqual([{ userId: "user_1", fresh: undefined }]);
  });

  it("is refused when email is not configured on this server", async () => {
    db.emailConfigured = false;
    expect(await setEmailReminders("user_1", true)).toEqual({ ok: false, reason: "not_configured" });
  });
});

describe("the schedule with email", () => {
  it("is not kept for a refused address", async () => {
    db.row = { userId: "user_1", ...toRow(DEFAULT_PREFERENCES), emailEnabled: true, ...refusalOf("me@example.com") };
    await refreshNextCheck("user_1");
    expect(db.row!.nextCheckAt).toBeNull();
    db.row!.emailBouncedAt = null;
    await refreshNextCheck("user_1");
    expect(db.row!.nextCheckAt).not.toBeNull();
  });

  it("is kept while email is briefly not configured, so email-only students are not dropped for good", async () => {
    db.row = { userId: "user_1", ...toRow(DEFAULT_PREFERENCES), emailEnabled: true, emailBouncedAt: null };
    db.emailConfigured = false;
    await refreshNextCheck("user_1");
    // 18:00 in the row's zone (UTC by default): the deadline check.
    expect(db.row!.nextCheckAt).toEqual(new Date("2026-11-13T18:00:00.000Z"));
  });
});

describe("the daily re-seed (maintenance)", () => {
  it("puts students with a device or email on, but no next moment, back on the schedule", async () => {
    db.row = { userId: "user_1", ...toRow(DEFAULT_PREFERENCES), emailEnabled: true, emailBouncedAt: null, nextCheckAt: null };
    db.pages = [[{ ...db.row }]];
    expect(await reseedNotificationSchedules()).toBe(1);
    // 18:00 in the row's zone (UTC by default): the deadline check.
    expect(db.row!.nextCheckAt).toEqual(new Date("2026-11-13T18:00:00.000Z"));
    // Only rows without a next moment, with email on and not refused, or with a device.
    const [sql] = db.queries;
    expect(sql).toMatch(/"nextCheckAt" IS NULL/);
    expect(sql).toMatch(/"emailEnabled" AND p\."emailBouncedAt" IS NULL/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM "PushSubscription"/);
  });

  it("never overwrites a moment set meanwhile, and leaves a student with every reminder off as they are", async () => {
    const off = { ...toRow({ ...DEFAULT_PREFERENCES, dailyEnabled: false, deadlineEnabled: false, streakEnabled: false, weeklyEnabled: false }) };
    db.row = { userId: "user_1", ...off, emailEnabled: true, emailBouncedAt: null, nextCheckAt: null };
    db.pages = [[{ ...db.row }]];
    expect(await reseedNotificationSchedules()).toBe(0);
    expect(db.row!.nextCheckAt).toBeNull();

    const later = new Date("2026-11-14T08:00:00.000Z");
    db.row = { userId: "user_1", ...toRow(DEFAULT_PREFERENCES), emailEnabled: true, nextCheckAt: later };
    db.pages = [[{ ...db.row, nextCheckAt: null }]];
    expect(await reseedNotificationSchedules()).toBe(0);
    expect(db.row!.nextCheckAt).toBe(later);
  });
});

describe("the unsubscribe link", () => {
  it("turns email off (and reports whether it was on), leaving the other choices alone", async () => {
    await setEmailReminders("user_1", true);
    expect(await unsubscribeEmail("user_1")).toBe(true);
    expect(db.row).toMatchObject({ emailEnabled: false, dailyEnabled: true, nextCheckAt: null });
    expect(await unsubscribeEmail("user_1")).toBe(false);
    expect(await unsubscribeEmail("nobody")).toBe(false);
  });
});

describe("the settings view", () => {
  it("shows the section for email alone, with the address from Clerk and no push key", async () => {
    db.row = { userId: "user_1", ...toRow(DEFAULT_PREFERENCES), emailEnabled: true, emailBouncedAt: null };
    const view = await getNotificationSettings("user_1");
    expect(view).toMatchObject({
      configured: true,
      publicKey: null,
      devices: 0,
      email: { enabled: true, address: "me@example.com", verified: true, bounced: false, unavailable: false },
    });
  });

  it("says when the address is unverified, missing or cannot be checked, and when it was refused", async () => {
    db.row = { userId: "user_1", ...toRow(DEFAULT_PREFERENCES), emailEnabled: true, ...refusalOf("new@example.com") };
    db.address = { kind: "unverified", email: "new@example.com" };
    expect((await getNotificationSettings("user_1")).email).toEqual({
      enabled: true,
      address: "new@example.com",
      verified: false,
      bounced: true,
      unavailable: false,
    });
    db.address = { kind: "unavailable" };
    expect((await getNotificationSettings("user_1")).email).toMatchObject({ address: null, unavailable: true });
  });

  it("never asks Clerk afresh just to show the settings (the address book's short memory serves)", async () => {
    for (const address of [
      { kind: "verified", email: "me@example.com" },
      { kind: "unverified", email: "new@example.com" },
      { kind: "missing" },
      { kind: "unavailable" },
    ] as AddressLookup[]) {
      db.lookups = [];
      db.address = address;
      await getNotificationSettings("user_1");
      expect(db.lookups, address.kind).toEqual([{ userId: "user_1", fresh: undefined }]);
    }
  });

  it("says the CURRENT address was refused only when it is the refused one", async () => {
    db.row = { userId: "user_1", ...toRow(DEFAULT_PREFERENCES), emailEnabled: true, ...refusalOf("me@example.com"), nextCheckAt: null };
    expect((await getNotificationSettings("user_1")).email).toMatchObject({ address: "me@example.com", bounced: true });
    expect(db.row!.emailBouncedAt).not.toBeNull();
  });

  it("lifts a refusal of an address the student no longer has, and puts them back on the schedule", async () => {
    db.row = { userId: "user_1", ...toRow(DEFAULT_PREFERENCES), emailEnabled: true, ...refusalOf("old@example.com"), nextCheckAt: null };
    const view = await getNotificationSettings("user_1");
    expect(view.email).toMatchObject({ enabled: true, address: "me@example.com", bounced: false });
    expect(db.row).toMatchObject({ emailBouncedAt: null, emailBouncedHash: null });
    expect(db.row!.nextCheckAt).not.toBeNull();
  });

  it("keeps a refusal it cannot compare (Clerk unreachable, or recorded before hashes)", async () => {
    db.row = { userId: "user_1", ...toRow(DEFAULT_PREFERENCES), emailEnabled: true, ...refusalOf("old@example.com") };
    db.address = { kind: "unavailable" };
    expect((await getNotificationSettings("user_1")).email).toMatchObject({ bounced: true });
    db.row = { userId: "user_1", ...toRow(DEFAULT_PREFERENCES), emailEnabled: true, emailBouncedAt: new Date(0), emailBouncedHash: null };
    db.address = { kind: "verified", email: "me@example.com" };
    expect((await getNotificationSettings("user_1")).email).toMatchObject({ bounced: true });
    expect(db.row!.emailBouncedAt).not.toBeNull();
  });

  it("hides email when it is not configured", async () => {
    db.emailConfigured = false;
    expect(await getNotificationSettings("user_1")).toMatchObject({ configured: false, email: null });
  });
});
