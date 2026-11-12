// The shared cross-site check for state-changing API routes (security review 2, item 21).
import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOriginRequest, rejectCrossSite } from "./same-origin";

const req = (headers: Record<string, string>) =>
  new Request("https://studyos.app/api/x", { method: "POST", headers: { host: "studyos.app", ...headers } });

afterEach(() => vi.unstubAllEnvs());

describe("isSameOriginRequest", () => {
  it("lets our own pages through", () => {
    expect(isSameOriginRequest(req({ origin: "https://studyos.app", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(req({ origin: "https://STUDYOS.app" }))).toBe(true);
    expect(isSameOriginRequest(req({ "sec-fetch-site": "none" }))).toBe(true);
  });

  it("refuses other sites by Sec-Fetch-Site, sibling subdomains included", () => {
    expect(isSameOriginRequest(req({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginRequest(req({ "sec-fetch-site": "same-site", origin: "https://studyos.app" }))).toBe(false);
  });

  it("refuses a foreign, null or malformed Origin", () => {
    for (const origin of ["https://evil.example", "https://studyos.app.evil.example", "null", "not a url", "file://studyos.app"]) {
      expect(isSameOriginRequest(req({ origin }))).toBe(false);
    }
    // A different port is a different origin.
    expect(isSameOriginRequest(req({ origin: "https://studyos.app:8443" }))).toBe(false);
  });

  it("accepts the host the proxy saw, and APP_URL", () => {
    const behindProxy = new Request("http://10.0.0.5:8080/api/x", {
      method: "POST",
      headers: { host: "10.0.0.5:8080", "x-forwarded-host": "studyos.app, internal", origin: "https://studyos.app" },
    });
    expect(isSameOriginRequest(behindProxy)).toBe(true);
    vi.stubEnv("APP_URL", "https://studyos.app");
    const noForward = new Request("http://10.0.0.5:8080/api/x", {
      method: "POST",
      headers: { host: "10.0.0.5:8080", origin: "https://studyos.app" },
    });
    expect(isSameOriginRequest(noForward)).toBe(true);
  });

  it("lets a server-side client without browser headers through (no cookie to ride, not CSRF)", () => {
    expect(isSameOriginRequest(req({}))).toBe(true);
  });
});

describe("rejectCrossSite", () => {
  it("answers 403 JSON for a cross-site request and null otherwise", async () => {
    const res = rejectCrossSite(req({ origin: "https://evil.example" }));
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "forbidden" });
    expect(rejectCrossSite(req({ origin: "https://studyos.app" }))).toBeNull();
  });
});

describe("every state-changing API route checks the origin", () => {
  // Signed by the sender (webhooks) or authenticated by a bearer secret (ops).
  const EXEMPT = new Set([
    "src/app/api/stripe/webhook/route.ts",
    "src/app/api/clerk/webhook/route.ts",
    "src/app/api/ops/maintenance/route.ts",
    "src/app/api/ops/notifications/route.ts",
  ]);

  it("calls the shared check in each POST, PUT, PATCH and DELETE handler", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name === "route.ts") routes.push(path.split("\\").join("/"));
      }
    };
    walk("src/app/api");
    const missing: string[] = [];
    for (const file of routes) {
      if (EXEMPT.has(file)) continue;
      const source = readFileSync(file, "utf8");
      const handlers = [...source.matchAll(/export (?:async function|const) (POST|PUT|PATCH|DELETE)\b/g)];
      for (const [, method] of handlers) {
        const body = source.slice(source.search(new RegExp(`export (?:async function|const) ${method}\\b`)));
        const head = body.split("\n").slice(0, 4).join("\n");
        if (!/rejectCrossSite\(|sameOrigin\(|isSameOriginRequest\(/.test(head)) missing.push(`${method} ${file}`);
      }
    }
    expect(routes.length).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});
