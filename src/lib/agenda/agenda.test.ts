import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { MAX_AGENDA_PARSE_BYTES, MAX_AGENDA_WORKSPACES, getAgenda, loadAgenda } from "./agenda";

// 2026-11-13 23:30 UTC: already the 14th in Berlin, still the 13th in New York.
const NOW = new Date("2026-11-13T23:30:00Z");

function doc(id: string, name: string, due: string): Workspace {
  return {
    id,
    name,
    icon: "📚",
    homePageId: "home",
    pages: [{ id: "home", title: "Home", blocks: [{ id: "v", type: "database_view", databaseId: "db", viewId: "t" }] }],
    databases: [
      {
        id: "db",
        name: "Deadlines",
        properties: [
          { id: "title", name: "Name", type: "text" },
          { id: "due", name: "Due", type: "date" },
        ],
        rows: [{ id: "r1", cells: { title: `${name} essay`, due } }],
        views: [{ id: "t", name: "Table", type: "table" }],
      },
    ],
  };
}

function row(ws: Workspace) {
  return { id: ws.id, name: ws.name, data: JSON.stringify(ws) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  m.userId = "user_1";
  m.config.mockResolvedValue(null);
  m.reminders.mockResolvedValue(null);
  m.workspaceFindMany.mockResolvedValue([row(doc("bio", "Biology", "2026-11-14"))]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loadAgenda", () => {
  it("reads only the student's own workspaces outside the trash, newest first and bounded", async () => {
    await loadAgenda("user_1", "UTC");
    expect(m.workspaceFindMany).toHaveBeenCalledTimes(1);
    const args = m.workspaceFindMany.mock.calls[0][0];
    expect(args.where).toEqual({ ownerId: "user_1", deletedAt: null });
    expect(args.orderBy).toEqual({ updatedAt: "desc" });
    expect(args.take).toBe(MAX_AGENDA_WORKSPACES + 1);
  });

  it("turns the rows into items and courses, in the student's local day", async () => {
    const berlin = await loadAgenda("user_1", "Europe/Berlin");
    expect(berlin.today).toBe("2026-11-14");
    expect(berlin.courses).toEqual([{ id: "bio", name: "Biology", icon: "📚" }]);
    expect(berlin.items).toHaveLength(1);
    expect(berlin.items[0]).toMatchObject({
      id: "deadline:bio:db:r1",
      date: "2026-11-14",
      workspaceId: "bio",
      href: "/app/bio?page=home&db=db&row=r1",
    });
    expect(berlin.partial).toBe(false);

    // Same instant, New York: still the 13th, so the essay is tomorrow.
    const newYork = await loadAgenda("user_1", "America/New_York");
    expect(newYork.today).toBe("2026-11-13");
    expect(newYork.items.map((i) => i.date)).toEqual(["2026-11-14"]);
  });

  it("skips a workspace that cannot be read instead of failing", async () => {
    m.workspaceFindMany.mockResolvedValue([{ id: "bad", name: "Bad", data: "{not json" }, row(doc("bio", "Biology", "2026-11-14"))]);
    const data = await loadAgenda("user_1", "UTC");
    expect(data.courses.map((c) => c.id)).toEqual(["bio"]);
  });

  it("says when some workspaces were not read", async () => {
    const many = Array.from({ length: MAX_AGENDA_WORKSPACES + 1 }, (_, i) => row(doc(`w${i}`, `Course ${i}`, "2026-11-14")));
    m.workspaceFindMany.mockResolvedValue(many);
    const data = await loadAgenda("user_1", "UTC");
    expect(data.courses).toHaveLength(MAX_AGENDA_WORKSPACES);
    expect(data.partial).toBe(true);

    const huge = { id: "huge", name: "Huge", data: " ".repeat(MAX_AGENDA_PARSE_BYTES + 1) };
    m.workspaceFindMany.mockResolvedValue([row(doc("bio", "Biology", "2026-11-14")), huge]);
    const bounded = await loadAgenda("user_1", "UTC");
    expect(bounded.courses.map((c) => c.id)).toEqual(["bio"]);
    expect(bounded.partial).toBe(true);
  });
});

describe("getAgenda", () => {
  it("is null without a signed-in student, and reads nothing", async () => {
    m.userId = null;
    expect(await getAgenda()).toBeNull();
    expect(m.workspaceFindMany).not.toHaveBeenCalled();
  });

  it("follows the daily plan's zone, else the reminders' zone, else UTC", async () => {
    m.config.mockResolvedValue({ timeZone: "Europe/Berlin" });
    expect((await getAgenda())?.today).toBe("2026-11-14");

    m.config.mockResolvedValue({ timeZone: "UTC" });
    m.reminders.mockResolvedValue({ timeZone: "America/New_York" });
    const data = await getAgenda();
    expect(data?.timeZone).toBe("America/New_York");
    expect(data?.today).toBe("2026-11-13");

    m.reminders.mockResolvedValue(null);
    expect((await getAgenda())?.timeZone).toBe("UTC");
    expect(m.config).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user_1" } }));
  });

  it("reports a failure and returns null instead of throwing", async () => {
    m.workspaceFindMany.mockRejectedValue(new Error("db down"));
    expect(await getAgenda()).toBeNull();
    expect(m.reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: "agenda", userId: "user_1" }));
  });
});
