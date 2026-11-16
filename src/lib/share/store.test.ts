// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    pageShare: { findUnique: fn(), findFirst: fn(), findMany: fn(), count: fn(), create: fn(), updateMany: fn() },
    shareReport: { count: fn(), create: fn() },
    workspace: { findFirst: fn(), findMany: fn() },
    dailyStudyAgentConfig: { findUnique: fn() },
    locks: [] as string[],
  };
});

type Where = Record<string, unknown>;
/** What the share table holds for a test: an active link, active links counted, operator decisions. */
const rows = {
  active: null as null | { token: string; createdAt: Date; viewCount: number },
  activeCount: 0,
  pageDisabled: false,
  operatorDisabled: 0,
};

vi.mock("@/lib/db", () => ({ prisma: m }));
vi.mock("@/lib/db-lock", () => ({
  userLockKey: (scope: string, userId: string) => `${scope}:${userId}`,
  withKeyLock: async (key: string, fn: (tx: unknown) => unknown) => {
    m.locks.push(key);
    return fn(m);
  },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));

import { MAX_ACTIVE_SHARES_PER_USER, OPERATOR_DISABLED_SHARES_BLOCK, SHARE_REPORTS_OPEN_CAP } from "./config";
import { sharedWorkspace, TOKEN, WS_ID } from "./share-fixture";
import {
  disableShare,
  enableShare,
  findLiveShare,
  getShareState,
  loadSharedPage,
  ownerTimeZone,
  recordShareView,
  storeShareReport,
} from "./store";
import { isShareTokenShape } from "./token";

const SHARE = {
  id: "share_1",
  token: TOKEN,
  userId: "user_owner",
  workspaceId: WS_ID,
  pageId: "pg_shared",
  revokedAt: null,
  workspace: { ownerId: "user_owner", deletedAt: null, version: 7 },
};
const workspaceRow = () => ({ id: WS_ID, name: "Fall semester", data: JSON.stringify(sharedWorkspace()), version: 7 });

beforeEach(() => {
  for (const delegate of [m.pageShare, m.shareReport, m.workspace, m.dailyStudyAgentConfig]) {
    for (const f of Object.values(delegate)) f.mockReset();
  }
  m.locks.length = 0;
  Object.assign(rows, { active: null, activeCount: 0, pageDisabled: false, operatorDisabled: 0 });
  m.pageShare.findUnique.mockResolvedValue(SHARE);
  m.pageShare.findFirst.mockImplementation(async ({ where }: { where: Where }) =>
    where.disabledByOperatorAt ? (rows.pageDisabled ? { id: "share_off" } : null) : rows.active,
  );
  m.pageShare.count.mockImplementation(async ({ where }: { where: Where }) =>
    where.disabledByOperatorAt ? rows.operatorDisabled : rows.activeCount,
  );
  m.workspace.findFirst.mockResolvedValue(workspaceRow());
});

describe("opening a share link", () => {
  it("finds the active share, its workspace and the page", async () => {
    const shared = await loadSharedPage(TOKEN);
    expect(shared?.share).toEqual({ id: "share_1", token: TOKEN, userId: "user_owner", workspaceId: WS_ID, pageId: "pg_shared" });
    expect(shared?.page.title).toBe("Cell biology");
    // Only the sharer's own workspace, and never one in the trash.
    expect(m.workspace.findFirst.mock.calls[0][0].where).toEqual({ id: WS_ID, ownerId: "user_owner", deletedAt: null });
  });

  it("checks the link with the share and its workspace's state only, never the document", async () => {
    expect(await findLiveShare(TOKEN)).toEqual({
      share: { id: "share_1", token: TOKEN, userId: "user_owner", workspaceId: WS_ID, pageId: "pg_shared" },
      version: 7,
    });
    expect(m.pageShare.findUnique.mock.calls[0][0].select.workspace).toEqual({
      select: { ownerId: true, deletedAt: true, version: true },
    });
    expect(m.workspace.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a token of the wrong shape without touching the database", async () => {
    for (const bad of ["", "abc", `${TOKEN}x`, "../../etc/passwd"]) expect(await loadSharedPage(bad)).toBeNull();
    expect(m.pageShare.findUnique).not.toHaveBeenCalled();
  });

  it("is a 404 for an unknown or revoked token", async () => {
    m.pageShare.findUnique.mockResolvedValueOnce(null);
    expect(await loadSharedPage(TOKEN)).toBeNull();
    m.pageShare.findUnique.mockResolvedValueOnce({ ...SHARE, revokedAt: new Date() });
    expect(await loadSharedPage(TOKEN)).toBeNull();
  });

  it("is a 404 when the workspace is trashed, deleted or no longer the sharer's", async () => {
    m.pageShare.findUnique.mockResolvedValueOnce({ ...SHARE, workspace: { ...SHARE.workspace, deletedAt: new Date() } });
    expect(await findLiveShare(TOKEN)).toBeNull();
    m.pageShare.findUnique.mockResolvedValueOnce({ ...SHARE, workspace: { ...SHARE.workspace, ownerId: "user_other" } });
    expect(await findLiveShare(TOKEN)).toBeNull();
    m.workspace.findFirst.mockResolvedValueOnce(null);
    expect(await loadSharedPage(TOKEN)).toBeNull();
  });

  it("is a 404 when the page no longer exists", async () => {
    m.pageShare.findUnique.mockResolvedValueOnce({ ...SHARE, pageId: "pg_deleted" });
    expect(await loadSharedPage(TOKEN)).toBeNull();
  });
});

describe("the sharer's time zone", () => {
  it("is their Today plan's zone, else UTC", async () => {
    m.dailyStudyAgentConfig.findUnique.mockResolvedValueOnce({ timeZone: "Europe/Berlin" });
    expect(await ownerTimeZone("user_owner")).toBe("Europe/Berlin");
    expect(m.dailyStudyAgentConfig.findUnique.mock.calls[0][0].where).toEqual({ userId: "user_owner" });
    m.dailyStudyAgentConfig.findUnique.mockResolvedValueOnce(null);
    expect(await ownerTimeZone("user_owner")).toBe("UTC");
    m.dailyStudyAgentConfig.findUnique.mockResolvedValueOnce({ timeZone: "Mars/Olympus" });
    expect(await ownerTimeZone("user_owner")).toBe("UTC");
  });
});

describe("turning sharing on and off", () => {
  beforeEach(() => {
    m.pageShare.create.mockImplementation(async ({ data }: { data: { token: string } }) => ({
      token: data.token,
      createdAt: new Date("2026-11-13T10:00:00Z"),
      viewCount: 0,
    }));
  });

  it("is off by default", async () => {
    expect(await getShareState("user_owner", WS_ID, "pg_shared")).toEqual({ enabled: false });
  });

  it("only for a page of the student's own workspace, not in the trash", async () => {
    m.workspace.findFirst.mockResolvedValueOnce(null);
    expect(await enableShare("user_other", WS_ID, "pg_shared")).toEqual({ status: "not_found" });
    expect(m.workspace.findFirst.mock.calls[0][0].where).toEqual({ id: WS_ID, ownerId: "user_other", deletedAt: null });
    expect(await enableShare("user_owner", WS_ID, "pg_missing")).toEqual({ status: "not_found" });
    expect(await getShareState("user_owner", WS_ID, "pg_missing")).toBeNull();
    expect(m.pageShare.create).not.toHaveBeenCalled();
  });

  it("creates a link with a fresh unguessable token, under the student's lock", async () => {
    const result = await enableShare("user_owner", WS_ID, "pg_shared");
    expect(result.status).toBe("ok");
    const data = m.pageShare.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: "user_owner", workspaceId: WS_ID, pageId: "pg_shared" });
    expect(isShareTokenShape(data.token)).toBe(true);
    expect(m.locks).toEqual(["page-share:user_owner"]);
  });

  it("keeps one active link per page: turning it on again returns the same link", async () => {
    rows.active = { token: TOKEN, createdAt: new Date(0), viewCount: 4 };
    expect(await enableShare("user_owner", WS_ID, "pg_shared")).toEqual({
      status: "ok",
      state: { enabled: true, token: TOKEN, createdAt: new Date(0), viewCount: 4 },
    });
    expect(m.pageShare.create).not.toHaveBeenCalled();
  });

  it(`stops at ${MAX_ACTIVE_SHARES_PER_USER} active links per student`, async () => {
    rows.activeCount = MAX_ACTIVE_SHARES_PER_USER;
    m.pageShare.findMany.mockResolvedValue([{ id: "s_live", workspaceId: WS_ID, pageId: "pg_shared" }]);
    m.workspace.findMany.mockResolvedValue([workspaceRow()]);
    expect(await enableShare("user_owner", WS_ID, "pg_shared")).toEqual({ status: "limit" });
    expect(m.pageShare.count.mock.calls.map((c) => c[0].where)).toContainEqual({ userId: "user_owner", revokedAt: null });
    expect(m.pageShare.updateMany).not.toHaveBeenCalled();
    expect(m.pageShare.create).not.toHaveBeenCalled();
  });

  it("never shares again a page whose link an operator turned off", async () => {
    rows.pageDisabled = true;
    expect(await enableShare("user_owner", WS_ID, "pg_shared")).toEqual({ status: "page_disabled" });
    const query = m.pageShare.findFirst.mock.calls.map((c) => c[0].where).find((w) => w.disabledByOperatorAt);
    expect(query).toEqual({ workspaceId: WS_ID, pageId: "pg_shared", disabledByOperatorAt: { not: null } });
    expect(await getShareState("user_owner", WS_ID, "pg_shared")).toEqual({ enabled: false, blocked: "page" });
    expect(m.pageShare.create).not.toHaveBeenCalled();
  });

  it(`stops a student with ${OPERATOR_DISABLED_SHARES_BLOCK} links turned off by an operator from sharing any page`, async () => {
    rows.operatorDisabled = OPERATOR_DISABLED_SHARES_BLOCK - 1;
    expect((await enableShare("user_owner", WS_ID, "pg_shared")).status).toBe("ok");
    rows.operatorDisabled = OPERATOR_DISABLED_SHARES_BLOCK;
    expect(await enableShare("user_owner", WS_ID, "pg_shared")).toEqual({ status: "sharing_blocked" });
    expect(m.pageShare.count.mock.calls.map((c) => c[0].where)).toContainEqual({
      userId: "user_owner",
      disabledByOperatorAt: { not: null },
    });
    expect(await getShareState("user_owner", WS_ID, "pg_shared")).toEqual({ enabled: false, blocked: "account" });
    expect(m.pageShare.create).toHaveBeenCalledTimes(1);
    // Decided under the student's lock, with the rest of the checks.
    expect(m.locks.every((key) => key === "page-share:user_owner")).toBe(true);
  });

  it("at the cap, first turns off links whose page or workspace is gone", async () => {
    rows.activeCount = MAX_ACTIVE_SHARES_PER_USER;
    m.pageShare.findMany.mockResolvedValue([
      { id: "s_live", workspaceId: WS_ID, pageId: "pg_shared" },
      { id: "s_page_gone", workspaceId: WS_ID, pageId: "pg_deleted" },
      { id: "s_ws_trashed", workspaceId: "ws_trashed", pageId: "p" },
    ]);
    // Only the sharer's own workspaces that are not in the trash come back.
    m.workspace.findMany.mockResolvedValue([workspaceRow()]);
    m.pageShare.updateMany.mockResolvedValue({ count: 2 });
    const result = await enableShare("user_owner", WS_ID, "pg_shared");
    expect(result.status).toBe("ok");
    expect(m.workspace.findMany.mock.calls[0][0].where).toEqual({
      id: { in: [WS_ID, "ws_trashed"] },
      ownerId: "user_owner",
      deletedAt: null,
    });
    expect(m.pageShare.updateMany.mock.calls[0][0].where).toEqual({
      id: { in: ["s_page_gone", "s_ws_trashed"] },
      userId: "user_owner",
      revokedAt: null,
    });
    expect(m.pageShare.create).toHaveBeenCalledTimes(1);
  });

  it("turning it off revokes only the student's own active link; on again issues a new token", async () => {
    m.pageShare.updateMany.mockResolvedValue({ count: 1 });
    const first = await enableShare("user_owner", WS_ID, "pg_shared");
    expect(await disableShare("user_owner", WS_ID, "pg_shared")).toBe(1);
    const revoke = m.pageShare.updateMany.mock.calls[0][0];
    expect(revoke.where).toEqual({ userId: "user_owner", workspaceId: WS_ID, pageId: "pg_shared", revokedAt: null });
    expect(revoke.data.revokedAt).toBeInstanceOf(Date);
    const second = await enableShare("user_owner", WS_ID, "pg_shared");
    if (first.status !== "ok" || second.status !== "ok") throw new Error("expected links");
    expect(second.state.token).not.toBe(first.state.token);
  });
});

describe("counting views", () => {
  it("counts one view per address and link per hour", async () => {
    m.pageShare.updateMany.mockResolvedValue({ count: 1 });
    expect(await recordShareView("share_v", "203.0.113.9")).toBe(true);
    expect(await recordShareView("share_v", "203.0.113.9")).toBe(false);
    expect(await recordShareView("share_v", "203.0.113.10")).toBe(true);
    expect(await recordShareView("share_w", "203.0.113.9")).toBe(true);
    expect(m.pageShare.updateMany).toHaveBeenCalledTimes(3);
    expect(m.pageShare.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "share_v", revokedAt: null },
      data: { viewCount: { increment: 1 } },
    });
  });
});

describe("reports", () => {
  it("stores a report for review", async () => {
    m.shareReport.count.mockResolvedValue(0);
    expect(await storeShareReport("share_1", "spam", "Ads everywhere")).toBe("stored");
    expect(m.shareReport.create).toHaveBeenCalledWith({ data: { shareId: "share_1", reason: "spam", message: "Ads everywhere" } });
  });

  it(`stops storing once a share has ${SHARE_REPORTS_OPEN_CAP} open reports`, async () => {
    m.shareReport.count.mockResolvedValue(SHARE_REPORTS_OPEN_CAP);
    expect(await storeShareReport("share_1", "other", null)).toBe("capped");
    expect(m.shareReport.create).not.toHaveBeenCalled();
  });
});
