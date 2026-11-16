// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ create: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { accountDeletionReason: { create: m.create, groupBy: m.groupBy, findMany: m.findMany } },
}));

import {
  DELETION_NOTE_MAX,
  deletionReasonCounts,
  parseDeletionAnswer,
  recordDeletionReason,
  tenureOf,
} from "./deletion-reason";

const NOW = new Date("2026-11-13T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe("parseDeletionAnswer", () => {
  it("keeps an offered reason and a cleaned, capped note", () => {
    expect(parseDeletionAnswer({ reason: "tooExpensive", note: "  too pricey\u0000 for me  " })).toEqual({
      reason: "tooExpensive",
      note: "too pricey for me",
    });
    expect(parseDeletionAnswer({ reason: "finished", note: "x".repeat(DELETION_NOTE_MAX + 50) })?.note).toHaveLength(
      DELETION_NOTE_MAX,
    );
  });

  it("is nothing when nothing was answered, and 'other' for a note alone or an unknown reason with a note", () => {
    expect(parseDeletionAnswer(undefined)).toBeNull();
    expect(parseDeletionAnswer({})).toBeNull();
    expect(parseDeletionAnswer({ reason: "drop table", note: "   " })).toBeNull();
    expect(parseDeletionAnswer({ note: "Just testing" })).toEqual({ reason: "other", note: "Just testing" });
    expect(parseDeletionAnswer({ reason: 42, note: "hm" })).toEqual({ reason: "other", note: "hm" });
  });
});

describe("tenureOf", () => {
  it("buckets the account's age coarsely", () => {
    expect(tenureOf(daysAgo(2), NOW)).toBe("week");
    expect(tenureOf(daysAgo(20), NOW)).toBe("month");
    expect(tenureOf(daysAgo(60), NOW)).toBe("quarter");
    expect(tenureOf(daysAgo(200), NOW)).toBe("year");
    expect(tenureOf(daysAgo(800), NOW)).toBe("older");
    expect(tenureOf(null, NOW)).toBe("older");
  });
});

describe("recordDeletionReason", () => {
  it("stores no user id, only the answer, the plan and the age bucket", async () => {
    await recordDeletionReason({ reason: "hardToUse", note: null }, { pro: true, createdAt: daysAgo(3) }, NOW);
    expect(m.create).toHaveBeenCalledWith({ data: { reason: "hardToUse", note: null, plan: "pro", tenure: "week" } });
  });
});

describe("deletionReasonCounts", () => {
  it("lists every reason, most given first, with the newest notes", async () => {
    m.groupBy.mockResolvedValue([
      { reason: "finished", _count: { _all: 2 } },
      { reason: "tooExpensive", _count: { _all: 5 } },
    ]);
    m.findMany.mockResolvedValue([
      { note: "exams done", reason: "finished", plan: "free", tenure: "month", createdAt: daysAgo(1) },
    ]);
    const summary = await deletionReasonCounts(90, NOW);
    expect(summary.total).toBe(7);
    expect(summary.byReason.slice(0, 2)).toEqual([
      { reason: "tooExpensive", count: 5 },
      { reason: "finished", count: 2 },
    ]);
    expect(summary.byReason).toHaveLength(7);
    expect(summary.notes[0]).toMatchObject({ note: "exams done", reason: "finished" });
    expect(m.groupBy.mock.calls[0][0].where).toEqual({ createdAt: { gte: daysAgo(90) } });
  });
});
