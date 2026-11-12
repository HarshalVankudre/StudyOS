import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/report-error", () => ({ reportError: vi.fn() }));

import { addDays } from "@/lib/workspace/view-logic";
import { runNotificationDispatch } from "./dispatch";
import { DAILY_CAP } from "./preferences";
import { FakeChannel, MemoryStore, planItem, semester } from "./test-fakes";

// Thursday 12 November 2026. Berlin is UTC+1 (CET) in November.
const TODAY = "2026-11-12";
const at = (isoUtc: string) => () => new Date(isoUtc);
const BERLIN = { timeZone: "Europe/Berlin" };
/** 08:00 in Berlin: the default daily time. */
const DAILY = "2026-11-12T07:00:00Z";
/** 18:00 in Berlin: the default deadline time. */
const DEADLINES = "2026-11-12T17:00:00Z";
/** 20:00 in Berlin: the streak check. */
const STREAK = "2026-11-12T19:00:00Z";

let store: MemoryStore;
let channel: FakeChannel;

function run(now: string, extra: Partial<Parameters<typeof runNotificationDispatch>[0]> = {}) {
  return runNotificationDispatch({ store, channels: [channel], now: at(now), ...extra });
}

beforeEach(() => {
  store = new MemoryStore();
  channel = new FakeChannel();
});

function student(userId = "u1", prefs: Parameters<MemoryStore["addUser"]>[1] = {}) {
  store.addUser(userId, { ...BERLIN, ...prefs });
  channel.devices.set(userId, 1);
}

describe("daily plan notification", () => {
  it("names the first open item and the total time, opens its exact place, at the student's local time", async () => {
    student();
    store.plans.set("u1", [
      planItem({ id: "a", title: "Read chapter 3", completed: true, startHere: true, minutes: 30 }),
      planItem({ id: "b", title: "Lab report draft", minutes: 25, target: { workspaceId: "ws1", pageId: "home", databaseId: "db1", rowId: "r9" } }),
      planItem({ id: "c", title: "Vocab list", minutes: 20 }),
    ]);
    const result = await run(DAILY);
    expect(result).toMatchObject({ users: 1, sent: 1 });
    expect(channel.sent).toHaveLength(1);
    const { message } = channel.sent[0];
    expect(message.title).toBe("Today’s plan · about 45 min");
    expect(message.body).toBe("Start here: Lab report draft (25 min). Then one more when you’re ready.");
    expect(message.url).toBe("/app/ws1?page=home&db=db1&row=r9");
    // The next look is this evening's deadline moment, not every tick.
    expect(store.users.get("u1")!.nextCheckAt?.toISOString()).toBe("2026-11-12T17:00:00.000Z");
  });

  it("is in the student's language", async () => {
    student("u1", { locale: "de" });
    store.plans.set("u1", [planItem({ id: "a", title: "Laborbericht", minutes: 60 })]);
    await run(DAILY);
    expect(channel.sent[0].message).toMatchObject({
      title: "Plan für heute · etwa 1 Std.",
      body: "Fang hier an: Laborbericht (1 Std.). Das ist der ganze Plan.",
      lang: "de",
      dir: "ltr",
    });
  });

  it("says nothing when everything is already done, or the agent is paused", async () => {
    student("u1");
    store.plans.set("u1", [planItem({ id: "a", title: "Done thing", completed: true })]);
    student("u2");
    store.plans.set("u2", null);
    const result = await run(DAILY);
    expect(channel.sent).toHaveLength(0);
    expect(result.skipped).toBe(2);
    expect(store.logs.every((l) => l.status === "skipped" && !l.message)).toBe(true);
  });

  it("is not sent before its time, and not long after it", async () => {
    student();
    store.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    await run("2026-11-12T06:59:00Z");
    expect(channel.sent).toHaveLength(0);
    store.users.get("u1")!.nextCheckAt = new Date(0);
    await run("2026-11-12T09:00:00Z"); // two hours late: past the grace period
    expect(channel.sent).toHaveLength(0);
  });

  it("follows the student's clock across a daylight-saving change", async () => {
    // New York leaves EDT on 1 Nov 2026: 08:00 is 12:00Z the day before, 13:00Z on the day.
    student("u1", { timeZone: "America/New_York", deadlineEnabled: false, streakEnabled: false });
    store.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    await run("2026-11-01T12:00:00Z");
    expect(channel.sent).toHaveLength(0);
    expect(store.users.get("u1")!.nextCheckAt?.toISOString()).toBe("2026-11-01T13:00:00.000Z");
    await run("2026-11-01T13:00:00Z");
    expect(channel.sent).toHaveLength(1);
    expect(store.users.get("u1")!.nextCheckAt?.toISOString()).toBe("2026-11-02T13:00:00.000Z");
  });
});

describe("deadline reminders", () => {
  beforeEach(() => {
    student();
    store.workspaces.set("u1", [
      semester([
        { id: "r1", title: "Lab report", due: addDays(TODAY, 7), course: "bio", hours: 3 },
        { id: "r2", title: "Essay outline", due: addDays(TODAY, 7), course: "hist", done: true },
        { id: "r3", title: "Midterm", due: addDays(TODAY, 14), exam: true, course: "hist" },
        { id: "r4", title: "Problem set 5", due: addDays(TODAY, 14), course: "bio" },
        { id: "r5", title: "Reading log", due: addDays(TODAY, 4), course: "bio" },
      ]),
    ]);
  });

  it("reminds at the chosen lead times, with course, due day and effort, linking to the row", async () => {
    await run(DEADLINES);
    const messages = channel.sent.map((s) => s.message);
    expect(messages.map((m) => m.title)).toEqual([
      "Lab report is due in 7 days (Thu, Nov 19)",
      // Exams get the earlier, two-week reminder; homework due the same day does not.
      "Midterm is in 14 days (Thu, Nov 26)",
    ]);
    expect(messages[0].body).toBe("Biology 101 · About 3 h of work. A little today keeps it light.");
    expect(messages[0].url).toBe("/app/ws1?page=home&db=db1&row=r1");
    expect(messages[1].body).toBe("History 210. Short reviews now beat cramming later.");
  });

  it("never reminds about work marked done", async () => {
    await run(DEADLINES);
    expect(channel.sent.some((s) => s.message.title.includes("Essay outline"))).toBe(false);
  });

  it("folds three or more reminders at once into one notification", async () => {
    store.workspaces.set("u1", [
      semester([
        { id: "a", title: "Lab A", due: addDays(TODAY, 2) },
        { id: "b", title: "Lab B", due: addDays(TODAY, 2) },
        { id: "c", title: "Lab C", due: addDays(TODAY, 7) },
      ]),
    ]);
    await run(DEADLINES);
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0].message).toMatchObject({
      title: "3 deadlines coming up",
      body: "Lab A (Sat, Nov 14), Lab B (Sat, Nov 14) and 1 more",
      url: "/app",
    });
    // All three are recorded, one counts as a notification.
    expect(store.logs.filter((l) => l.kind === "deadline")).toHaveLength(3);
    expect(store.logs.filter((l) => l.message)).toHaveLength(1);
  });

  it("loads the student's workspaces only at their own moments", async () => {
    await run("2026-11-12T12:00:00Z"); // nothing due at 13:00 Berlin
    expect(store.workspaceLoads).toBe(0);
    await run(DEADLINES);
    expect(store.workspaceLoads).toBe(1);
  });
});

describe("never nagging", () => {
  it("sends nothing in quiet hours, and moves a morning note to their end", async () => {
    student("u1", { quietStart: 6 * 60, quietEnd: 9 * 60, deadlineEnabled: false, streakEnabled: false });
    store.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    await run(DAILY); // 08:00 Berlin, inside 06:00-09:00
    expect(channel.sent).toHaveLength(0);
    expect(store.users.get("u1")!.nextCheckAt?.toISOString()).toBe("2026-11-12T08:00:00.000Z");
    await run("2026-11-12T08:00:00Z"); // 09:00 Berlin
    expect(channel.sent).toHaveLength(1);
  });

  it("holds a late run back once quiet hours have started", async () => {
    student("u1", { dailyMinute: 21 * 60 + 50, deadlineEnabled: false, streakEnabled: false });
    store.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    await run("2026-11-12T21:10:00Z"); // 22:10 Berlin: due 20 minutes ago, but now quiet
    expect(channel.sent).toHaveLength(0);
  });

  it("stops at the daily cap", async () => {
    student();
    store.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    for (let i = 0; i < DAILY_CAP; i++) {
      store.logs.push({ id: `old${i}`, userId: "u1", dedupeKey: `k${i}`, kind: "deadline", localDate: TODAY, message: true, status: "sent" });
    }
    await run(DAILY);
    expect(channel.sent).toHaveLength(0);
  });

  it("never sends more than the cap in one day, whatever is due", async () => {
    student("u1", { deadlineLeads: [1, 2, 3, 5, 7, 14] });
    store.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    store.days.set("u1", [addDays(TODAY, -2), addDays(TODAY, -1)]);
    store.workspaces.set("u1", [
      semester([
        { id: "a", title: "A", due: addDays(TODAY, 1) },
        { id: "b", title: "B", due: addDays(TODAY, 2) },
      ]),
    ]);
    for (const time of [DAILY, DEADLINES, STREAK]) await run(time);
    expect(channel.sent.length).toBeLessThanOrEqual(DAILY_CAP);
    expect(channel.sent.map((s) => s.message.kind)).toEqual(["daily", "deadline", "deadline", "streak"]);
  });

  it("does not repeat a reminder when the dispatch runs again", async () => {
    student();
    store.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    await run(DAILY);
    store.users.get("u1")!.nextCheckAt = new Date(0); // as if a stale tick saw the student due again
    await run("2026-11-12T07:05:00Z");
    expect(channel.sent).toHaveLength(1);
  });

  it("sends each reminder once when two runs overlap", async () => {
    for (const id of ["u1", "u2", "u3"]) {
      student(id);
      store.plans.set(id, [planItem({ id: "a", title: "x" })]);
    }
    const [a, b] = await Promise.all([run(DAILY), run(DAILY)]);
    expect(channel.sent).toHaveLength(3);
    expect(a.users + b.users).toBe(3); // the lease: each student is handled by one run
  });

  it("still sends each reminder once when leases fail and both runs handle the same students", async () => {
    store.ignoreLeases = true;
    for (const id of ["u1", "u2"]) {
      student(id);
      store.plans.set(id, [planItem({ id: "a", title: "x" })]);
      store.workspaces.set(id, [semester([{ id: "r", title: "Lab", due: addDays(TODAY, 2) }])]);
    }
    await Promise.all([run(DAILY), run(DAILY), run(DAILY)]);
    await Promise.all([run(DEADLINES), run(DEADLINES)]);
    const perUser = (id: string) => channel.sent.filter((s) => s.userId === id).map((s) => s.message.kind);
    expect(perUser("u1")).toEqual(["daily", "deadline"]);
    expect(perUser("u2")).toEqual(["daily", "deadline"]);
  });
});

describe("streak reminder", () => {
  it("is sent only when the streak would end tonight", async () => {
    student("u1");
    store.days.set("u1", [addDays(TODAY, -3), addDays(TODAY, -2), addDays(TODAY, -1)]);
    await run(STREAK);
    expect(channel.sent.map((s) => s.message.title)).toEqual(["Your 3-day streak is still open today"]);
    expect(channel.sent[0].message.body).toContain("rest day");

    student("u2");
    store.days.set("u2", [addDays(TODAY, -1), TODAY]); // already studied today
    student("u3");
    store.days.set("u3", [addDays(TODAY, -5)]); // no streak to lose
    await run(STREAK);
    expect(channel.sent).toHaveLength(1);
  });
});

describe("devices", () => {
  it("drops a student with no device left from the schedule", async () => {
    student();
    channel.devices.set("u1", 0);
    await run(DAILY);
    expect(store.users.get("u1")!.nextCheckAt).toBeNull();
    expect(channel.sent).toHaveLength(0);
  });

  it("records a reminder no device accepted as failed, without retrying it", async () => {
    student();
    store.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    channel.failing.add("u1");
    const result = await run(DAILY);
    expect(result.failed).toBe(1);
    expect(store.logs[0].status).toBe("failed");
    store.users.get("u1")!.nextCheckAt = new Date(0);
    channel.failing.clear();
    await run("2026-11-12T07:05:00Z");
    expect(channel.sent).toHaveLength(1);
  });

  it("keeps going when one student fails, and looks at that one again soon", async () => {
    student("bad");
    store.failFor.add("bad");
    store.plans.set("bad", [planItem({ id: "a", title: "x" })]);
    student("good");
    store.plans.set("good", [planItem({ id: "a", title: "x" })]);
    const result = await run(DAILY);
    expect(result.errors).toBe(1);
    expect(channel.sent.map((s) => s.userId)).toEqual(["good"]);
    expect(store.users.get("bad")!.nextCheckAt?.toISOString()).toBe("2026-11-12T07:05:00.000Z");
  });

  it("handles at most maxUsers per run; the rest stay due", async () => {
    for (let i = 0; i < 5; i++) student(`u${i}`);
    const result = await run(DAILY, { maxUsers: 3, batchSize: 2 });
    expect(result.users).toBe(3);
    const stillDue = [...store.users.values()].filter((u) => u.nextCheckAt && u.nextCheckAt <= new Date(DAILY));
    expect(stillDue).toHaveLength(2);
  });
});
