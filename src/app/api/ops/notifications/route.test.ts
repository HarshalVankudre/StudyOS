import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), channels: vi.fn() }));
vi.mock("@/lib/notifications/dispatch", () => ({ runNotificationDispatch: mocks.dispatch }));
vi.mock("@/lib/notifications/channels", () => ({ defaultChannels: mocks.channels }));
vi.mock("@/lib/notifications/store", () => ({ prismaNotificationStore: { kind: "prisma" } }));

import { POST } from "./route";

const req = (auth?: string) =>
  new Request("http://test/api/ops/notifications", { method: "POST", headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  mocks.channels.mockReturnValue([{ name: "push" }]);
  mocks.dispatch.mockResolvedValue({ users: 2, sent: 1, skipped: 1, failed: 0, errors: 0 });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.MAINTENANCE_SECRET;
});

describe("POST /api/ops/notifications", () => {
  it("does not exist without the maintenance secret", async () => {
    expect((await POST(req("Bearer x"))).status).toBe(404);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("rejects a wrong or missing secret", async () => {
    process.env.MAINTENANCE_SECRET = "s3cret-value";
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer nope"))).status).toBe(401);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("does nothing when push is not configured", async () => {
    process.env.MAINTENANCE_SECRET = "s3cret-value";
    mocks.channels.mockReturnValue([]);
    const res = await POST(req("Bearer s3cret-value"));
    expect(await res.json()).toEqual({ ok: true, skipped: "not_configured" });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("runs the dispatch and reports counts only", async () => {
    process.env.MAINTENANCE_SECRET = "s3cret-value";
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { users: 2, sent: 1, skipped: 1, failed: 0, errors: 0 } });
    expect(mocks.dispatch).toHaveBeenCalledWith({ store: { kind: "prisma" }, channels: [{ name: "push" }] });
  });

  it("reports a failure without details", async () => {
    process.env.MAINTENANCE_SECRET = "s3cret-value";
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.dispatch.mockRejectedValue(new Error("db down"));
    const res = await POST(req("Bearer s3cret-value"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false });
  });
});
