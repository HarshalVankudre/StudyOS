import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LOCALES } from "@/lib/i18n/config";
import { dailyPlanMessage, deadlineMessage, pushPayload, streakMessage, topicFor, type DeadlineReminder } from "./content";
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

  it("gives a new key when the due date moves, so the new date is reminded too", () => {
    const moved = semester([{ id: "r1", title: "Lab report", due: "2026-11-20" }]);
    const [r] = deadlineRemindersFor([moved], "2026-11-13", { deadlineLeads: [7], examLeads: [] });
    expect(r.key).toBe("deadline:ws1:db1:r1:2026-11-20:7");
  });
});
