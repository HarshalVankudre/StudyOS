// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userId: "user_owner" as string | null,
  getShareState: vi.fn(),
  enableShare: vi.fn(),
  disableShare: vi.fn(),
  claim: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("@/lib/share/store", () => ({
  getShareState: m.getShareState,
  enableShare: m.enableShare,
  disableShare: m.disableShare,
}));
vi.mock("@/lib/usage-limits", () => ({ claimWithinLimit: m.claim }));

import { SHARE_ENABLE_KIND, SHARE_ENABLES_PER_HOUR } from "@/lib/share/config";
import { getPageShareAction, setPageShareAction } from "./share-actions";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const target = { workspaceId: "ws_1", pageId: "pg_1" };
const live = { enabled: true as const, token: TOKEN, createdAt: new Date("2026-11-13T10:00:00Z"), viewCount: 3 };

beforeEach(() => {
  m.userId = "user_owner";
  m.getShareState.mockReset().mockResolvedValue({ enabled: false });
  m.enableShare.mockReset().mockResolvedValue({ status: "ok", state: live });
  m.disableShare.mockReset().mockResolvedValue(1);
  m.claim.mockReset().mockResolvedValue({ allowed: true, remaining: 29 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the Share dialog's actions", () => {
  it("need a signed-in student", async () => {
    m.userId = null;
    expect(await getPageShareAction(target)).toEqual({ ok: false, error: "unauthorized" });
    expect(await setPageShareAction({ ...target, enabled: true })).toEqual({ ok: false, error: "unauthorized" });
    expect(m.enableShare).not.toHaveBeenCalled();
  });

  it("validate their input", async () => {
    expect(await getPageShareAction({ workspaceId: "", pageId: "pg_1" })).toEqual({ ok: false, error: "invalid" });
    expect(await setPageShareAction({ ...target, enabled: "yes" as unknown as boolean })).toEqual({ ok: false, error: "invalid" });
    expect(await setPageShareAction({ workspaceId: "x".repeat(101), pageId: "pg_1", enabled: true })).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("report the state of the student's own page, off by default", async () => {
    expect(await getPageShareAction(target)).toEqual({ ok: true, share: { enabled: false } });
    expect(m.getShareState).toHaveBeenCalledWith("user_owner", "ws_1", "pg_1");
    m.getShareState.mockResolvedValue(null);
    expect(await getPageShareAction(target)).toEqual({ ok: false, error: "not_found" });
  });

  it("turn sharing on, scoped to the signed-in student, and return the link's path", async () => {
    expect(await setPageShareAction({ ...target, enabled: true })).toEqual({
      ok: true,
      share: { enabled: true, path: `/s/${TOKEN}`, createdAt: "2026-11-13T10:00:00.000Z", viewCount: 3 },
    });
    expect(m.enableShare).toHaveBeenCalledWith("user_owner", "ws_1", "pg_1");
  });

  it("pass on ownership, limit and operator refusals", async () => {
    for (const status of ["not_found", "limit", "page_disabled", "sharing_blocked"] as const) {
      m.enableShare.mockResolvedValueOnce({ status });
      expect(await setPageShareAction({ ...target, enabled: true })).toEqual({ ok: false, error: status });
    }
  });

  it("say when an operator turned the page (or the student's sharing) off", async () => {
    m.getShareState.mockResolvedValue({ enabled: false, blocked: "page" });
    expect(await getPageShareAction(target)).toEqual({ ok: true, share: { enabled: false, blocked: "page" } });
  });

  it(`limit turning sharing on to ${SHARE_ENABLES_PER_HOUR} times an hour per student`, async () => {
    await setPageShareAction({ ...target, enabled: true });
    expect(m.claim).toHaveBeenCalledWith("user_owner", SHARE_ENABLE_KIND, SHARE_ENABLES_PER_HOUR, 60 * 60 * 1000);
    m.claim.mockResolvedValueOnce({ allowed: false, remaining: 0 });
    expect(await setPageShareAction({ ...target, enabled: true })).toEqual({ ok: false, error: "rate_limited" });
    expect(m.enableShare).toHaveBeenCalledTimes(1);
    // A hiccup of the limiter does not stop sharing.
    m.claim.mockRejectedValueOnce(new Error("db down"));
    expect((await setPageShareAction({ ...target, enabled: true })).ok).toBe(true);
  });

  it("turn sharing off for the signed-in student's own link only, never rate limited", async () => {
    m.claim.mockResolvedValue({ allowed: false, remaining: 0 });
    expect(await setPageShareAction({ ...target, enabled: false })).toEqual({ ok: true, share: { enabled: false } });
    expect(m.disableShare).toHaveBeenCalledWith("user_owner", "ws_1", "pg_1");
    expect(m.enableShare).not.toHaveBeenCalled();
    expect(m.claim).not.toHaveBeenCalled();
  });

  it("never throw to the client", async () => {
    m.enableShare.mockRejectedValueOnce(new Error("db down"));
    expect(await setPageShareAction({ ...target, enabled: true })).toEqual({ ok: false, error: "failed" });
    m.getShareState.mockRejectedValueOnce(new Error("db down"));
    expect(await getPageShareAction(target)).toEqual({ ok: false, error: "failed" });
  });
});
