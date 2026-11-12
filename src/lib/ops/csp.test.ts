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
});
