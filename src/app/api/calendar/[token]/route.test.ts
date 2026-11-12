// GET /api/calendar/<token>: completed items only when the link asks for them.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ resolve: vi.fn(), build: vi.fn() }));
vi.mock("@/lib/calendar/feed", () => ({ resolveUserByToken: m.resolve, buildUserFeed: m.build }));

import { GET } from "./route";

const get = (query = "") =>
  GET(new Request(`http://localhost/api/calendar/tok${query}`), {
    params: Promise.resolve({ token: "tok" }),
  });

beforeEach(() => {
  m.resolve.mockResolvedValue("user_1");
  m.build.mockResolvedValue("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
});

describe("calendar feed route", () => {
  it("leaves completed items out by default", async () => {
    const res = await get();
    expect(res.headers.get("Content-Type")).toContain("text/calendar");
    expect(m.build).toHaveBeenCalledWith("user_1", expect.any(Date), { includeCompleted: false });
  });

  it("includes them with ?completed=1, the option the settings page offers", async () => {
    await get("?completed=1");
    expect(m.build).toHaveBeenCalledWith("user_1", expect.any(Date), { includeCompleted: true });
  });

  it("404s an unknown token", async () => {
    m.resolve.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(m.build).not.toHaveBeenCalled();
  });
});
