import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ erase: vi.fn(), cancelAll: vi.fn(), tombstone: vi.fn() }));
vi.mock("@/lib/account/erase-user-data", () => ({ eraseUserData: mocks.erase }));
vi.mock("@/lib/billing", () => ({
  cancelAllBillingForUser: mocks.cancelAll,
  markAccountDeleted: mocks.tombstone,
}));

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
  mocks.erase.mockResolvedValue(undefined);
  mocks.cancelAll.mockResolvedValue(undefined);
  mocks.tombstone.mockResolvedValue(undefined);
});
afterEach(() => {
  delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
});

describe("POST /api/clerk/webhook", () => {
  it("erases the user's data on a correctly signed user.deleted", async () => {
    const res = await POST(signed(deleted("user_123")));
    expect(res.status).toBe(200);
    expect(mocks.cancelAll).toHaveBeenCalledWith("user_123");
    expect(mocks.erase).toHaveBeenCalledWith("user_123");
    expect(mocks.tombstone).toHaveBeenCalledWith("user_123");
    expect(mocks.cancelAll.mock.invocationCallOrder[0]).toBeLessThan(mocks.erase.mock.invocationCallOrder[0]);
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

  it("is 404 when the signing secret is not configured", async () => {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    expect((await POST(signed(deleted("user_1")))).status).toBe(404);
  });

  it("ignores other events", async () => {
    const res = await POST(signed({ type: "user.updated", object: "event", data: { id: "user_1" } }));
    expect(res.status).toBe(200);
    expect(mocks.erase).not.toHaveBeenCalled();
  });

  it("keeps the data and asks Clerk to retry when billing could not be stopped", async () => {
    mocks.cancelAll.mockRejectedValue(new Error("stripe down"));
    const res = await POST(signed(deleted("user_123")));
    expect(res.status).toBe(503);
    expect(mocks.erase).not.toHaveBeenCalled();
  });

  it("reports and returns 500 when erasure fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.erase.mockRejectedValue(new Error("db down"));
    const res = await POST(signed(deleted("user_123")));
    expect(res.status).toBe(500);
    expect(err).toHaveBeenCalled();
  });
});
