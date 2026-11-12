import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LOCALES } from "@/lib/i18n/config";
import {
  examCountdownLabel,
  formatDuration,
  itemHref,
  itemNotes,
  itemReason,
  itemTitle,
  kindLabel,
  runSummaryText,
  workloadText,
} from "./present";
import { REASON_CODES, type DailyStudyPlanItem, type ReasonCode } from "./types";

function item(code: ReasonCode, overrides: Partial<DailyStudyPlanItem> = {}): DailyStudyPlanItem {
  const kind: DailyStudyPlanItem["kind"] =
    code === "cards_due" || code === "new_cards"
      ? "flashcards"
      : code.startsWith("exam")
        ? "exam"
        : code === "open_task"
          ? "task"
          : "deadline";
  return {
    id: `${code}-item`,
    kind,
    mode: kind === "flashcards" ? "study" : "session",
    title: "Kapitel 3",
    workspaceName: "HQ",
    section: "Biology",
    target: { workspaceId: "ws", pageId: "p", blockId: "b" },
    minutes: 25,
    reason: { code, days: 4, count: 12, examTitle: "Bio midterm", effortMinutes: 150 },
    dueDate: "2026-11-16",
    weight: 20,
    carry: { from: "2026-11-10", count: 1 },
    completed: false,
    ...overrides,
  };
}

const KINDS: DailyStudyPlanItem["kind"][] = ["deadline", "exam", "flashcards", "quiz", "task"];

describe("plan text is rendered in the student's language", () => {
  const english = getDictionary("en").today;

  for (const { code: locale } of LOCALES) {
    it(`renders every reason and item kind in ${locale}`, () => {
      const T = getDictionary(locale).today;
      for (const code of REASON_CODES) {
        const text = itemReason(item(code), T, locale);
        expect(text, `${locale} ${code}`).not.toMatch(/\{\w+\}/);
        expect(text.length).toBeGreaterThan(3);
        if (locale !== "en") {
          expect(text, `${locale} ${code} must be translated`).not.toBe(
            itemReason(item(code), english, "en"),
          );
        }
      }
      for (const kind of KINDS) {
        const it = item("due_soon", { kind });
        expect(kindLabel(it, T)).toBeTruthy();
        expect(itemTitle(it, T)).toContain("Kapitel 3");
        expect(itemTitle(it, T)).not.toMatch(/\{\w+\}/);
      }
      for (const note of itemNotes(item("due_soon"), T, locale)) expect(note).not.toMatch(/\{\w+\}/);
      const w = workloadText(
        { overloaded: true, days: 4, neededMinutes: 400, availableMinutes: 180, startToday: ["Essay"] },
        T,
      );
      expect(`${w.title} ${w.body} ${w.start}`).not.toMatch(/\{\w+\}/);
      expect(w.start).toContain("Essay");
      expect(runSummaryText({ v: 2, items: 3, minutes: 75, workspaces: 1 }, T)).not.toMatch(/\{\w+\}/);
    });
  }

  it("changes the words, never the student's own titles, when the language changes", () => {
    const de = getDictionary("de").today;
    const en = getDictionary("en").today;
    const deck = item("cards_due", { kind: "flashcards", title: "Zellbiologie" });
    expect(itemTitle(deck, en)).toBe("Review Zellbiologie");
    expect(itemTitle(deck, de)).toBe("Zellbiologie wiederholen");
    expect(itemReason(deck, en, "en")).toBe("12 cards are ready for review.");
    expect(itemReason(deck, de, "de")).toBe("12 Karten sind zum Wiederholen bereit.");
  });

  it("formats durations and countdowns", () => {
    const en = getDictionary("en").today;
    expect(formatDuration(25, en)).toBe("25 min");
    expect(formatDuration(60, en)).toBe("1 h");
    expect(formatDuration(95, en)).toBe("1 h 35 min");
    expect(formatDuration(118, en)).toBe("2 h");
    const exam = { id: "e", title: "Bio", workspaceName: "HQ", date: "2026-11-20", major: false, target: { workspaceId: "ws" } };
    expect(examCountdownLabel({ ...exam, days: 0 }, en)).toBe("today");
    expect(examCountdownLabel({ ...exam, days: 1 }, en)).toBe("tomorrow");
    expect(examCountdownLabel({ ...exam, days: 8 }, en)).toBe("in 8 days");
  });

  it("builds deep links from the stored target", () => {
    expect(itemHref(item("open_task"))).toBe("/app/ws?page=p&block=b");
    expect(
      itemHref(item("due_today", { target: { workspaceId: "ws", pageId: "p", databaseId: "d", rowId: "r" } })),
    ).toBe("/app/ws?page=p&db=d&row=r");
  });
});
