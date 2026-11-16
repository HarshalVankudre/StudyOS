import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";

const m = vi.hoisted(() => ({
  userId: "user_1" as string | null,
  workspaceFindMany: vi.fn(),
  config: vi.fn(),
  reminders: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: m.reportError }));
vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: { findMany: m.workspaceFindMany },
    dailyStudyAgentConfig: { findUnique: m.config },
    notificationPreference: { findUnique: m.reminders },
  },
}));

import { MAX_OVERVIEW_WORKSPACES } from "./overview";
import { getGradesOverview, loadGradesOverview } from "./overview-store";

/** A stored workspace with one percentage tracker: 80 % so far on half the grade. */
function stored(id: string, name: string): { id: string; name: string; data: string } {
  const workspace: Workspace = {
    id,
    name,
    homePageId: "home",
    pages: [{ id: "home", title: "Home", blocks: [{ id: "g", type: "grades", databaseId: "db", defaultTarget: 70 }] }],
    databases: [
      {
        id: "db",
        name: "Assignments",
        properties: [
          { id: "t", name: "Assignment", type: "text" },
          { id: "w", name: "Weight %", type: "number" },
          { id: "s", name: "Score", type: "number" },
          { id: "d", name: "Due", type: "date" },
        ],
        rows: [
          { id: "a", cells: { t: "Midterm", w: 50, s: 80, d: "2026-11-01" } },
          { id: "b", cells: { t: "Final", w: 50, s: null, d: "2026-12-01" } },
        ],
        views: [{ id: "v", name: "All", type: "table" }],
      },
    ],
  };
  return { id, name, data: JSON.stringify(workspace) };
}

const noTracker = {
  id: "ws_plain",
  name: "Notes",
  data: JSON.stringify({ id: "ws_plain", name: "Notes", pages: [{ id: "p", title: "P", blocks: [] }], databases: [] }),
};

beforeEach(() => {
  m.userId = "user_1";
  m.config.mockResolvedValue(null);
  m.reminders.mockResolvedValue(null);
  m.workspaceFindMany.mockResolvedValue([stored("ws_bio", "Biology"), noTracker]);
});

describe("loadGradesOverview", () => {
  it("reads only the student's own workspaces outside the trash, bounded, newest first", async () => {
    await loadGradesOverview("user_1", { today: "2026-11-13" });
    expect(m.workspaceFindMany).toHaveBeenCalledTimes(1);
    expect(m.workspaceFindMany).toHaveBeenCalledWith({
      where: { ownerId: "user_1", deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: MAX_OVERVIEW_WORKSPACES,
      select: { id: true, name: true, data: true },
    });
  });

  it("builds course cards from the trackers it finds, skipping workspaces without one", async () => {
    const overview = await loadGradesOverview("user_1", { today: "2026-11-13" });
    expect(overview.today).toBe("2026-11-13");
    expect(overview.courses).toHaveLength(1);
    expect(overview.courses[0]).toMatchObject({
      workspaceId: "ws_bio",
      workspaceName: "Biology",
      current: 80,
      target: 70,
      needed: 60,
      next: { title: "Final", due: "2026-12-01", weight: 50 },
      href: "/app/ws_bio?page=home&block=g",
    });
  });

  it("a stored document that cannot be read is left out, not fatal", async () => {
    m.workspaceFindMany.mockResolvedValue([{ id: "ws_bad", name: "Bad", data: '{"grades": nope' }, stored("ws_ok", "OK")]);
    const overview = await loadGradesOverview("user_1", { today: "2026-11-13" });
    expect(overview.courses.map((c) => c.workspaceId)).toEqual(["ws_ok"]);
  });
});

describe("getGradesOverview", () => {
  it("is scoped to the signed-in student", async () => {
    m.userId = "user_2";
    await getGradesOverview();
    expect(m.workspaceFindMany.mock.calls[0][0].where).toEqual({ ownerId: "user_2", deletedAt: null });
  });

  it("reads nothing when nobody is signed in", async () => {
    m.userId = null;
    expect(await getGradesOverview()).toBeNull();
    expect(m.workspaceFindMany).not.toHaveBeenCalled();
  });

  it("counts 'next' from today in the daily plan's zone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Already December 1st in Berlin, still November 30th in UTC.
    vi.setSystemTime(Date.parse("2026-11-30T23:30:00Z"));
    m.config.mockResolvedValue({ timeZone: "Europe/Berlin" });
    try {
      const overview = await getGradesOverview();
      expect(overview?.today).toBe("2026-12-01");
      expect(overview?.courses[0].next?.due).toBe("2026-12-01");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a failure and returns null instead of throwing", async () => {
    m.workspaceFindMany.mockRejectedValue(new Error("db down"));
    expect(await getGradesOverview()).toBeNull();
    expect(m.reportError).toHaveBeenCalledWith(expect.any(Error), { source: "grades-overview", userId: "user_1" });
  });
});
