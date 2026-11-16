// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userId: "user_visitor" as string | null,
  ip: "198.51.100.1",
  loadSharedPage: vi.fn(),
  loadPublicShare: vi.fn(),
  ownerTimeZone: vi.fn(),
  storeShareReport: vi.fn(),
  workspaceLimitReached: vi.fn(),
  checkUsageLimit: vi.fn(),
  saveNewWorkspace: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": m.ip }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/share/store", () => ({
  loadSharedPage: m.loadSharedPage,
  ownerTimeZone: m.ownerTimeZone,
  storeShareReport: m.storeShareReport,
}));
vi.mock("@/lib/share/public-share", () => ({ loadPublicShare: m.loadPublicShare }));
vi.mock("@/lib/usage-limits", () => ({
  workspaceLimitReached: m.workspaceLimitReached,
  checkUsageLimit: m.checkUsageLimit,
}));
vi.mock("@/lib/workspace/store", () => ({ saveNewWorkspace: m.saveNewWorkspace }));
vi.mock("@/lib/i18n/server", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getI18n: async () => ({ dict: en, locale: "en" }) };
});

import type { Workspace } from "@/lib/workspace/types";
import { SHARE_REPORTS_PER_HOUR } from "@/lib/share/config";
import { sharedPage, sharedWorkspace, TOKEN, WS_ID } from "@/lib/share/share-fixture";
import { reportShareAction, saveSharedCopyAction } from "./actions";

const shared = () => ({
  share: { id: "share_1", token: TOKEN, userId: "user_owner", workspaceId: WS_ID, pageId: "pg_shared" },
  workspace: sharedWorkspace(),
  page: sharedPage(),
});

let ipCounter = 0;
beforeEach(() => {
  m.userId = "user_visitor";
  // Each test reports from its own address (the limiter lives for the whole file).
  m.ip = `198.51.100.${++ipCounter}`;
  m.loadSharedPage.mockReset().mockResolvedValue(shared());
  m.loadPublicShare.mockReset().mockResolvedValue({
    share: shared().share,
    view: { title: "Cell biology", blocks: [] },
    assetIds: new Set(),
  });
  m.ownerTimeZone.mockReset().mockResolvedValue("UTC");
  m.storeShareReport.mockReset().mockResolvedValue("stored");
  m.workspaceLimitReached.mockReset().mockResolvedValue(false);
  m.checkUsageLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 10 });
  m.saveNewWorkspace.mockReset().mockResolvedValue("ws_copy");
  m.revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Report this page", () => {
  it("stores a valid report, signed out too", async () => {
    m.userId = null;
    expect(await reportShareAction({ token: TOKEN, reason: "copyright", message: "  My lecture notes  " })).toEqual({ ok: true });
    expect(m.storeShareReport).toHaveBeenCalledWith("share_1", "copyright", "My lecture notes");
    expect(await reportShareAction({ token: TOKEN, reason: "spam", message: "   " })).toEqual({ ok: true });
    expect(m.storeShareReport).toHaveBeenLastCalledWith("share_1", "spam", null);
  });

  it("refuses an unknown reason, a long message or a malformed token", async () => {
    for (const input of [
      { token: TOKEN, reason: "boring" as "spam" },
      { token: TOKEN, reason: "other" as const, message: "x".repeat(1001) },
      { token: "not-a-token", reason: "spam" as const },
    ]) {
      expect(await reportShareAction(input)).toEqual({ ok: false, error: "invalid" });
    }
    expect(m.storeShareReport).not.toHaveBeenCalled();
  });

  it(`allows ${SHARE_REPORTS_PER_HOUR} reports per address per hour`, async () => {
    for (let i = 0; i < SHARE_REPORTS_PER_HOUR; i += 1) {
      expect(await reportShareAction({ token: TOKEN, reason: "spam" })).toEqual({ ok: true });
    }
    expect(await reportShareAction({ token: TOKEN, reason: "spam" })).toEqual({ ok: false, error: "rate_limited" });
    m.ip = "203.0.113.200";
    expect(await reportShareAction({ token: TOKEN, reason: "spam" })).toEqual({ ok: true });
  });

  it("counts an IPv6 reporter by its /64", async () => {
    for (let i = 0; i < SHARE_REPORTS_PER_HOUR; i += 1) {
      m.ip = `2001:db8:5:6::${i + 1}`;
      expect(await reportShareAction({ token: TOKEN, reason: "spam" })).toEqual({ ok: true });
    }
    m.ip = "2001:db8:5:6:abcd::99";
    expect(await reportShareAction({ token: TOKEN, reason: "spam" })).toEqual({ ok: false, error: "rate_limited" });
  });

  it("says when the page is not shared anymore", async () => {
    m.loadPublicShare.mockResolvedValue(null);
    expect(await reportShareAction({ token: TOKEN, reason: "harmful" })).toEqual({ ok: false, error: "gone" });
    expect(m.storeShareReport).not.toHaveBeenCalled();
  });
});

describe("Save a copy to my StudyOS", () => {
  it("asks a signed-out visitor to sign in first", async () => {
    m.userId = null;
    expect(await saveSharedCopyAction(TOKEN)).toEqual({ ok: false, error: "signed_out" });
    expect(m.loadSharedPage).not.toHaveBeenCalled();
  });

  it("copies the page into a new workspace of the visitor, without charging credits", async () => {
    expect(await saveSharedCopyAction(TOKEN)).toEqual({ ok: true, workspaceId: "ws_copy" });
    const copy = m.saveNewWorkspace.mock.calls[0][0] as Workspace;
    expect(copy.name).toBe("Cell biology");
    expect(copy.pages).toHaveLength(1);
    const types = copy.pages[0].blocks.map((b) => b.type);
    expect(types).not.toContain("grades");
    expect(types).not.toContain("react_artifact");
    // The sharer's images are theirs: not in another student's copy.
    expect(types).not.toContain("media");
    expect(JSON.stringify(copy)).not.toContain(WS_ID);
    expect(m.checkUsageLimit).toHaveBeenCalledWith("user_visitor", "workspace_duplicate");
    expect(m.revalidatePath).toHaveBeenCalledWith("/app");
  });

  it("reads the page's date filters on the sharer's day, as the visitor saw it", async () => {
    m.ownerTimeZone.mockResolvedValue("Pacific/Kiritimati");
    await saveSharedCopyAction(TOKEN);
    expect(m.ownerTimeZone).toHaveBeenCalledWith("user_owner");
  });

  it("keeps the images when the sharer saves their own page", async () => {
    m.userId = "user_owner";
    await saveSharedCopyAction(TOKEN);
    const copy = m.saveNewWorkspace.mock.calls[0][0] as Workspace;
    expect(copy.pages[0].blocks.map((b) => b.type)).toContain("media");
  });

  it("refuses past the workspace cap and the copy rate limit", async () => {
    m.workspaceLimitReached.mockResolvedValueOnce(true);
    expect(await saveSharedCopyAction(TOKEN)).toEqual({ ok: false, error: "limit" });
    m.checkUsageLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 });
    expect(await saveSharedCopyAction(TOKEN)).toEqual({ ok: false, error: "rate_limited" });
    expect(m.saveNewWorkspace).not.toHaveBeenCalled();
  });

  it("says when the page is not shared anymore, or the token is malformed", async () => {
    m.loadSharedPage.mockResolvedValue(null);
    expect(await saveSharedCopyAction(TOKEN)).toEqual({ ok: false, error: "gone" });
    expect(await saveSharedCopyAction("bad")).toEqual({ ok: false, error: "invalid" });
    expect(m.saveNewWorkspace).not.toHaveBeenCalled();
  });

  it("never throws to the client", async () => {
    m.saveNewWorkspace.mockRejectedValueOnce(new Error("Account was deleted"));
    expect(await saveSharedCopyAction(TOKEN)).toEqual({ ok: false, error: "failed" });
  });
});
