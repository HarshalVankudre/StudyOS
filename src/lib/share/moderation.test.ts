// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  shareReport: { groupBy: vi.fn(), updateMany: vi.fn() },
  pageShare: { aggregate: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  workspace: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: m }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));

import {
  disableReportedShare,
  dismissShareReports,
  REPORTED_SHARES_SHOWN,
  REPORTS_SHOWN_PER_SHARE,
  reportedShares,
  shareStats,
} from "./moderation";
import { sharedWorkspace, TOKEN, WS_ID } from "./share-fixture";

const at = (iso: string) => new Date(`2026-11-13T${iso}:00Z`);
const report = (id: string, time: string, extra: object = {}) => ({ id, reason: "spam", message: null, createdAt: at(time), ...extra });
const share = (id: string, pageId: string, reports: ReturnType<typeof report>[], extra: object = {}) => ({
  id,
  token: TOKEN,
  userId: "user_owner",
  workspaceId: WS_ID,
  pageId,
  revokedAt: null,
  disabledByOperatorAt: null,
  viewCount: 12,
  reports,
  ...extra,
});

beforeEach(() => {
  m.shareReport.groupBy.mockReset();
  m.shareReport.updateMany.mockReset().mockReturnValue("reports-op");
  m.pageShare.aggregate.mockReset();
  m.pageShare.updateMany.mockReset().mockReturnValueOnce("revoke-op").mockReturnValueOnce("mark-op");
  m.pageShare.findMany.mockReset();
  m.pageShare.findUnique.mockReset();
  m.workspace.findMany.mockReset().mockResolvedValue([
    { id: WS_ID, ownerId: "user_owner", name: "Fall semester", data: JSON.stringify(sharedWorkspace()) },
  ]);
  m.$transaction.mockReset().mockResolvedValue([]);
});

describe("reported shares in the console", () => {
  it("lists distinct shares by their latest open report, with counts and their newest messages", async () => {
    // A share reported many times does not crowd out one reported once.
    m.shareReport.groupBy.mockResolvedValue([
      { shareId: "s2", _count: { _all: 1 }, _max: { createdAt: at("12:00") } },
      { shareId: "s1", _count: { _all: 48 }, _max: { createdAt: at("11:00") } },
    ]);
    m.pageShare.findMany.mockResolvedValue([
      share("s1", "pg_shared", [report("r48", "11:00"), report("r47", "10:59", { message: "mine" })]),
      share("s2", "pg_gone", [report("r1", "12:00", { reason: "personal" })], { revokedAt: at("12:30") }),
    ]);
    const list = await reportedShares();

    const query = m.shareReport.groupBy.mock.calls[0][0];
    expect(query).toMatchObject({
      by: ["shareId"],
      where: { status: "new" },
      orderBy: { _max: { createdAt: "desc" } },
      take: REPORTED_SHARES_SHOWN,
    });
    const shares = m.pageShare.findMany.mock.calls[0][0];
    expect(shares.where).toEqual({ id: { in: ["s2", "s1"] } });
    expect(shares.select.reports).toMatchObject({ where: { status: "new" }, orderBy: { createdAt: "desc" }, take: REPORTS_SHOWN_PER_SHARE });

    expect(list.map((s) => [s.shareId, s.pageTitle, s.active, s.openReports, s.reports.map((r) => r.id)])).toEqual([
      ["s2", null, false, 1, ["r1"]],
      ["s1", "Cell biology", true, 48, ["r48", "r47"]],
    ]);
    expect(list[1]).toMatchObject({ viewCount: 12, pageIcon: "🧬", disabledByOperator: false, latestReportAt: at("11:00") });
    // Trashed workspaces are not read for titles.
    expect(m.workspace.findMany.mock.calls[0][0].where).toEqual({ id: { in: [WS_ID] }, deletedAt: null });
  });

  it("is empty without open reports, reading nothing else", async () => {
    m.shareReport.groupBy.mockResolvedValue([]);
    expect(await reportedShares()).toEqual([]);
    expect(m.pageShare.findMany).not.toHaveBeenCalled();
  });

  it("counts active links and their views in one query", async () => {
    m.pageShare.aggregate.mockResolvedValue({ _count: { _all: 4 }, _sum: { viewCount: 31 } });
    expect(await shareStats()).toEqual({ active: 4, views: 31 });
    expect(m.pageShare.aggregate.mock.calls[0][0].where).toEqual({ revokedAt: null });
  });
});

describe("moderating a reported share", () => {
  it("disabling revokes every link of the page, marks the share as turned off by an operator and closes its reports, together", async () => {
    const now = at("12:00");
    m.pageShare.findUnique.mockResolvedValue({ workspaceId: WS_ID, pageId: "pg_shared" });
    expect(await disableReportedShare("s1", now)).toBe(true);
    expect(m.pageShare.updateMany).toHaveBeenNthCalledWith(1, {
      where: { workspaceId: WS_ID, pageId: "pg_shared", revokedAt: null },
      data: { revokedAt: now },
    });
    expect(m.pageShare.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "s1", disabledByOperatorAt: null },
      data: { disabledByOperatorAt: now },
    });
    expect(m.shareReport.updateMany).toHaveBeenCalledWith({ where: { shareId: "s1", status: "new" }, data: { status: "done" } });
    expect(m.$transaction).toHaveBeenCalledWith(["revoke-op", "mark-op", "reports-op"]);
  });

  it("does nothing for an unknown share", async () => {
    m.pageShare.findUnique.mockResolvedValue(null);
    expect(await disableReportedShare("nope")).toBe(false);
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("dismissing closes the open reports and leaves the link alone", async () => {
    m.shareReport.updateMany.mockReset().mockResolvedValue({ count: 3 });
    expect(await dismissShareReports("s1")).toBe(3);
    expect(m.shareReport.updateMany).toHaveBeenCalledWith({ where: { shareId: "s1", status: "new" }, data: { status: "done" } });
    expect(m.pageShare.updateMany).not.toHaveBeenCalled();
  });
});
