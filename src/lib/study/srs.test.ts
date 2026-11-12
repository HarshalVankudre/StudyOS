import { describe, expect, it } from "vitest";
import type { Flashcard } from "@/lib/workspace/types";
import { flashcardSchema } from "@/lib/workspace/schema";
import {
  assignSchedule,
  cardState,
  deckStats,
  dueQueue,
  isDue,
  isNew,
  isShortTerm,
  isoDay,
  memoryFromSm2,
  practiceQueue,
  previewCard,
  retrievability,
  reviewCard,
  type Grade,
} from "./srs";
import { shiftDay } from "./days";

// Local-time instants so the tests hold in every machine time zone.
const NOW = new Date(2026, 6, 3, 10, 0, 0);
const TODAY = isoDay(NOW);
function card(overrides: Partial<Flashcard> = {}): Flashcard {
  return { id: "c1", front: "Q", back: "A", ...overrides };
}
function at(day: string, hour = 10): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour);
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

  it("an explicit FSRS state wins over the legacy heuristics", () => {
    expect(isNew(card({ state: "new" }))).toBe(true);
    expect(isNew(card({ state: "review", reps: 3, dueAt: TODAY }))).toBe(false);
  });
});

describe("reviewCard (FSRS)", () => {
  it("does not mutate its input", () => {
    const c = card();
    const out = reviewCard(c, "good", NOW);
    expect(c.reps).toBeUndefined();
    expect(out).not.toBe(c);
    expect(out.front).toBe("Q");
  });

  it("a new card graded good enters a short learning step due today", () => {
    const out = reviewCard(card(), "good", NOW);
    expect(out.state).toBe("learning");
    expect(out.reps).toBe(1);
    expect(out.intervalDays).toBe(0);
    expect(out.dueAt).toBe(TODAY);
    expect(new Date(out.dueTime!).getTime() - NOW.getTime()).toBe(10 * 60_000);
    expect(out.lastReviewedAt).toBe(NOW.toISOString());
    expect(out.stability).toBeGreaterThan(0);
    expect(out.difficulty).toBeGreaterThanOrEqual(1);
    expect(isShortTerm(out)).toBe(true);
  });

  it("a new card graded easy graduates straight to days", () => {
    const out = reviewCard(card(), "easy", NOW);
    expect(out.state).toBe("review");
    expect(out.intervalDays).toBeGreaterThanOrEqual(1);
    expect(out.dueAt! > TODAY).toBe(true);
  });

  it("orders intervals again < hard < good < easy for a review card", () => {
    const c = card({ state: "review", stability: 20, difficulty: 5, reps: 5, intervalDays: 20, dueAt: TODAY, lastReviewedAt: at(shiftDay(TODAY, -20)).toISOString() });
    const p = previewCard(c, NOW);
    expect(p.again.intervalDays).toBe(0);
    expect(p.again.state).toBe("relearning");
    expect(p.again.lapses).toBe(1);
    expect(p.hard.intervalDays!).toBeLessThan(p.good.intervalDays!);
    expect(p.good.intervalDays!).toBeLessThan(p.easy.intervalDays!);
  });

  it("the preview shown on a button is exactly what grading produces", () => {
    const c = card({ id: "fuzzed", state: "review", stability: 30, difficulty: 6, reps: 4, intervalDays: 30, dueAt: TODAY, lastReviewedAt: at(shiftDay(TODAY, -30)).toISOString() });
    const p = previewCard(c, NOW);
    for (const g of ["again", "hard", "good", "easy"] as Grade[]) {
      expect(reviewCard(c, g, NOW).intervalDays).toBe(p[g].intervalDays);
    }
  });

  it("a learning card graded good again graduates to a multi-day interval", () => {
    const first = reviewCard(card(), "good", NOW);
    const second = reviewCard(first, "good", new Date(first.dueTime!));
    expect(second.state).toBe("review");
    expect(second.intervalDays!).toBeGreaterThanOrEqual(1);
    expect(isDue(second, new Date(first.dueTime!))).toBe(false);
  });

  it("produces state the workspace schema accepts", () => {
    const out = reviewCard(card(), "hard", NOW);
    expect(flashcardSchema.safeParse(out).success).toBe(true);
  });
});

describe("migration from SM-2 state", () => {
  const sm2 = (o: Partial<Flashcard>) =>
    card({ ease: 2.5, reps: 4, intervalDays: 30, dueAt: "2026-07-10", lastReviewedAt: at("2026-06-10").toISOString(), ...o });

  it("keeps an SM-2 card's due day until it is reviewed", () => {
    const c = sm2({});
    expect(cardState(c)).toBe("review");
    expect(isDue(c, NOW)).toBe(false);
    expect(isDue(c, at("2026-07-10"))).toBe(true);
    expect(deckStats([c], NOW).mature).toBe(1);
  });

  it("derives stability from the interval and difficulty from ease", () => {
    const easy = memoryFromSm2(3.0, 30);
    const normal = memoryFromSm2(2.5, 30);
    const hard = memoryFromSm2(1.3, 30);
    expect(normal.stability).toBe(30);
    expect(easy.difficulty).toBeLessThan(normal.difficulty);
    expect(normal.difficulty).toBeLessThan(hard.difficulty);
    for (const m of [easy, normal, hard]) {
      expect(m.difficulty).toBeGreaterThanOrEqual(1);
      expect(m.difficulty).toBeLessThanOrEqual(10);
    }
  });

  it("a mature SM-2 card reviewed good keeps a long interval (progress is not reset)", () => {
    const out = reviewCard(sm2({}), "good", at("2026-07-10"));
    expect(out.state).toBe("review");
    expect(out.intervalDays!).toBeGreaterThan(30);
    expect(out.reps).toBe(5);
    expect(out.stability!).toBeGreaterThan(30);
  });

  it("an SM-2 card that was failed (interval 0) continues in relearning", () => {
    const c = sm2({ reps: 0, intervalDays: 0, ease: 2.1, dueAt: TODAY });
    expect(cardState(c)).toBe("relearning");
    expect(isDue(c, NOW)).toBe(true);
    const out = reviewCard(c, "good", NOW);
    expect(out.state).toBe("review");
    expect(out.intervalDays!).toBeGreaterThanOrEqual(1);
  });

  it("an SM-2 card without lastReviewedAt infers it from due day and interval", () => {
    const c = sm2({ lastReviewedAt: undefined });
    const r = retrievability(c, at("2026-07-10"));
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.85);
    expect(r!).toBeLessThan(0.95);
  });

  it("keeps the legacy ease field untouched and adds FSRS fields", () => {
    const out = reviewCard(sm2({}), "hard", at("2026-07-10"));
    expect(out.ease).toBe(2.5);
    expect(out.stability).toBeDefined();
    expect(out.difficulty).toBeDefined();
  });
});

describe("assignSchedule", () => {
  it("copies scheduling fields but not content", () => {
    const target = card({ front: "edited", ease: 2.5 });
    const next = reviewCard(card({ front: "old" }), "easy", NOW);
    assignSchedule(target, next);
    expect(target.front).toBe("edited");
    expect(target.state).toBe("review");
    expect(target.dueAt).toBe(next.dueAt);
    expect("dueTime" in target).toBe(true);
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
    expect(s.learning).toBe(2);
    expect(s.mature).toBe(1);
    expect(s.due).toBe(3);
  });

  it("never counts a blank card as due", () => {
    const s = deckStats([card({ id: "b", back: "  " }), card({ id: "ok" })], NOW);
    expect(s.total).toBe(2);
    expect(s.due).toBe(1);
  });
});

describe("dueQueue", () => {
  it("orders learning steps, then most-overdue reviews, then new cards", () => {
    const cards: Flashcard[] = [
      card({ id: "new1" }),
      card({ id: "review-late", reps: 2, intervalDays: 5, dueAt: "2026-07-02" }),
      card({ id: "review-later", reps: 2, intervalDays: 5, dueAt: "2026-06-20" }),
      card({ id: "future", reps: 2, intervalDays: 5, dueAt: "2026-09-01" }),
      card({ id: "step", state: "learning", reps: 1, intervalDays: 0, stability: 2, difficulty: 5, dueAt: TODAY }),
      card({ id: "blank", front: "" }),
    ];
    expect(dueQueue(cards, NOW).map((c) => c.id)).toEqual([
      "step",
      "review-later",
      "review-late",
      "new1",
    ]);
  });
});

describe("practiceQueue", () => {
  it("includes cards that are not due, weakest first, new last, never blanks", () => {
    const cards: Flashcard[] = [
      card({ id: "new" }),
      card({ id: "strong", state: "review", stability: 100, difficulty: 3, reps: 5, intervalDays: 100, dueAt: "2026-10-01", lastReviewedAt: at("2026-07-01").toISOString() }),
      card({ id: "weak", state: "review", stability: 2, difficulty: 8, reps: 2, intervalDays: 2, dueAt: "2026-07-04", lastReviewedAt: at("2026-07-01").toISOString() }),
      card({ id: "blank", back: "" }),
    ];
    expect(practiceQueue(cards, NOW).map((c) => c.id)).toEqual(["weak", "strong", "new"]);
  });
});

describe("full lifecycle", () => {
  it("a card graded good repeatedly leaves the due queue and matures", () => {
    let c = card();
    let now = NOW;
    for (let i = 0; i < 6; i++) {
      c = reviewCard(c, "good", now);
      now = c.intervalDays === 0 ? new Date(c.dueTime!) : at(c.dueAt!);
    }
    expect(c.state).toBe("review");
    expect(c.intervalDays!).toBeGreaterThanOrEqual(21);
    const dayBefore = at(shiftDay(c.dueAt!, -1));
    expect(isDue(c, dayBefore)).toBe(false);
  });
});
