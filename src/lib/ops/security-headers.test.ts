import { describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "../../../next.config";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function headersFor(path: string): Promise<Record<string, string>> {
  const rules = (await nextConfig.headers!()) as HeaderRule[];
  const out: Record<string, string> = {};
  for (const rule of rules) {
    // Same matcher Next uses for custom header routes.
    if (getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(path)) {
      for (const h of rule.headers) out[h.key.toLowerCase()] = h.value;
    }
  }
  return out;
}

describe("app Content-Security-Policy", () => {
  it.each(["/", "/app", "/app/settings", "/privacy", "/sign-in", "/api/health"])(
    "restricts frames on %s",
    async (path) => {
      const csp = (await headersFor(path))["content-security-policy"];
      expect(csp).toBeDefined();
      const frameSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("frame-src"));
      expect(frameSrc).toBeDefined();
      // Only our own origin and the Clerk/Stripe frame hosts; never a wildcard.
      expect(frameSrc).toContain("'self'");
      expect(frameSrc).not.toMatch(/(^|\s)(\*|https:|http:|data:|blob:)(\s|$)/);
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
    },
  );

  it("does not restrict scripts or styles (Clerk, KaTeX, Mermaid, Next inline scripts)", async () => {
    const csp = (await headersFor("/app"))["content-security-policy"];
    expect(csp).not.toMatch(/script-src|style-src|default-src|connect-src|img-src/);
  });

  it.each(["/embed/react", "/embed"])(
    "leaves %s to the route's own nonce CSP",
    async (path) => {
      const headers = await headersFor(path);
      expect(headers["content-security-policy"]).toBeUndefined();
      // The other hardening headers still apply.
      expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    },
  );
});
