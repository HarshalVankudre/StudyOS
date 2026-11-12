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
    expect(csp).not.toMatch(/script-src|style-src|default-src/);
  });

  it("limits form targets, workers and the manifest", async () => {
    const csp = (await headersFor("/app"))["content-security-policy"];
    expect(csp).toContain("form-action 'self' https://checkout.stripe.com https://billing.stripe.com");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("manifest-src 'self'");
  });

  it("limits images to our origin, inline images, Clerk and the assets bucket", async () => {
    const csp = (await headersFor("/app"))["content-security-policy"];
    const imgSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("img-src"));
    expect(imgSrc).toBeDefined();
    const sources = imgSrc!.split(/\s+/).slice(1);
    expect(sources).toEqual(
      expect.arrayContaining(["'self'", "data:", "blob:", "https://img.clerk.com"]),
    );
    // No wildcard that would let Markdown images reach an arbitrary host.
    expect(sources).not.toEqual(expect.arrayContaining(["*"]));
    expect(sources).not.toContain("https:");
    expect(sources).not.toContain("http:");
    // Without ASSETS_BUCKET at build time no storage host at all (never the
    // whole storage.googleapis.com host); with it, that bucket's path only
    // (see csp.test.ts).
    expect(sources).not.toContain("https://storage.googleapis.com");
    for (const s of sources.filter((x) => x.includes("storage.googleapis.com"))) {
      expect(s).toMatch(/^https:\/\/storage\.googleapis\.com\/[a-z0-9._-]+\/$/);
    }
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
