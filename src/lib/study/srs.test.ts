import { describe, expect, it } from "vitest";
import type { Flashcard } from "@/lib/workspace/types";
import {
  deckStats,
  dueQueue,
  isDue,
  isNew,
  isoDay,
  reviewCard,
  type Grade,
} from "./srs";

const NOW = new Date("2026-07-03T10:00:00Z");
function card(overrides: Partial<Flashcard> = {}): Flashcard {
  return { id: "c1", front: "Q", back: "A", ...overrides };
}

describe("isNew / isDue", () => {
  it("treats an ungraded card as new and due", () => {
    const c = card();
    expect(isNew(c)).toBe(true);
    expect(isDue(c, NOW)).toBe(true);
  });

  it("a card due in the future is not due", () => {
    const c = card({ reps: 2, dueAt: "2026-07-10", intervalDays: 7 });
    expect(isNew(c)).toBe(false);
    expect(isDue(c, NOW)).toBe(false);
  });

  it("a card due today or earlier is due", () => {
    expect(isDue(card({ reps: 1, dueAt: "2026-07-03" }), NOW)).toBe(true);
    expect(isDue(card({ reps: 1, dueAt: "2026-07-01" }), NOW)).toBe(true);
  });
});

describe("reviewCard", () => {
  it("does not mutate its input", () => {
    const c = card();
    const out = reviewCard(c, "good", NOW);
    expect(c.reps).toBeUndefined();
    expect(out).not.toBe(c);
  });

  it("first 'good' schedules one day out and sets lastReviewedAt", () => {
    const out = reviewCard(card(), "good", NOW);
    expect(out.reps).toBe(1);
    expect(out.intervalDays).toBe(1);
    expect(out.dueAt).toBe("2026-07-04");
    expect(out.lastReviewedAt).toBe(NOW.toISOString());
  });

  it("second 'good' schedules three days out", () => {
    const first = reviewCard(card(), "good", NOW);
    const second = reviewCard(first, "good", new Date("2026-07-04T10:00:00Z"));
    expect(second.reps).toBe(2);
    expect(second.intervalDays).toBe(3);
  });

  it("mature intervals grow by the ease factor on 'good'", () => {
    const c = card({ reps: 3, intervalDays: 10, ease: 2.5 });
    const out = reviewCard(c, "good", NOW);
    expect(out.intervalDays).toBe(25); // 10 * 2.5
  });

  it("'again' resets reps/interval and lowers ease, re-queuing same day", () => {
    const c = card({ reps: 4, intervalDays: 30, ease: 2.5 });
    const out = reviewCard(c, "again", NOW);
    expect(out.reps).toBe(0);
    expect(out.intervalDays).toBe(0);
    expect(out.ease).toBeCloseTo(2.3, 5);
    expect(out.dueAt).toBe(isoDay(NOW)); // due again today
    expect(isDue(out, NOW)).toBe(true);
  });

  it("'easy' grows ease and schedules further than 'good'", () => {
    const good = reviewCard(card(), "good", NOW);
    const easy = reviewCard(card(), "easy", NOW);
    expect(easy.intervalDays).toBeGreaterThan(good.intervalDays!);
    expect(easy.ease!).toBeGreaterThan(2.5);
  });

  it("never lets ease fall below the 1.3 floor", () => {
    let c = card({ ease: 1.35 });
    for (let i = 0; i < 5; i++) c = reviewCard(c, "again", NOW);
    expect(c.ease).toBeGreaterThanOrEqual(1.3);
  });

  it("'hard' lowers ease but still advances reps", () => {
    const c = card({ reps: 2, intervalDays: 5, ease: 2.5 });
    const out = reviewCard(c, "hard", NOW);
    expect(out.reps).toBe(3);
    expect(out.ease!).toBeLessThan(2.5);
    expect(out.intervalDays).toBeGreaterThanOrEqual(5);
  });
});

describe("deckStats", () => {
  it("counts new, learning, mature, and due", () => {
    const cards: Flashcard[] = [
      card({ id: "new1" }),
      card({ id: "new2" }),
      card({ id: "learn", reps: 1, intervalDays: 3, dueAt: "2026-07-20" }),
      card({ id: "mature", reps: 6, intervalDays: 40, dueAt: "2026-08-01" }),
      card({ id: "duept", reps: 2, intervalDays: 5, dueAt: "2026-07-01" }),
    ];
    const s = deckStats(cards, NOW);
    expect(s.total).toBe(5);
    expect(s.new).toBe(2);
    expect(s.learning).toBe(2); // learn + duept (both interval < 21)
    expect(s.mature).toBe(1);
    expect(s.due).toBe(3); // two new + one past-due
  });
});

describe("dueQueue", () => {
  it("returns due cards with new cards ordered last", () => {
    const cards: Flashcard[] = [
      card({ id: "new1" }),
      card({ id: "review", reps: 2, intervalDays: 5, dueAt: "2026-07-01" }),
      card({ id: "future", reps: 2, intervalDays: 5, dueAt: "2026-09-01" }),
    ];
    const q = dueQueue(cards, NOW);
    expect(q.map((c) => c.id)).toEqual(["review", "new1"]);
  });
});

describe("full lifecycle", () => {
  it("a card graded 'good' repeatedly leaves the due queue and matures", () => {
    let c = card();
    let now = NOW;
    const grades: Grade[] = ["good", "good", "good", "good"];
    for (const g of grades) {
      c = reviewCard(c, g, now);
      now = new Date(`${c.dueAt}T10:00:00Z`); // jump to when it's next due
    }
    expect(c.reps).toBe(4);
    expect(c.intervalDays).toBeGreaterThanOrEqual(7);
    // Not due the day before its scheduled dueAt (day-granular scheduling).
    const dayBefore = new Date(`${c.dueAt}T10:00:00Z`);
    dayBefore.setDate(dayBefore.getDate() - 1);
    expect(isDue(c, dayBefore)).toBe(false);
  });
});
