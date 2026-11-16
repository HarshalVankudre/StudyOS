import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LOCALES } from "@/lib/i18n/config";
import {
  PUSH_PAYLOAD_BUDGET,
  dailyPlanMessage,
  deadlineMessage,
  pushPayload,
  WEEKLY_RECAP_URL,
  streakMessage,
  topicFor,
  weeklyRecapMessage,
  type DeadlineReminder,
  type WeeklyRecap,
} from "./content";
import { deadlineRemindersFor } from "./reminders";
import { MAX_PAYLOAD_BYTES } from "./webpush";
import { planItem, semester } from "./test-fakes";

const reminder: DeadlineReminder = {
  key: "deadline:ws1:db1:r1:2026-11-13:1",
  title: "Lab report",
  context: "Biology 101",
  dueDate: "2026-11-13",
  daysLeft: 1,
  exam: false,
  effortMinutes: 90,
  target: { workspaceId: "ws1", pageId: "home", databaseId: "db1", rowId: "r1" },
};

describe("notification text", () => {
  it("is written in every language, with the student's own titles untouched", () => {
    for (const { code, dir } of LOCALES) {
      const dict = getDictionary(code);
      const m = deadlineMessage(reminder, dict, code);
      expect(m.title, code).toContain("Lab report");
      expect(m.body, code).toContain("Biology 101");
      expect(m.title, code).not.toMatch(/\{\w+\}/);
      expect(m.body, code).not.toMatch(/\{\w+\}/);
      expect(m.dir).toBe(dir);
      expect(m.lang).toBe(code);
    }
  });

  it("says when, for which course, and how long, kindly", () => {
    const dict = getDictionary("en");
    expect(deadlineMessage(reminder, dict, "en")).toMatchObject({
      title: "Lab report is due tomorrow",
      body: "Biology 101 · About 1 h 30 min of work. A little today keeps it light.",
      url: "/app/ws1?page=home&db=db1&row=r1",
    });
    const exam = deadlineMessage({ ...reminder, exam: true, daysLeft: 7, dueDate: "2026-11-19", effortMinutes: null }, dict, "en");
    expect(exam.title).toBe("Lab report is in 7 days (Thu, Nov 19)");
    expect(streakMessage(5, dict, "en").title).toBe("Your 5-day streak is still open today");
  });

  it("opens the first open item of today's plan", () => {
    const dict = getDictionary("ar");
    const m = dailyPlanMessage(
      [planItem({ id: "a", title: "مراجعة", startHere: true, target: { workspaceId: "w 1", pageId: "p", blockId: "b" } })],
      "2026-11-12",
      dict,
      "ar",
    );
    expect(m?.url).toBe("/app/w%201?page=p&block=b");
    expect(m?.dir).toBe("rtl");
    expect(dailyPlanMessage([], "2026-11-12", dict, "ar")).toBeNull();
  });

  it("stays small enough for one push record even with long titles", () => {
    const long = "x".repeat(5000);
    const m = deadlineMessage({ ...reminder, title: long, context: long }, getDictionary("en"), "en");
    expect(m.title.length).toBeLessThanOrEqual(120);
    expect(m.body.length).toBeLessThanOrEqual(300);
    expect(Buffer.byteLength(pushPayload(m))).toBeLessThan(MAX_PAYLOAD_BYTES);
    expect(topicFor(m.tag)).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });

  it("falls back to a short link when very long page or row ids would make it too big", () => {
    const id = "😀".repeat(2_000);
    const m = deadlineMessage(
      { ...reminder, target: { workspaceId: id, pageId: id, databaseId: id, rowId: id } },
      getDictionary("en"),
      "en",
    );
    expect(m.url.length).toBeGreaterThan(PUSH_PAYLOAD_BUDGET);
    const payload = pushPayload(m);
    expect(Buffer.byteLength(payload)).toBeLessThanOrEqual(PUSH_PAYLOAD_BUDGET);
    expect(JSON.parse(payload)).toMatchObject({ title: m.title, body: m.body, url: "/app" });
    // A normal message keeps its deep link.
    expect(JSON.parse(pushPayload(deadlineMessage(reminder, getDictionary("en"), "en"))).url).not.toBe("/app");
  });

  it("never exceeds the budget even for a message built by hand", () => {
    const m = { ...deadlineMessage(reminder, getDictionary("en"), "en"), title: "😀".repeat(5_000), url: "/x".repeat(3_000) };
    expect(Buffer.byteLength(pushPayload(m))).toBeLessThanOrEqual(PUSH_PAYLOAD_BUDGET);
  });
});

describe("deadline reminders", () => {
  const ws = semester([
    { id: "r1", title: "Lab report", due: "2026-11-19", course: "bio" },
    { id: "r2", title: "Old essay", due: "2026-11-19", done: true },
    { id: "r3", title: "Final", due: "2026-11-26", exam: true },
    { id: "r4", title: "Late", due: "2026-11-10" },
    { id: "r5", title: "Today", due: "2026-11-12" },
  ]);

  it("uses the planner's rules for done and exam, and only the chosen leads", () => {
    const found = deadlineRemindersFor([ws], "2026-11-12", { deadlineLeads: [7, 2, 1], examLeads: [14, 7, 2, 1] });
    expect(found.map((r) => [r.title, r.daysLeft, r.exam])).toEqual([
      ["Lab report", 7, false],
      ["Final", 14, true],
    ]);
    expect(found[0].key).toBe("deadline:ws1:db1:r1:2026-11-19:7");
    expect(deadlineRemindersFor([ws], "2026-11-12", { deadlineLeads: [], examLeads: [] })).toEqual([]);
  });

  it("reminds a formality 7, 3 and 1 days before, on top of the chosen leads, never as an exam", () => {
    const fristen = semester([
      { id: "anm", title: "Prüfungsanmeldung Biologie", due: "2027-01-10", course: "bio", hours: 2 },
      // Filed as an exam, but its title says it is the registration.
      { id: "reg", title: "Exam registration closes", due: "2027-01-10", exam: true },
    ]);
    const leads = { deadlineLeads: [2], examLeads: [14, 7, 2, 1] };
    const on = (day: string) => deadlineRemindersFor([fristen], day, leads);
    for (const [day, days] of [["2027-01-03", 7], ["2027-01-07", 3], ["2027-01-08", 2], ["2027-01-09", 1]] as const) {
      const found = on(day);
      expect(found.map((r) => r.title).sort(), day).toEqual(["Exam registration closes", "Prüfungsanmeldung Biologie"]);
      for (const r of found) {
        expect(r, day).toMatchObject({ daysLeft: days, exam: false, formality: true, effortMinutes: null });
        expect(r.key).toBe(`deadline:ws1:db1:${r.key.split(":")[3]}:2027-01-10:${days}`);
      }
    }
    for (const day of ["2026-12-27", "2027-01-04", "2027-01-05", "2027-01-06"]) expect(on(day), day).toEqual([]);
    // No assignment reminders wanted: no formality reminders either.
    expect(deadlineRemindersFor([fristen], "2027-01-07", { deadlineLeads: [], examLeads: [14, 7, 3, 1] })).toEqual([]);
  });

  it("words a formality as a closing deadline, not as work or an exam", () => {
    const frist: DeadlineReminder = {
      ...reminder,
      title: "Prüfungsanmeldung",
      context: "Analysis I",
      daysLeft: 3,
      dueDate: "2027-01-10",
      formality: true,
      effortMinutes: null,
    };
    const de = deadlineMessage(frist, getDictionary("de"), "de");
    expect(de.title).toBe("Frist endet in 3 Tagen: Prüfungsanmeldung (So., 10. Jan.)");
    expect(de.body).toBe("Analysis I. Eine Frist, keine Lernarbeit: ein paar Minuten, nachholen lässt sie sich aber nicht.");
    expect(deadlineMessage({ ...frist, daysLeft: 1 }, getDictionary("de"), "de").title).toBe("Frist endet morgen: Prüfungsanmeldung");
    const en = deadlineMessage(frist, getDictionary("en"), "en");
    expect(en.title).toBe("Prüfungsanmeldung closes in 3 days (Sun, Jan 10)");
    expect(en.body).toBe("Analysis I. An administrative deadline, not coursework: a few minutes, and it can’t be made up afterwards.");
    for (const { code } of LOCALES) {
      const dict = getDictionary(code);
      for (const daysLeft of [1, 3, 7]) {
        const m = deadlineMessage({ ...frist, daysLeft }, dict, code);
        expect(m.title, code).toContain("Prüfungsanmeldung");
        expect(`${m.title} ${m.body}`, code).not.toMatch(/\{\w+\}/);
        expect(m.title, code).not.toBe(deadlineMessage({ ...frist, daysLeft, formality: false, exam: true }, dict, code).title);
        expect(m.body, code).not.toContain(dict.notifications.msgExamNudge);
      }
    }
  });

  it("gives a new key when the due date moves, so the new date is reminded too", () => {
    const moved = semester([{ id: "r1", title: "Lab report", due: "2026-11-20" }]);
    const [r] = deadlineRemindersFor([moved], "2026-11-13", { deadlineLeads: [7], examLeads: [] });
    expect(r.key).toBe("deadline:ws1:db1:r1:2026-11-20:7");
  });
});

describe("weekly recap text", () => {
  const SUNDAY = "2026-11-15";
  const week = (o: Partial<WeeklyRecap> = {}): WeeklyRecap => ({
    focusMinutes: 200,
    cards: 210,
    quizAnswers: 12,
    activeDays: 5,
    ...o,
  });
  const en = getDictionary("en");

  it("leads with focus time, then cards, and always says how many days were active", () => {
    expect(weeklyRecapMessage(week(), SUNDAY, en, "en")).toMatchObject({
      kind: "weekly",
      title: "Your week: 3 h 20 min focused",
      body: "210 cards · 5 active days. Nice work. See the whole week in Insights.",
      url: "/app/insights?period=7d",
      tag: "weekly-2026-11-15",
      lang: "en",
      dir: "ltr",
    });
    expect(WEEKLY_RECAP_URL).toBe("/app/insights?period=7d");
  });

  it("leads with cards when there was no focus time, else quiz answers", () => {
    expect(weeklyRecapMessage(week({ focusMinutes: 0 }), SUNDAY, en, "en")).toMatchObject({
      title: "Your week: 210 cards",
      body: "12 quiz answers · 5 active days. Nice work. See the whole week in Insights.",
    });
    expect(weeklyRecapMessage(week({ focusMinutes: 0, cards: 0, quizAnswers: 1, activeDays: 1 }), SUNDAY, en, "en")).toMatchObject({
      title: "Your week: 1 quiz answer",
      body: "1 active day. Nice work. See the whole week in Insights.",
    });
    expect(weeklyRecapMessage(week({ focusMinutes: 45, cards: 0, quizAnswers: 0, activeDays: 1 }), SUNDAY, en, "en")?.title).toBe(
      "Your week: 45 min focused",
    );
    expect(weeklyRecapMessage(week({ cards: 1 }), SUNDAY, en, "en")?.body).toMatch(/^1 card · 5 active days\./);
  });

  it("says nothing after a week without any study", () => {
    expect(weeklyRecapMessage(week({ focusMinutes: 0, cards: 0, quizAnswers: 0, activeDays: 0 }), SUNDAY, en, "en")).toBeNull();
    expect(weeklyRecapMessage(week({ activeDays: 0 }), SUNDAY, en, "en")).toBeNull();
    expect(weeklyRecapMessage(week({ focusMinutes: 0, cards: 0, quizAnswers: 0 }), SUNDAY, en, "en")).toBeNull();
    // Damaged numbers count as nothing, never as "NaN cards".
    expect(weeklyRecapMessage(week({ focusMinutes: Number.NaN, cards: -3, quizAnswers: 0, activeDays: 2 }), SUNDAY, en, "en")).toBeNull();
  });

  it("is written in every language, kindly, and fits a push record", () => {
    for (const { code, dir } of LOCALES) {
      const dict = getDictionary(code);
      for (const w of [week(), week({ focusMinutes: 0 }), week({ focusMinutes: 0, cards: 0, quizAnswers: 3, activeDays: 2 })]) {
        const m = weeklyRecapMessage(w, SUNDAY, dict, code);
        expect(m, code).not.toBeNull();
        expect(m!.title, code).not.toMatch(/\{\w+\}/);
        expect(m!.body, code).not.toMatch(/\{\w+\}/);
        expect(`${m!.title} ${m!.body}`, code).not.toMatch(/!|！/);
        expect(m!).toMatchObject({ lang: code, dir, url: "/app/insights?period=7d" });
        expect(Buffer.byteLength(pushPayload(m!)), code).toBeLessThanOrEqual(PUSH_PAYLOAD_BUDGET);
        expect(JSON.parse(pushPayload(m!)).url, code).toBe("/app/insights?period=7d");
      }
    }
  });

  it("uses each language's own words and plural forms", () => {
    expect(weeklyRecapMessage(week(), SUNDAY, getDictionary("de"), "de")).toMatchObject({
      title: "Deine Woche: 3 Std. 20 Min. Fokuszeit",
      body: "210 Karten · 5 aktive Tage. Gut gemacht. Die ganze Woche siehst du unter Einblicke.",
    });
    const ar = getDictionary("ar");
    expect(weeklyRecapMessage(week({ focusMinutes: 0, cards: 2, quizAnswers: 0, activeDays: 1 }), SUNDAY, ar, "ar")).toMatchObject({
      title: "أسبوعك: بطاقتان",
      body: "يوم نشط واحد. أحسنت. شاهد الأسبوع كاملًا في الرؤى.",
      dir: "rtl",
    });
    expect(weeklyRecapMessage(week({ focusMinutes: 0, cards: 4, quizAnswers: 0, activeDays: 3 }), SUNDAY, ar, "ar")?.title).toBe(
      "أسبوعك: 4 بطاقات",
    );
    expect(weeklyRecapMessage(week({ focusMinutes: 0 }), SUNDAY, getDictionary("ja"), "ja")?.title).toBe("今週のまとめ：カード 210 枚");
  });
});
