import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: mocks.queryRaw } }));

import { GET } from "./route";

const SECRET = "maintenance-secret-value-1234567890";

/** A complete production configuration (values are fakes). */
const CONFIGURED = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@h/db",
  CLERK_SECRET_KEY: "sk_test_secretvalue",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
  STUDYOS_FREE_MODEL: "z-ai/glm-5.2",
  STUDYOS_PRO_MODEL: "z-ai/glm-5.2",
  OPENROUTER_API_KEY: "sk-or-secretvalue",
  FEED_URL_KEY: "feed-url-key-value-1234567890abcdef",
  MAINTENANCE_SECRET: SECRET,
};

function request(token?: string): Request {
  return new Request("http://localhost/api/health", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  for (const [name, value] of Object.entries(CONFIGURED)) vi.stubEnv(name, value);
  mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  it("gives anonymous callers a bare ok and nothing about configuration", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not reveal details for a wrong secret", async () => {
    const res = await GET(request("not-the-secret"));
    expect(await res.json()).toEqual({ ok: true });
  });

  it("shows the secret-free configuration view to the operator", async () => {
    const res = await GET(request(SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.config.missingRequired).toEqual([]);
    expect(typeof body.config.features.billing).toBe("boolean");
    const json = JSON.stringify(body);
    for (const value of Object.values(CONFIGURED)) {
      if (value.length > 6) expect(json).not.toContain(value);
    }
  });

  it("is 503 when required configuration is missing", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    const anonymous = await GET(request());
    expect(anonymous.status).toBe(503);
    expect(await anonymous.json()).toEqual({ ok: false });

    const operator = await GET(request(SECRET));
    expect(operator.status).toBe(503);
    const body = await operator.json();
    expect(body.reason).toBe("config");
    expect(body.config.missingRequired).toEqual(["CLERK_SECRET_KEY"]);
  });

  it("stays 200 with an optional secret missing, and puts the warnings first in the operator view", async () => {
    vi.stubEnv("FEED_URL_KEY", "");
    const anonymous = await GET(request());
    expect(anonymous.status).toBe(200);
    expect(await anonymous.json()).toEqual({ ok: true });

    const operator = await GET(request(SECRET));
    expect(operator.status).toBe(200);
    const body = await operator.json();
    expect(Object.keys(body).slice(0, 2)).toEqual(["ok", "warnings"]);
    expect(body.warnings.join(" ")).toMatch(/FEED_URL_KEY is not set, so connecting calendar links is OFF/);
    expect(body.warnings.join(" ")).toMatch(/Clerk.s own profile screen KEEP THEIR STUDYOS DATA/);
    expect(body.config.features.feedLinks).toBe(false);
    const json = JSON.stringify(body);
    for (const value of Object.values(CONFIGURED)) {
      if (value.length > 6) expect(json).not.toContain(value);
    }
  });

  it("is 503 when the database is unreachable", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("connection refused"));
    const anonymous = await GET(request());
    expect(anonymous.status).toBe(503);
    expect(await anonymous.json()).toEqual({ ok: false });
    const operator = await GET(request(SECRET));
    expect((await operator.json()).reason).toBe("db");
  });

  it("never shows details when no maintenance secret is configured", async () => {
    vi.stubEnv("MAINTENANCE_SECRET", "");
    const res = await GET(request(""));
    expect(await res.json()).toEqual({ ok: true });
  });
});
