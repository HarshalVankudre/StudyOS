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

describe("formality strings are complete in every language", () => {
  const KEYS = {
    today: ["kindFormality", "reasonFormalityOverdue", "reasonFormalityToday", "reasonFormalityTomorrow", "reasonFormalitySoon"],
    agenda: ["kindFormality"],
    notifications: ["msgFormalityTomorrow", "msgFormalityIn", "msgFormalityNudge"],
  } as const;
  const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
  const forms = (value: unknown): Record<string, string> =>
    typeof value === "string" ? { other: value } : (value as Record<string, string>);

  for (const code of LOCALES.map((l) => l.code)) {
    it(`has every new string in ${code}, with the English placeholders`, () => {
      const dict = getDictionary(code) as unknown as Record<string, Record<string, unknown>>;
      const en = getDictionary("en") as unknown as Record<string, Record<string, unknown>>;
      for (const [section, keys] of Object.entries(KEYS)) {
        for (const key of keys) {
          const value = dict[section][key];
          expect(value, `${code} ${section}.${key}`).toBeDefined();
          const want = placeholders(forms(en[section][key]).other);
          const own = forms(value);
          expect(typeof own.other, `${code} ${section}.${key}`).toBe("string");
          expect(placeholders(own.other), `${code} ${section}.${key}`).toEqual(want);
          // Other plural forms may spell the number out ("يومين"), never add a placeholder.
          for (const form of Object.values(own)) {
            for (const p of placeholders(form)) expect(want, `${code} ${section}.${key}: ${p}`).toContain(p);
          }
        }
      }
    });
  }
});

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
        locale,
      );
      expect(`${w.title} ${w.body} ${w.start}`).not.toMatch(/\{\w+\}/);
      expect(w.start).toContain("Essay");
      expect(runSummaryText({ v: 2, items: 3, minutes: 75, workspaces: 1 }, T, locale)).not.toMatch(/\{\w+\}/);
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
    expect(examCountdownLabel({ ...exam, days: 0 }, en, "en")).toBe("today");
    expect(examCountdownLabel({ ...exam, days: 1 }, en, "en")).toBe("tomorrow");
    expect(examCountdownLabel({ ...exam, days: 8 }, en, "en")).toBe("in 8 days");
  });

  it("uses each language's plural forms for counts", () => {
    const en = getDictionary("en").today;
    const ar = getDictionary("ar").today;
    const one = item("cards_due", { kind: "flashcards", reason: { code: "cards_due", count: 1 } });
    expect(itemReason(one, en, "en")).toBe("1 card is ready for review.");
    const two = item("cards_due", { kind: "flashcards", reason: { code: "cards_due", count: 2 } });
    expect(itemReason(two, ar, "ar")).toBe("بطاقتان جاهزتان للمراجعة.");
    const soon = item("due_soon", { reason: { code: "due_soon", days: 3 } });
    expect(itemReason(soon, en, "en")).toBe("Due in 3 days. Starting early keeps it small.");
    expect(runSummaryText({ v: 2, items: 1, minutes: 25, workspaces: 1 }, en, "en")).toBe("Planned 1 item · 25 min");
    expect(workloadText({ overloaded: true, days: 1, neededMinutes: 90, availableMinutes: 60, startToday: [] }, en, "en").title)
      .toBe("Heads-up: the next day is full");
  });

  it("words an administrative deadline as a Frist that closes, not as work", () => {
    const de = getDictionary("de").today;
    const en = getDictionary("en").today;
    const frist = (code: ReasonCode, days: number) =>
      item(code, { title: "Prüfungsanmeldung", minutes: 10, reason: { code, days, effortMinutes: 10 }, dueDate: "2027-01-10" });
    expect(kindLabel(frist("formality_soon", 3), de)).toBe("Frist");
    expect(itemReason(frist("formality_soon", 3), de, "de")).toBe(
      "Frist endet in 3 Tagen. Ein paar Minuten jetzt; nachholen lässt sie sich nicht.",
    );
    expect(itemReason(frist("formality_today", 0), de, "de")).toBe(
      "Frist endet heute. Ein paar Minuten jetzt; nachholen lässt sie sich nicht.",
    );
    expect(itemReason(frist("formality_tomorrow", 1), de, "de")).toBe(
      "Frist endet morgen. Ein paar Minuten jetzt; nachholen lässt sie sich nicht.",
    );
    expect(itemReason(frist("formality_overdue", -2), de, "de")).toBe(
      "Die Frist war am 10. Jan. Schau gleich nach, ob es noch geht.",
    );
    expect(itemReason(frist("formality_soon", 3), en, "en")).toBe(
      "Closes in 3 days. A few minutes now; it can’t be made up later.",
    );
    expect(kindLabel(frist("formality_today", 0), en)).toBe("Admin deadline");
    // Never the restart note, however long it waited.
    const waited = { ...frist("formality_today", 0), carry: { from: "2027-01-06", count: 4 } };
    expect(itemNotes(waited, de, "de").join(" ")).toContain("Verschoben von");
  });

  it("labels the long days of exam season in hours", () => {
    const de = getDictionary("de").today;
    expect([180, 240, 360].map((m) => formatDuration(m, getDictionary("en").today))).toEqual(["3 h", "4 h", "6 h"]);
    for (const m of [180, 240, 360]) expect(formatDuration(m, de)).toMatch(/^\d Std\.$/);
  });

  it("builds deep links from the stored target", () => {
    expect(itemHref(item("open_task"))).toBe("/app/ws?page=p&block=b");
    expect(
      itemHref(item("due_today", { target: { workspaceId: "ws", pageId: "p", databaseId: "d", rowId: "r" } })),
    ).toBe("/app/ws?page=p&db=d&row=r");
  });
});
