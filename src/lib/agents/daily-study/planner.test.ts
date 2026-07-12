import { describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/workspace/types";
import { buildDailyStudyPlan } from "./planner";

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    name: "Semester HQ",
    pages: [],
    databases: [],
    ...overrides,
  };
}

describe("Daily Study Agent planner", () => {
  it("prioritizes overdue, high-weight work and ignores completed rows", () => {
    const result = buildDailyStudyPlan(
      [
        workspace({
          databases: [
            {
              id: "assignments",
              name: "Assignments",
              properties: [
                { id: "title", name: "Assignment", type: "text" },
                { id: "due", name: "Due", type: "date" },
                {
                  id: "status",
                  name: "Status",
                  type: "status",
                  options: [
                    { id: "todo", label: "To do" },
                    { id: "done", label: "Done" },
                  ],
                },
                { id: "weight", name: "Weight %", type: "number" },
              ],
              rows: [
                {
                  id: "overdue",
                  cells: {
                    title: "Research paper",
                    due: "2026-07-09",
                    status: "todo",
                    weight: 35,
                  },
                },
                {
                  id: "completed",
                  cells: {
                    title: "Finished quiz",
                    due: "2026-07-11",
                    status: "done",
                    weight: 50,
                  },
                },
                {
                  id: "later",
                  cells: {
                    title: "Lab report",
                    due: "2026-07-15",
                    status: "todo",
                    weight: 10,
                  },
                },
              ],
              views: [],
            },
          ],
        }),
      ],
      "2026-07-11",
      60,
    );

    expect(result.items.map((item) => item.title)).toEqual([
      "Research paper",
      "Lab report",
    ]);
    expect(result.items[0]).toMatchObject({
      kind: "deadline",
      dueDate: "2026-07-09",
      durationMinutes: 45,
    });
    expect(result.items[0].reason).toContain("Overdue by 2 days");
    expect(result.items[0].reason).toContain("35% weight");
    expect(result.items.reduce((sum, item) => sum + item.durationMinutes, 0)).toBe(60);
    expect(result.candidateCount).toBe(2);
  });

  it("turns due flashcards and open todos into explainable sessions", () => {
    const result = buildDailyStudyPlan(
      [
        workspace({
          pages: [
            {
              id: "biology",
              title: "Biology",
              blocks: [
                {
                  id: "deck",
                  type: "flashcards",
                  title: "Cell biology",
                  cards: [
                    { id: "new", front: "A", back: "B" },
                    {
                      id: "due",
                      front: "C",
                      back: "D",
                      reps: 2,
                      dueAt: "2026-07-10",
                    },
                    {
                      id: "future",
                      front: "E",
                      back: "F",
                      reps: 2,
                      dueAt: "2026-07-20",
                    },
                  ],
                },
                {
                  id: "todo",
                  type: "todo",
                  text: "Outline the lab conclusion",
                  checked: false,
                },
                {
                  id: "done-todo",
                  type: "todo",
                  text: "Read chapter 4",
                  checked: true,
                },
              ],
            },
          ],
        }),
      ],
      "2026-07-11",
      45,
    );

    expect(result.items[0]).toMatchObject({
      kind: "flashcards",
      title: "Review Cell biology",
      dueCount: 2,
    });
    expect(result.items.some((item) => item.title === "Outline the lab conclusion")).toBe(true);
    expect(result.items.some((item) => item.title === "Read chapter 4")).toBe(false);
  });

  it("does not confuse a Ready status with a completed Read status", () => {
    const result = buildDailyStudyPlan(
      [
        workspace({
          databases: [
            {
              id: "work",
              name: "Work",
              properties: [
                { id: "title", name: "Task", type: "text" },
                { id: "due", name: "Due", type: "date" },
                {
                  id: "status",
                  name: "Status",
                  type: "status",
                  options: [{ id: "ready", label: "Ready" }],
                },
              ],
              rows: [
                {
                  id: "ready-task",
                  cells: {
                    title: "Practice questions",
                    due: "2026-07-11",
                    status: "ready",
                  },
                },
              ],
              views: [],
            },
          ],
        }),
      ],
      "2026-07-11",
      30,
    );

    expect(result.items[0]?.title).toBe("Practice questions");
  });

  it("caps the plan to the configured budget and six sessions", () => {
    const pages = Array.from({ length: 10 }, (_, index) => ({
      id: `page-${index}`,
      title: `Page ${index}`,
      blocks: [
        {
          id: `todo-${index}`,
          type: "todo" as const,
          text: `Task ${index}`,
          checked: false,
        },
      ],
    }));

    const result = buildDailyStudyPlan([workspace({ pages })], "2026-07-11", 120);
    expect(result.items).toHaveLength(6);
    expect(result.items.reduce((sum, item) => sum + item.durationMinutes, 0)).toBe(120);
  });

  it("returns a calm empty plan when nothing needs attention", () => {
    const result = buildDailyStudyPlan([workspace()], "2026-07-11", 60);
    expect(result.items).toEqual([]);
    expect(result.summary).toContain("No open deadlines");
    expect(result.sourceCount).toBe(1);
  });
});
