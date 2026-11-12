import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: mocks.queryRaw } }));

import { GET } from "./route";

describe("GET /api/health", () => {
  it("reports ok plus a secret-free configuration status", async () => {
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.config).toHaveProperty("missingRequired");
    expect(typeof body.config.features.billing).toBe("boolean");
    const json = JSON.stringify(body);
    for (const [name, value] of Object.entries(process.env)) {
      if (/KEY|SECRET|DATABASE_URL/.test(name) && value && value.length > 6) {
        expect(json).not.toContain(value);
      }
    }
  });

  it("is 503 when the database is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.queryRaw.mockRejectedValue(new Error("connection refused"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("db");
  });
});
