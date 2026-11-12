import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => vi.restoreAllMocks());

let ip = 0;
const req = (body: unknown, headers: Record<string, string> = {}, client = `10.0.0.${++ip}`) =>
  new Request("http://app.test/api/ops/client-error", {
    method: "POST",
    headers: { host: "app.test", origin: "http://app.test", "x-forwarded-for": client, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/ops/client-error", () => {
  it("forwards a boundary report to reportError", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      req({ boundary: "global", name: "TypeError", message: "x is undefined", digest: "123", path: "/app/ws?q=1" }),
    );
    expect(res.status).toBe(204);
    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry.message).toContain("TypeError: x is undefined");
    expect(entry.labels).toMatchObject({ source: "client", boundary: "global", digest: "123", path: "/app/ws" });
  });

  it("refuses cross-origin posts", async () => {
    const res = await POST(req({ message: "x" }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("rejects oversized and malformed bodies", async () => {
    expect((await POST(req("x".repeat(9_000)))).status).toBe(413);
    expect((await POST(req("not json"))).status).toBe(400);
  });

  it("rate-limits a client that loops", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await POST(req({ message: "loop" }, {}, "10.9.9.9"))).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 204)).toBe(true);
    expect(statuses[6]).toBe(429);
  });
});
