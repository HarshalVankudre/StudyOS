import { describe, expect, it } from "vitest";
import { daysBetween } from "@/lib/study/days";
import { buildSampleWorkspace, SAMPLE_REFERENCE_DAY, sampleWorkspace } from "./sample";
import { workspaceSchema } from "./schema";
import type { Workspace } from "./types";

function dueDays(ws: Workspace): string[] {
  const db = ws.databases.find((d) => d.id === "db-assignments")!;
  return db.rows.map((row) => row.cells["a-due"] as string);
}

describe("sample workspace", () => {
  it("places its deadlines around the given day: this week and next, a little already done", () => {
    const today = "2026-11-12";
    const ws = buildSampleWorkspace(today);
    const offsets = dueDays(ws).map((day) => daysBetween(today, day));
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(-3);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(14);
    // Whatever is in the past is done, so nothing shows as overdue.
    const db = ws.databases.find((d) => d.id === "db-assignments")!;
    for (const row of db.rows) {
      if ((row.cells["a-due"] as string) < today) expect(row.cells["a-status"]).toBe("st-done");
    }
  });

  it("is deterministic for a given day, and accepts a Date", () => {
    expect(buildSampleWorkspace("2027-01-30")).toEqual(buildSampleWorkspace("2027-01-30"));
    expect(dueDays(buildSampleWorkspace(new Date("2027-01-30T12:00:00.000Z")))).toEqual(
      dueDays(buildSampleWorkspace("2027-01-30")),
    );
    // The fixture for tests is the sample built for a fixed day.
    expect(sampleWorkspace).toEqual(buildSampleWorkspace(SAMPLE_REFERENCE_DAY));
    expect(dueDays(sampleWorkspace)).toContain("2026-06-22");
  });

  it("crosses month and year ends cleanly", () => {
    const days = dueDays(buildSampleWorkspace("2026-12-28"));
    expect(days).toContain("2027-01-01");
    expect(days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))).toBe(true);
  });

  it("is a valid workspace", () => {
    expect(workspaceSchema.safeParse(buildSampleWorkspace("2026-11-12")).success).toBe(true);
  });

  it("does not repeat a page's title in its first block", () => {
    for (const page of sampleWorkspace.pages) {
      const first = page.blocks[0];
      if (first?.type === "heading") {
        expect(first.text.trim().toLowerCase()).not.toBe(page.title.trim().toLowerCase());
      }
    }
  });

  it("lists the assignment's due date and status right after its name", () => {
    const db = sampleWorkspace.databases.find((d) => d.id === "db-assignments")!;
    expect(db.properties.slice(0, 3).map((p) => p.type)).toEqual(["text", "date", "status"]);
  });
});
