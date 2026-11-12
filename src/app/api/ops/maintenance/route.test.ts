import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runRetention: vi.fn() }));
vi.mock("@/lib/ops/retention", () => ({ runRetention: mocks.runRetention }));

import { POST } from "./route";
import { secretsMatch } from "@/lib/ops/secret";

const req = (auth?: string) =>
  new Request("http://test/api/ops/maintenance", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  mocks.runRetention.mockResolvedValue({ agentTasks: 0 });
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
    expect(await res.json()).toEqual({ ok: true, result: { agentTasks: 0 } });
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
