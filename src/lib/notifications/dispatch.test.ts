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

  it("checks its time budget before each student, and hands the rest of the batch back untouched", async () => {
    for (let i = 0; i < 5; i++) {
      student(`u${i}`);
      store.plans.set(`u${i}`, [planItem({ id: "a", title: "x" })]);
    }
    // Each student takes 10 "ms" (a slow mail server); the budget is 25.
    let clock = 0;
    const slow = new FakeChannel();
    for (let i = 0; i < 5; i++) slow.devices.set(`u${i}`, 1);
    const deliver = slow.deliver.bind(slow);
    slow.deliver = async (userId, message) => {
      clock += 10;
      return deliver(userId, message);
    };
    const result = await runNotificationDispatch({
      store,
      channels: [slow],
      now: at(DAILY),
      clock: () => clock,
      timeBudgetMs: 25,
      concurrency: 1,
    });
    // Three started before the budget ran out (at 0, 10, 20); two were handed back.
    expect(result).toMatchObject({ users: 3, deferred: 2, sent: 3 });
    const handedBack = ["u3", "u4"].map((id) => store.users.get(id)!);
    for (const u of handedBack) {
      // Still due, as before, and free for the next run to claim.
      expect(u.nextCheckAt).toEqual(new Date(0));
      expect(u.leaseUntil).toBeNull();
    }
    // The next tick takes them, and sends their reminders.
    const next = await runNotificationDispatch({ store, channels: [slow], now: at("2026-11-12T07:05:00Z") });
    expect(next).toMatchObject({ users: 2, sent: 2 });
  });
});

describe("weekly recap", () => {
  // Sunday 15 November 2026; 18:00 in Berlin (CET) is 17:00Z.
  const SUNDAY = "2026-11-15";
  const RECAP = "2026-11-15T17:00:00Z";
  const busyWeek = { focusMinutes: 200, cards: 210, quizAnswers: 12, activeDays: 5 };

  /** A student with only the weekly recap on (and a device). */
  function recapStudent(userId = "u1", prefs: Parameters<MemoryStore["addUser"]>[1] = {}) {
    student(userId, { dailyEnabled: false, deadlineEnabled: false, streakEnabled: false, weeklyEnabled: true, ...prefs });
  }
  const weeklySent = (userId?: string) =>
    channel.sent.filter((s) => s.message.kind === "weekly" && (!userId || s.userId === userId));

  it("arrives on the chosen local day and time, opens the insights week, and comes back a week later", async () => {
    recapStudent();
    store.weeks.set("u1", busyWeek);
    await run("2026-11-15T16:59:00Z");
    expect(channel.sent).toHaveLength(0);
    expect(store.users.get("u1")!.nextCheckAt?.toISOString()).toBe("2026-11-15T17:00:00.000Z");

    const result = await run(RECAP);
    expect(result).toMatchObject({ sent: 1 });
    expect(channel.sent[0].message).toMatchObject({
      kind: "weekly",
      title: "Your week: 3 h 20 min focused",
      body: "210 cards · 5 active days. Nice work. See the whole week in Insights.",
      url: "/app/insights?period=7d",
    });
    // The week read is the student's own 7 local days ending this Sunday.
    expect(store.weekReads).toEqual([{ userId: "u1", today: SUNDAY }]);
    expect(store.logs).toEqual([
      expect.objectContaining({ dedupeKey: `weekly:${SUNDAY}`, kind: "weekly", localDate: SUNDAY, message: true, status: "sent" }),
    ]);
    expect(store.users.get("u1")!.nextCheckAt?.toISOString()).toBe("2026-11-22T17:00:00.000Z");
  });

  it("is off for existing students, who keep exactly what they had", async () => {
    student("u1");
    store.weeks.set("u1", busyWeek);
    await run(RECAP);
    expect(weeklySent()).toHaveLength(0);
    expect(store.weekReads).toHaveLength(0);
  });

  it("follows the chosen weekday and time in the student's zone", async () => {
    // Monday 07:00 in Los Angeles (PST) is 15:00Z.
    recapStudent("u1", { timeZone: "America/Los_Angeles", weeklyDay: 1, weeklyMinute: 7 * 60 });
    store.weeks.set("u1", busyWeek);
    await run(RECAP); // Sunday in Los Angeles
    await run("2026-11-16T14:59:00Z");
    expect(channel.sent).toHaveLength(0);
    await run("2026-11-16T15:00:00Z");
    expect(weeklySent()).toHaveLength(1);
    expect(store.weekReads).toEqual([{ userId: "u1", today: "2026-11-16" }]);
  });

  it("is written in the student's language", async () => {
    recapStudent("u1", { locale: "de" });
    store.weeks.set("u1", { focusMinutes: 0, cards: 40, quizAnswers: 0, activeDays: 1 });
    await run(RECAP);
    expect(channel.sent[0].message).toMatchObject({ title: "Deine Woche: 40 Karten", lang: "de" });
  });

  it("sends nothing after a week without study, and logs it as skipped", async () => {
    recapStudent();
    const result = await run(RECAP);
    expect(channel.sent).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(store.logs).toEqual([expect.objectContaining({ kind: "weekly", status: "skipped", message: false })]);
    // Not tried again that evening.
    store.weeks.set("u1", busyWeek);
    store.users.get("u1")!.nextCheckAt = new Date(0);
    await run("2026-11-15T18:00:00Z");
    expect(channel.sent).toHaveLength(0);
  });

  it("is sent once a week, however often the dispatch looks", async () => {
    recapStudent();
    store.weeks.set("u1", busyWeek);
    await run(RECAP);
    for (const time of ["2026-11-15T17:05:00Z", "2026-11-15T19:00:00Z", "2026-11-15T20:55:00Z"]) {
      store.users.get("u1")!.nextCheckAt = new Date(0);
      await run(time);
    }
    expect(weeklySent()).toHaveLength(1);
  });

  it("is sent late the same evening when the run at its time was missed, but not after midnight", async () => {
    recapStudent("late", { quietEnabled: false });
    store.weeks.set("late", busyWeek);
    await run("2026-11-15T20:30:00Z"); // 21:30 in Berlin
    expect(weeklySent("late")).toHaveLength(1);

    recapStudent("missed", { quietEnabled: false });
    store.weeks.set("missed", busyWeek);
    await run("2026-11-15T23:30:00Z"); // 00:30 on Monday in Berlin
    expect(weeklySent("missed")).toHaveLength(0);
  });

  it("is held back once quiet hours have started", async () => {
    recapStudent();
    store.weeks.set("u1", busyWeek);
    await run("2026-11-15T21:30:00Z"); // 22:30 in Berlin, inside 22:00-07:00
    expect(channel.sent).toHaveLength(0);
    expect(store.logs[0]).toMatchObject({ kind: "weekly", status: "skipped" });
  });

  it("never comes twice in a week, even when the student moves the day", async () => {
    recapStudent();
    store.weeks.set("u1", busyWeek);
    await run(RECAP);
    // The next day they pick Monday: this Monday is too soon, next Monday is fine.
    store.users.get("u1")!.prefs.weeklyDay = 1;
    store.users.get("u1")!.nextCheckAt = new Date(0);
    await run("2026-11-16T17:00:00Z");
    expect(weeklySent()).toHaveLength(1);
    store.users.get("u1")!.nextCheckAt = new Date(0);
    await run("2026-11-23T17:00:00Z");
    expect(weeklySent()).toHaveLength(2);
  });

  it("counts toward the daily cap, and waits for a device that accepts it", async () => {
    recapStudent("capped");
    store.weeks.set("capped", busyWeek);
    for (let i = 0; i < DAILY_CAP; i++) {
      store.logs.push({ id: `old${i}`, userId: "capped", dedupeKey: `k${i}`, kind: "deadline", localDate: SUNDAY, message: true, status: "sent" });
    }
    recapStudent("nodevice");
    channel.devices.set("nodevice", 0);
    store.weeks.set("nodevice", busyWeek);
    await run(RECAP);
    expect(channel.sent).toHaveLength(0);
    expect(store.logs.filter((l) => l.kind === "weekly")).toEqual([]);
    expect(store.users.get("nodevice")!.nextCheckAt).toBeNull();
  });

  it("is sent once when overlapping runs handle the same student", async () => {
    store.ignoreLeases = true;
    recapStudent();
    store.weeks.set("u1", busyWeek);
    await Promise.all([run(RECAP), run(RECAP), run(RECAP)]);
    expect(weeklySent()).toHaveLength(1);
  });
});

describe("two channels (push and email)", () => {
  let push: FakeChannel;
  let email: FakeChannel;
  const both = (now: string, extra: Partial<Parameters<typeof runNotificationDispatch>[0]> = {}) =>
    runNotificationDispatch({ store, channels: [push, email], now: at(now), ...extra });

  beforeEach(() => {
    push = new FakeChannel("push");
    email = new FakeChannel("email");
  });

  /** A student with a device and email on. */
  function reachableTwice(userId = "u1", prefs: Parameters<MemoryStore["addUser"]>[1] = {}) {
    store.addUser(userId, { ...BERLIN, ...prefs });
    push.devices.set(userId, 1);
    email.devices.set(userId, 1);
  }

  it("claims each reminder once and sends it on both, with one log row that counts once", async () => {
    reachableTwice();
    store.plans.set("u1", [planItem({ id: "a", title: "Lab report draft" })]);
    const result = await both(DAILY);
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(push.sent.map((s) => s.message.title)).toEqual(email.sent.map((s) => s.message.title));
    expect(push.sent).toHaveLength(1);
    expect(store.logs).toEqual([expect.objectContaining({ dedupeKey: `daily:${TODAY}`, status: "sent", message: true })]);
    expect(await store.countMessages("u1", TODAY)).toBe(1);
  });

  it("never sends more than the cap in a day, counting a reminder on both channels once", async () => {
    reachableTwice("u1", { deadlineLeads: [1, 2, 3, 5, 7, 14] });
    store.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    store.days.set("u1", [addDays(TODAY, -2), addDays(TODAY, -1)]);
    store.workspaces.set("u1", [
      semester([
        { id: "a", title: "A", due: addDays(TODAY, 1) },
        { id: "b", title: "B", due: addDays(TODAY, 2) },
      ]),
    ]);
    for (const time of [DAILY, DEADLINES, STREAK]) await both(time);
    // The same four as with one channel: each went out twice, and counts once.
    expect(push.sent.map((s) => s.message.kind)).toEqual(["daily", "deadline", "deadline", "streak"]);
    expect(email.sent.map((s) => s.message.kind)).toEqual(["daily", "deadline", "deadline", "streak"]);
    expect(await store.countMessages("u1", TODAY)).toBe(DAILY_CAP);
  });

  it("does not repeat a reminder on the next run because one channel failed", async () => {
    reachableTwice();
    store.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    email.failing.add("u1");
    await both(DAILY);
    store.users.get("u1")!.nextCheckAt = new Date(0);
    email.failing.clear();
    await both("2026-11-12T07:05:00Z");
    expect(push.sent).toHaveLength(1);
    expect(email.sent).toHaveLength(1);
    expect(store.logs).toEqual([expect.objectContaining({ status: "sent" })]);
  });

  it("still emails when push breaks, and still pushes when email breaks", async () => {
    reachableTwice("pushBroken");
    reachableTwice("emailBroken");
    for (const id of ["pushBroken", "emailBroken"]) store.plans.set(id, [planItem({ id: "a", title: "x" })]);
    push.throwing.add("pushBroken");
    email.throwing.add("emailBroken");
    const result = await both(DAILY);
    expect(result).toMatchObject({ sent: 2, failed: 0, errors: 0 });
    expect(email.sent.map((s) => s.userId).sort()).toEqual(["emailBroken", "pushBroken"]);
    expect(store.logs.every((l) => l.status === "sent")).toBe(true);
  });

  it("records a reminder no channel accepted as failed (one row), without retrying it", async () => {
    reachableTwice();
    store.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    push.failing.add("u1");
    email.throwing.add("u1");
    const result = await both(DAILY);
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(store.logs).toEqual([expect.objectContaining({ status: "failed" })]);
    // A failed reminder does not count toward the cap.
    expect(await store.countMessages("u1", TODAY)).toBe(0);
  });

  it("reaches a student by email alone, without any device", async () => {
    store.addUser("u1", BERLIN);
    email.devices.set("u1", 1);
    store.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    await both(DAILY);
    expect(push.sent).toHaveLength(0);
    expect(email.sent).toHaveLength(1);
    expect(store.users.get("u1")!.nextCheckAt?.toISOString()).toBe("2026-11-12T17:00:00.000Z");
  });

  it("looks again in a few minutes when email cannot be checked right now (Clerk down), and sends then", async () => {
    store.addUser("u1", BERLIN);
    email.waiting.set("u1", "retry");
    store.plans.set("u1", [planItem({ id: "a", title: "x" })]);
    await both(DAILY);
    expect(email.sent).toHaveLength(0);
    expect(store.logs).toHaveLength(0);
    expect(store.users.get("u1")!.nextCheckAt?.toISOString()).toBe("2026-11-12T07:05:00.000Z");
    // Clerk is back: the reminder is still due, and goes out.
    email.waiting.delete("u1");
    email.devices.set("u1", 1);
    await both("2026-11-12T07:05:00Z");
    expect(email.sent).toHaveLength(1);
  });

  it("keeps the schedule of a student whose address is still being verified, and drops one with nothing on", async () => {
    store.addUser("verifying", BERLIN);
    email.waiting.set("verifying", "wait");
    store.addUser("nothing", BERLIN);
    store.plans.set("verifying", [planItem({ id: "a", title: "x" })]);
    await both(DAILY);
    expect(email.sent).toHaveLength(0);
    expect(store.users.get("verifying")!.nextCheckAt?.toISOString()).toBe("2026-11-12T17:00:00.000Z");
    expect(store.users.get("nothing")!.nextCheckAt).toBeNull();
  });
});
