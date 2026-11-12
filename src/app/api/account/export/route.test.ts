import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
  allow: vi.fn(),
  stream: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth, currentUser: mocks.currentUser }));
vi.mock("@/lib/account/export-user-data", () => ({
  allowDataExport: mocks.allow,
  streamUserDataExport: mocks.stream,
}));

import { GET } from "./route";

function streamOf(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-12T10:00:00Z"), toFake: ["Date"] });
  mocks.auth.mockResolvedValue({ userId: "user_1" });
  mocks.currentUser.mockResolvedValue({ firstName: "Ada", lastName: null, emailAddresses: [{ emailAddress: "ada@uni.edu" }] });
  mocks.allow.mockResolvedValue(true);
  mocks.stream.mockImplementation(async () => streamOf(['{"exportedAt":"2026-11-12T10:00:00.000Z",', '"workspaces":[]}']));
});

afterEach(() => vi.useRealTimers());

describe("GET /api/account/export", () => {
  it("requires sign-in", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await GET()).status).toBe(401);
  });

  it("streams one JSON attachment", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="studyos-data-2026-11-12.json"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ exportedAt: "2026-11-12T10:00:00.000Z", workspaces: [] });
    expect(mocks.stream.mock.calls[0].slice(0, 2)).toEqual(["user_1", { email: "ada@uni.edu", name: "Ada" }]);
  });

  it("answers 500 when the export cannot start", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stream.mockRejectedValue(new Error("db down"));
    expect((await GET()).status).toBe(500);
  });

  it("is rate-limited", async () => {
    mocks.allow.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(429);
    expect(mocks.stream).not.toHaveBeenCalled();
  });
});
