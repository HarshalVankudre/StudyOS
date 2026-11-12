import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  erase: vi.fn(),
  stopBilling: vi.fn(),
  tombstone: vi.fn(),
  report: vi.fn(),
}));
vi.mock("@/lib/account/erase-user-data", () => ({ eraseUserData: mocks.erase }));
vi.mock("@/lib/billing", () => ({
  markAccountDeleted: mocks.tombstone,
  stopBillingForDeletedAccount: mocks.stopBilling,
}));
vi.mock("@/lib/ops/report-error", () => ({ reportError: mocks.report }));

import { POST } from "./route";

const KEY = randomBytes(24);
const SECRET = `whsec_${KEY.toString("base64")}`;

/** A request signed exactly like Svix/Clerk does (HMAC-SHA256 of id.timestamp.body). */
function signed(payload: unknown, opts: { key?: Buffer; timestamp?: number } = {}) {
  const body = JSON.stringify(payload);
  const id = `msg_${randomBytes(6).toString("hex")}`;
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", opts.key ?? KEY).update(`${id}.${ts}.${body}`).digest("base64");
  return new Request("http://test/api/clerk/webhook", {
    method: "POST",
    headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}`, "content-type": "application/json" },
    body,
  });
}

const deleted = (id: string) => ({ type: "user.deleted", object: "event", data: { id, deleted: true, object: "user" } });

beforeEach(() => {
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = SECRET;
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.erase.mockResolvedValue(undefined);
  mocks.stopBilling.mockResolvedValue(true);
  mocks.tombstone.mockResolvedValue(undefined);
});
afterEach(() => {
  delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  vi.unstubAllEnvs();
});

describe("POST /api/clerk/webhook", () => {
  it("tombstones, stops billing, then erases on a correctly signed user.deleted", async () => {
    const res = await POST(signed(deleted("user_123")));
    expect(res.status).toBe(200);
    expect(mocks.tombstone).toHaveBeenCalledWith("user_123");
    expect(mocks.stopBilling).toHaveBeenCalledWith("user_123");
    expect(mocks.erase).toHaveBeenCalledWith("user_123");
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0];
    expect(order(mocks.tombstone)).toBeLessThan(order(mocks.stopBilling));
    expect(order(mocks.stopBilling)).toBeLessThan(order(mocks.erase));
  });

  it("rejects a bad signature, a stale timestamp and missing headers", async () => {
    expect((await POST(signed(deleted("user_1"), { key: randomBytes(24) }))).status).toBe(400);
    expect(
      (await POST(signed(deleted("user_1"), { timestamp: Math.floor(Date.now() / 1000) - 3600 }))).status,
    ).toBe(400);
    const unsigned = new Request("http://test/api/clerk/webhook", { method: "POST", body: "{}" });
    expect((await POST(unsigned)).status).toBe(400);
    expect(mocks.erase).not.toHaveBeenCalled();
  });

  it("is 404 when the signing secret is not configured and billing is off", async () => {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect((await POST(signed(deleted("user_1")))).status).toBe(404);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("fails loudly (503, reported) when billing is on but the signing secret is missing", async () => {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_x");
    const res = await POST(signed(deleted("user_1")));
    expect(res.status).toBe(503);
    expect(mocks.report).toHaveBeenCalled();
    expect(mocks.erase).not.toHaveBeenCalled();
  });

  it("ignores other events", async () => {
    const res = await POST(signed({ type: "user.updated", object: "event", data: { id: "user_1" } }));
    expect(res.status).toBe(200);
    expect(mocks.erase).not.toHaveBeenCalled();
  });

  it("still erases when Stripe is down (the cancel stays queued for the maintenance job) and asks Clerk to retry", async () => {
    mocks.stopBilling.mockResolvedValue(false);
    const res = await POST(signed(deleted("user_123")));
    expect(res.status).toBe(503);
    expect(mocks.tombstone).toHaveBeenCalledWith("user_123");
    expect(mocks.erase).toHaveBeenCalledWith("user_123");
  });

  it("writes nothing else when the tombstone cannot be written", async () => {
    mocks.tombstone.mockRejectedValue(new Error("db down"));
    const res = await POST(signed(deleted("user_123")));
    expect(res.status).toBe(500);
    expect(mocks.stopBilling).not.toHaveBeenCalled();
    expect(mocks.erase).not.toHaveBeenCalled();
  });

  it("reports and returns 500 when erasure fails", async () => {
    mocks.erase.mockRejectedValue(new Error("db down"));
    const res = await POST(signed(deleted("user_123")));
    expect(res.status).toBe(500);
    expect(mocks.report).toHaveBeenCalled();
  });
});
