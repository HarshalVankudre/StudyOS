// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  aggregate: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { errorEvent: { aggregate: m.aggregate, findMany: m.findMany, deleteMany: m.deleteMany } },
}));
vi.mock("@/lib/ops/report-error", () => ({ reportError: m.reportError }));

import { ERRORS_SHOWN, clearErrorEvent, errorOverview } from "./error-overview";

const NOW = new Date("2026-11-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const ROW = {
  fingerprint: "0123456789abcdef",
  source: "api",
  route: "/api/generate",
  message: "Error: timeout after 30000ms",
  sample: "at run (src/lib/ai/generate.ts:1:2)",
  count: 12,
  firstSeen: new Date("2026-11-10T08:00:00Z"),
  lastSeen: new Date("2026-11-15T11:00:00Z"),
  release: "v42",
};

beforeEach(() => {
  m.aggregate.mockReset();
  m.findMany.mockReset();
  m.deleteMany.mockReset();
  m.reportError.mockReset();
});

describe("errorOverview", () => {
  it("sums counts by lastSeen window and lists the top kinds of the last 7 days", async () => {
    m.aggregate.mockImplementation(async (args: { where: { lastSeen: { gte: Date } } }) => {
      const days = (NOW.getTime() - args.where.lastSeen.gte.getTime()) / DAY;
      return days === 1 ? { _sum: { count: 5 }, _count: { _all: 2 } } : { _sum: { count: 40 }, _count: { _all: 7 } };
    });
    m.findMany.mockResolvedValue([ROW]);

    expect(await errorOverview(NOW)).toEqual({ seen: { day: 5, week: 40 }, kinds: { day: 2, week: 7 }, top: [ROW] });

    const windows = m.aggregate.mock.calls.map((c) => (NOW.getTime() - c[0].where.lastSeen.gte.getTime()) / DAY);
    expect(windows.sort()).toEqual([1, 7]);
    const list = m.findMany.mock.calls[0][0];
    expect(list.where).toEqual({ lastSeen: { gte: new Date(NOW.getTime() - 7 * DAY) } });
    expect(list.orderBy).toEqual([{ count: "desc" }, { lastSeen: "desc" }]);
    expect(list.take).toBe(ERRORS_SHOWN);
    expect(ERRORS_SHOWN).toBe(20);
  });

  it("counts an empty table as zero", async () => {
    m.aggregate.mockResolvedValue({ _sum: { count: null }, _count: { _all: 0 } });
    m.findMany.mockResolvedValue([]);
    expect(await errorOverview(NOW)).toEqual({ seen: { day: 0, week: 0 }, kinds: { day: 0, week: 0 }, top: [] });
  });

  it("returns null (and reports it) when the table cannot be read, so the console still loads", async () => {
    m.aggregate.mockRejectedValue(Object.assign(new Error("relation does not exist"), { code: "P2021" }));
    m.findMany.mockResolvedValue([]);
    expect(await errorOverview(NOW)).toBeNull();
    expect(m.reportError).toHaveBeenCalledWith(expect.any(Error), { source: "admin", route: "lib/ops/error-overview" });
  });
});

describe("clearErrorEvent", () => {
  it("deletes that one kind", async () => {
    m.deleteMany.mockResolvedValue({ count: 1 });
    expect(await clearErrorEvent("0123456789abcdef")).toBe(1);
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { fingerprint: "0123456789abcdef" } });
  });
});
