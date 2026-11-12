import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), search: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: mocks.limit }));
vi.mock("@/lib/search/server", () => ({ searchForOwner: mocks.search }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: vi.fn() }));

import { GET } from "./route";

const req = (q: string) => new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`);

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "user_1" });
  mocks.limit.mockResolvedValue({ allowed: true, remaining: 10 });
  mocks.search.mockResolvedValue({ query: "x", groups: [], total: 0 });
});

describe("GET /api/search", () => {
  it("requires sign-in", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await GET(req("x"))).status).toBe(401);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("searches as the signed-in owner and is never cached", async () => {
    const res = await GET(req("calculus"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.limit).toHaveBeenCalledWith("user_1", "search");
    expect(mocks.search).toHaveBeenCalledWith("user_1", "calculus");
  });

  it("is rate-limited", async () => {
    mocks.limit.mockResolvedValue({ allowed: false, remaining: 0 });
    expect((await GET(req("x"))).status).toBe(429);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("caps the query length", async () => {
    await GET(req("a".repeat(500)));
    expect(mocks.search.mock.calls[0][1]).toHaveLength(200);
  });

  it("fails closed with a 500", async () => {
    mocks.search.mockRejectedValue(new Error("db down"));
    expect((await GET(req("x"))).status).toBe(500);
  });
});
