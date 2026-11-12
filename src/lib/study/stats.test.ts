import { describe, expect, it } from "vitest";
import type { Flashcard } from "@/lib/workspace/types";
import { isoDay } from "./srs";
import { shiftDay } from "./days";
import {
  collectCards,
  countsForEvent,
  dueForecast,
  retentionRate,
  reviewsPerDay,
  totals,
  zeroCounts,
  type DayRow,
} from "./stats";
import { DAILY_REVIEW_LOAD, needsCatchUp, planCatchUp, postponeCard, type KeyedCard } from "./backlog";
import { ReviewBuffer } from "./recorder";

const NOW = new Date(2026, 6, 3, 10);
const TODAY = isoDay(NOW);

function row(localDate: string, o: Partial<DayRow> = {}): DayRow {
  return { ...zeroCounts(), localDate, ...o };
}

describe("countsForEvent", () => {
  it("counts a scheduled review by grade, new card and retention basis", () => {
    expect(countsForEvent({ grade: "good", prevState: "review", practice: false })).toMatchObject({
      reviews: 1, good: 1, reviewTotal: 1, reviewPassed: 1, newCards: 0, practice: 0,
    });
    expect(countsForEvent({ grade: "again", prevState: "review", practice: false })).toMatchObject({
      again: 1, reviewTotal: 1, reviewPassed: 0,
    });
    expect(countsForEvent({ grade: "hard", prevState: "new", practice: false })).toMatchObject({
      newCards: 1, reviewTotal: 0,
    });
  });

  it("counts practice separately and nowhere else", () => {
    const c = countsForEvent({ grade: "again", prevState: "review", practice: true });
    expect(c).toEqual({ ...zeroCounts(), practice: 1 });
  });
});

describe("reviewsPerDay / retention", () => {
  const rows = [
    row(TODAY, { reviews: 5, practice: 2, reviewTotal: 4, reviewPassed: 3 }),
    row(TODAY, { reviews: 1 }), // a second workspace on the same day
    row(shiftDay(TODAY, -2), { reviews: 7, reviewTotal: 6, reviewPassed: 6 }),
    row(shiftDay(TODAY, -40), { reviews: 99, reviewTotal: 99, reviewPassed: 0 }),
  ];

  it("zero-fills a window ending today and merges workspaces", () => {
    const points = reviewsPerDay(rows, TODAY, 7);
    expect(points).toHaveLength(7);
    expect(points[6]).toEqual({ day: TODAY, reviews: 6, practice: 2 });
    expect(points[4].reviews).toBe(7);
    expect(points[5].reviews).toBe(0);
  });

  it("computes retention over the recent window only", () => {
    expect(retentionRate(rows, TODAY, 30)).toBeCloseTo(9 / 10);
    expect(retentionRate([], TODAY)).toBeNull();
  });

  it("totals rows", () => {
    expect(totals(rows).reviews).toBe(112);
  });
});

describe("dueForecast", () => {
  it("puts overdue reviews on today and counts new cards separately", () => {
    const cards: Flashcard[] = [
      { id: "n", front: "q", back: "a" },
      { id: "late", front: "q", back: "a", reps: 2, dueAt: shiftDay(TODAY, -3) },
      { id: "t", front: "q", back: "a", reps: 2, dueAt: TODAY },
      { id: "d2", front: "q", back: "a", reps: 2, dueAt: shiftDay(TODAY, 2) },
      { id: "far", front: "q", back: "a", reps: 2, dueAt: shiftDay(TODAY, 30) },
      { id: "blank", front: "", back: "a", reps: 2, dueAt: TODAY },
    ];
    const f = dueForecast(cards, TODAY, 14);
    expect(f.points).toHaveLength(14);
    expect(f.points[0]).toEqual({ day: TODAY, count: 2 });
    expect(f.points[2].count).toBe(1);
    expect(f.newWaiting).toBe(1);
  });
});

describe("collectCards", () => {
  it("finds cards in every deck and tolerates malformed data", () => {
    const ws = {
      pages: [
        { blocks: [{ type: "flashcards", cards: [{ id: "a", front: "q", back: "a" }, { id: "bad" }] }, { type: "paragraph" }] },
        { blocks: "nope" },
        { blocks: [{ type: "flashcards", cards: [{ id: "b", front: "q2", back: "a2" }] }] },
      ],
    };
    expect(collectCards(ws).map((c) => c.id)).toEqual(["a", "b"]);
    expect(collectCards(null)).toEqual([]);
  });
});

describe("catch-up plan (welcome back)", () => {
  function overdue(n: number, extra: Partial<Flashcard> = {}): KeyedCard[] {
    return Array.from({ length: n }, (_, i) => ({
      key: `k${i}`,
      card: {
        id: `c${i}`,
        front: `q${i}`,
        back: "a",
        state: "review" as const,
        stability: 1 + i, // later cards are stronger (higher recall)
        difficulty: 5,
        reps: 3,
        intervalDays: 5,
        dueAt: shiftDay(TODAY, -10),
        lastReviewedAt: new Date(2026, 5, 18).toISOString(),
        ...extra,
      },
    }));
  }

  it("is only offered when overdue reviews exceed a day's load", () => {
    expect(needsCatchUp(overdue(DAILY_REVIEW_LOAD), NOW)).toBe(false);
    expect(needsCatchUp(overdue(DAILY_REVIEW_LOAD + 1), NOW)).toBe(true);
    // A big pile due today but not overdue is just today's work.
    expect(needsCatchUp(overdue(80, { dueAt: TODAY }), NOW)).toBe(false);
  });

  it("keeps the most at-risk cards today and spreads 300 over the next days", () => {
    const items = overdue(300);
    const plan = planCatchUp(items, NOW, 50);
    expect(plan.today).toBe(50);
    expect(plan.moved).toBe(250);
    expect(plan.days).toBe(5);
    const moved = new Set(plan.moves.map((m) => m.key));
    // The weakest (lowest stability) 50 stay today.
    expect(moved.has("k0")).toBe(false);
    expect(moved.has("k49")).toBe(false);
    expect(moved.has("k50")).toBe(true);
    // No later day gets more than the load.
    const perDay = new Map<string, number>();
    for (const m of plan.moves) perDay.set(m.dueAt, (perDay.get(m.dueAt) ?? 0) + 1);
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(50);
    expect(Math.min(...[...perDay.keys()].map((d) => d.localeCompare(TODAY)))).toBe(1);
  });

  it("fills around reviews already scheduled on later days", () => {
    const items = [
      ...overdue(60),
      ...overdue(45, { dueAt: shiftDay(TODAY, 1) }).map((x, i) => ({ ...x, key: `f${i}` })),
    ];
    const plan = planCatchUp(items, NOW, 50);
    const tomorrow = plan.moves.filter((m) => m.dueAt === shiftDay(TODAY, 1)).length;
    expect(tomorrow).toBe(5);
    expect(plan.moved).toBe(10);
  });

  it("postponing changes only the due day and pins an inferred last review", () => {
    const card: Flashcard = { id: "x", front: "q", back: "a", reps: 3, ease: 2.5, intervalDays: 10, dueAt: shiftDay(TODAY, -5) };
    postponeCard(card, shiftDay(TODAY, 2));
    expect(card.dueAt).toBe(shiftDay(TODAY, 2));
    expect(card.ease).toBe(2.5);
    expect(card.intervalDays).toBe(10);
    expect(isoDay(new Date(card.lastReviewedAt!))).toBe(shiftDay(TODAY, -15));
  });
});

describe("ReviewBuffer", () => {
  it("merges answers per workspace and day, and restores failed batches", () => {
    const b = new ReviewBuffer();
    b.add("w1", "2026-07-02", { grade: "good", prevState: "review", practice: false });
    b.add("w1", "2026-07-02", { grade: "again", prevState: "new", practice: false });
    b.add("w1", "2026-07-03", { grade: "easy", prevState: "review", practice: true });
    b.add("w2", "2026-07-03", { grade: "hard", prevState: "learning", practice: false });
    expect(b.size).toBe(3);
    const batches = b.drain();
    expect(b.size).toBe(0);
    const w1 = batches.find((x) => x.workspaceId === "w1" && x.localDate === "2026-07-02")!;
    expect(w1.counts).toMatchObject({ reviews: 2, good: 1, again: 1, newCards: 1 });
    b.add("w1", "2026-07-02", { grade: "good", prevState: "review", practice: false });
    b.restore(batches);
    expect(b.drain().find((x) => x.localDate === "2026-07-02")!.counts.reviews).toBe(3);
  });
});
