import { describe, expect, it } from "vitest";
import { buildAppCsp, clerkFrontendApiOrigin } from "./csp";

const directive = (csp: string, name: string) =>
  csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
const keyFor = (host: string, kind = "test") => `pk_${kind}_${Buffer.from(`${host}$`).toString("base64")}`;

describe("clerkFrontendApiOrigin", () => {
  it("reads the frontend API host from a publishable key", () => {
    expect(clerkFrontendApiOrigin(keyFor("good-cat-12.clerk.accounts.dev"))).toBe("https://good-cat-12.clerk.accounts.dev");
    expect(clerkFrontendApiOrigin(keyFor("clerk.studyos.app", "live"))).toBe("https://clerk.studyos.app");
  });

  it("refuses anything that is not a host", () => {
    expect(clerkFrontendApiOrigin(undefined)).toBeNull();
    expect(clerkFrontendApiOrigin("pk_test_x")).toBeNull();
    expect(clerkFrontendApiOrigin(keyFor("evil.com; script-src *"))).toBeNull();
    expect(clerkFrontendApiOrigin(`pk_test_${Buffer.from("no-dollar.example.com").toString("base64")}`)).toBeNull();
  });
});

describe("buildAppCsp", () => {
  const clerk = keyFor("good-cat-12.clerk.accounts.dev");

  it("scopes img-src to the bucket's path, and allows no storage host without one", () => {
    expect(directive(buildAppCsp({ assetsBucket: "studyos-assets" }), "img-src")).toBe(
      "img-src 'self' data: blob: https://img.clerk.com https://storage.googleapis.com/studyos-assets/",
    );
    const none = directive(buildAppCsp({}), "img-src")!;
    expect(none).not.toContain("storage.googleapis.com");
    expect(directive(buildAppCsp({ assetsBucket: "Bad Bucket/../x" }), "img-src")).not.toContain("storage");
  });

  it("allows fetches only to our origin, Clerk and Stripe's API", () => {
    const connect = directive(buildAppCsp({ clerkPublishableKey: clerk }), "connect-src")!;
    const sources = connect.split(/\s+/).slice(1);
    expect(sources).toEqual([
      "'self'",
      "https://good-cat-12.clerk.accounts.dev",
      "https://*.protect.clerk.com:*",
      "https://clerk-telemetry.com",
      "https://*.clerk-telemetry.com",
      "https://img.clerk.com",
      "https://api.stripe.com",
    ]);
    expect(sources).not.toContain("https:");
    expect(sources).not.toContain("*");
  });

  it("adds a Clerk proxy origin", () => {
    const connect = directive(buildAppCsp({ clerkPublishableKey: clerk, clerkProxyUrl: "https://studyos.app/__clerk" }), "connect-src")!;
    expect(connect).toContain("https://studyos.app");
  });

  it("leaves connect-src out rather than lock sign-in out when Clerk's host is unknown", () => {
    expect(directive(buildAppCsp({}), "connect-src")).toBeUndefined();
  });

  it("keeps form posts on our origin plus Stripe's checkout and portal redirects", () => {
    const csp = buildAppCsp({ clerkPublishableKey: clerk });
    expect(directive(csp, "form-action")).toBe("form-action 'self' https://checkout.stripe.com https://billing.stripe.com");
    expect(directive(csp, "worker-src")).toBe("worker-src 'self' blob:");
    expect(directive(csp, "manifest-src")).toBe("manifest-src 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'self'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(csp).not.toMatch(/script-src|style-src|default-src/);
  });

  it("lets Clerk's sign-up bot check (Clerk Protect, Turnstile) run in development and production", () => {
    // Development instance (pk_test_, *.clerk.accounts.dev) and production
    // instance on our own domain (pk_live_, clerk.<domain>): both derive the
    // frontend API from the key, and both allow the same bot-check hosts.
    for (const key of [clerk, keyFor("clerk.studyos.app", "live")]) {
      const csp = buildAppCsp({ clerkPublishableKey: key });
      const connect = directive(csp, "connect-src")!.split(/\s+/);
      const frame = directive(csp, "frame-src")!.split(/\s+/);
      expect(connect).toContain(clerkFrontendApiOrigin(key));
      // Protect probes <id>.client.protect.clerk.com on 443, 8443, 18443, 2082
      // and 992; a source without a port would match 443 only.
      expect(connect).toContain("https://*.protect.clerk.com:*");
      expect(frame).toEqual(expect.arrayContaining(["https://challenges.cloudflare.com", "https://*.protect.clerk.com"]));
      expect(frame).toEqual(expect.arrayContaining(["https://js.stripe.com", "https://hooks.stripe.com"]));
      expect(directive(csp, "img-src")).toContain("https://img.clerk.com");
      expect(directive(csp, "worker-src")).toBe("worker-src 'self' blob:");
    }
    expect(directive(buildAppCsp({ clerkPublishableKey: keyFor("clerk.studyos.app", "live") }), "connect-src")).toContain(
      "https://clerk.studyos.app",
    );
  });
});
