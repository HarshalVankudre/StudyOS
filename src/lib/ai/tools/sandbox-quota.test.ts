// The sandbox cost guard: credits are reserved before a run, the daily quota
// is checked after (so a broke user's refusal never burns a slot), and the
// hold is settled or released by outcome.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  reserve: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/credits", () => ({
  SANDBOX_RUN_CREDITS: 2,
  reserveCredits: m.reserve,
  settleCreditHold: m.settle,
  releaseCreditHold: m.release,
}));
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: m.limit }));

import { sandboxRunQuota } from "./sandbox-quota";

const HOLD = { id: "hold_s", userId: "u", amount: 2, reason: "sandbox_run" };

beforeEach(() => {
  m.reserve.mockResolvedValue(HOLD);
  m.settle.mockResolvedValue(2);
  m.release.mockResolvedValue(true);
  m.limit.mockResolvedValue({ allowed: true, remaining: 3 });
});

describe("sandboxRunQuota", () => {
  it("reserves the run's price, then settles it to that price", async () => {
    const r = await sandboxRunQuota().reserve("u");
    expect(m.reserve).toHaveBeenCalledWith("u", { estimate: 2, min: 2, reason: "sandbox_run" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await r.charge.settle();
    expect(m.settle).toHaveBeenCalledWith(HOLD, 2);
    await r.charge.release();
    expect(m.release).toHaveBeenCalledWith(HOLD);
  });

  it("refuses without credits before touching the daily quota", async () => {
    m.reserve.mockResolvedValue(null);
    expect(await sandboxRunQuota().reserve("u")).toEqual({ ok: false, reason: "credits" });
    expect(m.limit).not.toHaveBeenCalled();
  });

  it("gives the credits straight back when the daily quota refuses (or cannot be read)", async () => {
    m.limit.mockResolvedValue({ allowed: false, remaining: 0 });
    expect(await sandboxRunQuota().reserve("u")).toEqual({ ok: false, reason: "quota" });
    expect(m.release).toHaveBeenCalledWith(HOLD);

    m.release.mockClear();
    m.limit.mockRejectedValue(new Error("db down"));
    await expect(sandboxRunQuota().reserve("u")).rejects.toThrow("db down");
    expect(m.release).toHaveBeenCalledWith(HOLD);
  });
});
