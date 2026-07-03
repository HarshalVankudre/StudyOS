import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";

const mocks = vi.hoisted(() => ({
  tokenFindUnique: vi.fn(),
  tokenCreate: vi.fn(),
  tokenUpsert: vi.fn(),
  workspaceFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    calendarToken: {
      findUnique: mocks.tokenFindUnique,
      create: mocks.tokenCreate,
      upsert: mocks.tokenUpsert,
    },
    workspace: { findMany: mocks.workspaceFindMany },
  },
}));

import {
  buildUserFeed,
  getOrCreateCalendarToken,
  resetCalendarToken,
  resolveUserByToken,
} from "./feed";

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

function ws(id: string, due: string): Workspace {
  return {
    id,
    name: id,
    databases: [
      {
        id: `${id}-db`,
        name: "Assignments",
        properties: [
          { id: "t", name: "Assignment", type: "text" },
          { id: "due", name: "Due", type: "date" },
        ],
        rows: [{ id: "r1", cells: { t: `Task ${id}`, due } }],
        views: [],
      },
    ],
    pages: [],
  };
}

describe("calendar tokens", () => {
  it("returns an existing token without creating a new one", async () => {
    mocks.tokenFindUnique.mockResolvedValue({ token: "tok_abc", userId: "u1" });
    const token = await getOrCreateCalendarToken("u1");
    expect(token).toBe("tok_abc");
    expect(mocks.tokenCreate).not.toHaveBeenCalled();
  });

  it("creates a token on first request", async () => {
    mocks.tokenFindUnique.mockResolvedValue(null);
    mocks.tokenCreate.mockResolvedValue({});
    const token = await getOrCreateCalendarToken("u1");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
    expect(mocks.tokenCreate).toHaveBeenCalledOnce();
  });

  it("rotates the token on reset", async () => {
    mocks.tokenUpsert.mockResolvedValue({});
    const token = await resetCalendarToken("u1");
    expect(typeof token).toBe("string");
    const arg = mocks.tokenUpsert.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: "u1" });
    expect(arg.update.token).toBe(token);
  });

  it("resolves a token to its owner, null when unknown", async () => {
    mocks.tokenFindUnique.mockResolvedValueOnce({ userId: "u9" });
    expect(await resolveUserByToken("tok")).toBe("u9");
    mocks.tokenFindUnique.mockResolvedValueOnce(null);
    expect(await resolveUserByToken("nope")).toBeNull();
    expect(await resolveUserByToken("")).toBeNull();
  });
});

describe("buildUserFeed", () => {
  it("aggregates dated rows across workspaces, sorted by date", async () => {
    mocks.workspaceFindMany.mockResolvedValue([
      { data: JSON.stringify(ws("A", "2026-10-05")) },
      { data: JSON.stringify(ws("B", "2026-09-01")) },
    ]);
    const ics = await buildUserFeed("u1", new Date("2026-07-03T00:00:00Z"));
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260901");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261005");
    // Sorted: September event appears before October.
    expect(ics.indexOf("20260901")).toBeLessThan(ics.indexOf("20261005"));
    expect(ics).toContain("SUMMARY:Task B");
  });

  it("skips workspaces whose data is corrupt JSON", async () => {
    mocks.workspaceFindMany.mockResolvedValue([
      { data: "{not json" },
      { data: JSON.stringify(ws("C", "2026-11-11")) },
    ]);
    const ics = await buildUserFeed("u1", new Date("2026-07-03T00:00:00Z"));
    expect(ics).toContain("20261111");
  });

  it("produces an empty but valid calendar when there are no workspaces", async () => {
    mocks.workspaceFindMany.mockResolvedValue([]);
    const ics = await buildUserFeed("u1", new Date("2026-07-03T00:00:00Z"));
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
