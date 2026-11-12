import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
  allow: vi.fn(),
  build: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth, currentUser: mocks.currentUser }));
vi.mock("@/lib/account/export-user-data", () => ({
  allowDataExport: mocks.allow,
  buildUserDataExport: mocks.build,
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "user_1" });
  mocks.currentUser.mockResolvedValue({ firstName: "Ada", lastName: null, emailAddresses: [{ emailAddress: "ada@uni.edu" }] });
  mocks.allow.mockResolvedValue(true);
  mocks.build.mockResolvedValue({ exportedAt: "2026-11-12T00:00:00.000Z", workspaces: [] });
});

describe("GET /api/account/export", () => {
  it("requires sign-in", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await GET()).status).toBe(401);
  });

  it("returns one JSON attachment", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="studyos-data-2026-11-12.json"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ exportedAt: "2026-11-12T00:00:00.000Z", workspaces: [] });
    expect(mocks.build).toHaveBeenCalledWith("user_1", { email: "ada@uni.edu", name: "Ada" });
  });

  it("is rate-limited", async () => {
    mocks.allow.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(429);
    expect(mocks.build).not.toHaveBeenCalled();
  });
});
