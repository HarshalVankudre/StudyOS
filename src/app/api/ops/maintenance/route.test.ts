import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runRetention: vi.fn(), retryAssets: vi.fn(), retryReferrals: vi.fn(), reseed: vi.fn() }));
vi.mock("@/lib/ops/retention", () => ({ runRetention: mocks.runRetention }));
vi.mock("@/lib/account/erase-user-data", () => ({ retryOrphanedAssetDeletes: mocks.retryAssets }));
vi.mock("@/lib/referral/reward", () => ({ retryPendingReferralRewards: mocks.retryReferrals }));
vi.mock("@/lib/notifications/service", () => ({ reseedNotificationSchedules: mocks.reseed }));

const REFERRALS = { tried: 3, rewarded: 1, rejected: 0, waiting: 2, failed: 0 };

import { POST } from "./route";
import { secretsMatch } from "@/lib/ops/secret";

const req = (auth?: string) =>
  new Request("http://test/api/ops/maintenance", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  mocks.runRetention.mockResolvedValue({ agentTasks: 0 });
  mocks.retryAssets.mockResolvedValue({ retried: 2, deleted: 1 });
  mocks.retryReferrals.mockResolvedValue(REFERRALS);
  mocks.reseed.mockResolvedValue(4);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.MAINTENANCE_SECRET;
});

describe("POST /api/ops/maintenance", () => {
  it("is 404 when no secret is configured", async () => {
    const res = await POST(req("Bearer anything"));
    expect(res.status).toBe(404);
    expect(mocks.runRetention).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong secret", async () => {
    process.env.MAINTENANCE_SECRET = "s3cret-value";
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer s3cret-valuX"))).status).toBe(401);
    expect((await POST(req("Bearer s3cret"))).status).toBe(401);
    expect(mocks.runRetention).not.toHaveBeenCalled();
  });

  it("runs retention with the right secret", async () => {
    process.env.MAINTENANCE_SECRET = "s3cret-value";
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      result: { agentTasks: 0 },
      orphanedAssets: { retried: 2, deleted: 1 },
      referralRewards: REFERRALS,
      notificationSchedules: 4,
    });
  });

  it("puts students who fell off the notifications schedule back on it; a failure there never fails the run", async () => {
    process.env.MAINTENANCE_SECRET = "s3cret-value";
    expect(mocks.reseed).not.toHaveBeenCalled();
    await POST(req("Bearer s3cret-value"));
    expect(mocks.reseed).toHaveBeenCalledTimes(1);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.reseed.mockRejectedValue(new Error("db down"));
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, notificationSchedules: null });
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("retries invite rewards that had to wait; a failure there never fails the run", async () => {
    process.env.MAINTENANCE_SECRET = "s3cret-value";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.retryReferrals.mockRejectedValue(new Error("clerk down"));
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, referralRewards: null });
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("reports the error counts it pruned in the run's log line", async () => {
    process.env.MAINTENANCE_SECRET = "s3cret-value";
    mocks.runRetention.mockResolvedValue({ agentTasks: 0, errorEvents: 3 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(req("Bearer s3cret-value"));
    expect((await res.json()).result).toEqual({ agentTasks: 0, errorEvents: 3 });
    const line = JSON.parse(log.mock.calls[0][0] as string);
    expect(line.result.errorEvents).toBe(3);
  });

  it("accepts a secret stored with a trailing newline", async () => {
    process.env.MAINTENANCE_SECRET = "s3cret-value\n";
    expect((await POST(req("Bearer s3cret-value"))).status).toBe(200);
  });

  it("is 404 when the secret is only whitespace", async () => {
    process.env.MAINTENANCE_SECRET = "  \n";
    expect((await POST(req("Bearer anything"))).status).toBe(404);
  });

  it("reports a failure without leaking it", async () => {
    process.env.MAINTENANCE_SECRET = "s3cret-value";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runRetention.mockRejectedValue(new Error("db down"));
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false });
    expect(err).toHaveBeenCalledTimes(1);
  });
});

describe("secretsMatch", () => {
  it("compares exactly", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    expect(secretsMatch("abc", "abcd")).toBe(false);
    expect(secretsMatch("", "abc")).toBe(false);
  });
});
