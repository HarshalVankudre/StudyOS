import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { APP_ONLY_SOURCES, parseAppOrigin, websiteRedirects } from "./site-split";

// The matcher Next.js uses for a redirect's `source`.
const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (path: string, keys: unknown[], options: object) => RegExp;
};
const redirected = (path: string) =>
  websiteRedirects("https://app.example.com").some((r) => pathToRegexp(r.source, [], {}).test(path));

describe("website / app split", () => {
  it("is off without STUDYOS_APP_ORIGIN: the app deployment redirects nothing", () => {
    expect(parseAppOrigin(undefined)).toBeNull();
    expect(parseAppOrigin("  ")).toBeNull();
    expect(websiteRedirects(null)).toEqual([]);
  });

  it("accepts a bare origin and drops a trailing slash", () => {
    expect(parseAppOrigin("https://app.example.com")).toBe("https://app.example.com");
    expect(parseAppOrigin(" https://app.example.com/ ")).toBe("https://app.example.com");
    expect(parseAppOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("refuses anything that is not a bare http(s) origin", () => {
    for (const bad of [
      "app.example.com",
      "https://app.example.com/app",
      "https://app.example.com/?x=1",
      "https://user:pass@app.example.com",
      "ftp://app.example.com",
      "javascript:alert(1)",
    ]) {
      expect(() => parseAppOrigin(bad), bad).toThrow(/STUDYOS_APP_ORIGIN/);
    }
  });

  it("sends every app-only path to the same path on the app's host, temporarily", () => {
    const redirects = websiteRedirects("https://app.example.com");
    expect(redirects.map((r) => r.source)).toEqual([...APP_ONLY_SOURCES]);
    for (const r of redirects) {
      expect(r.destination).toBe(`https://app.example.com${r.source}`);
      expect(r.permanent).toBe(false);
    }
    // The pages the website itself serves are never redirected.
    const sources = new Set(redirects.map((r) => r.source));
    for (const own of ["/", "/pricing", "/terms", "/privacy"]) expect(sources.has(own)).toBe(false);
  });

  it("serves the public pages and their share images itself", () => {
    for (const own of [
      "/",
      "/pricing",
      "/terms",
      "/privacy",
      "/legal-notice",
      // Link previews fetch og:image from the shared page's host.
      "/opengraph-image",
      "/twitter-image",
      "/pricing/opengraph-image",
      "/pricing/twitter-image",
      "/sitemap.xml",
      "/robots.txt",
    ]) {
      expect(redirected(own), own).toBe(false);
    }
    for (const app of ["/app", "/app/abc", "/generate", "/sign-in", "/sign-up/verify", "/api/health", "/embed/react"]) {
      expect(redirected(app), app).toBe(true);
    }
  });

  it("covers what needs a session, the database or a model", () => {
    for (const needed of ["/app/:path*", "/generate", "/sign-in/:path*", "/sign-up/:path*", "/api/:path*", "/s/:path*", "/r/:path*"]) {
      expect(APP_ONLY_SOURCES).toContain(needed);
    }
  });

  it("sends shared pages and their images to the app (they read the database), keeping the token", () => {
    const token = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    for (const path of [`/s/${token}`, `/s/${token}/asset/asset_1`]) {
      expect(redirected(path), path).toBe(true);
    }
    const share = websiteRedirects("https://app.example.com").find((r) => r.source === "/s/:path*");
    expect(share?.destination).toBe("https://app.example.com/s/:path*");
    // Website pages that merely start with "s" stay on the website.
    for (const own of ["/sitemap.xml", "/sign", "/s-tier"]) expect(redirected(own), own).toBe(false);
  });
});

describe("withdrawal function and cancellation button (/withdraw, /cancel)", () => {
  it("are sent to the app, which has the database to store the notice", () => {
    for (const path of ["/withdraw", "/cancel"]) {
      expect(redirected(path), path).toBe(true);
      const redirect = websiteRedirects("https://app.example.com").find((r) => r.source === path);
      expect(redirect).toEqual({ source: path, destination: `https://app.example.com${path}`, permanent: false });
    }
    // Website pages that merely start with the same letters stay on the website.
    for (const own of ["/withdrawal-info", "/cancellation", "/canceled"]) expect(redirected(own), own).toBe(false);
  });
});

describe("invite links (/r/<code>)", () => {
  it("are sent to the app, keeping the code, so the invite cookie is set on the app's origin", () => {
    expect(redirected("/r/K7MPQ2XR")).toBe(true);
    const invite = websiteRedirects("https://app.example.com").find((r) => r.source === "/r/:path*");
    expect(invite?.destination).toBe("https://app.example.com/r/:path*");
    expect(invite?.permanent).toBe(false);
    // Website pages that merely start with "r" stay on the website.
    for (const own of ["/robots.txt", "/roadmap", "/r-and-d"]) expect(redirected(own), own).toBe(false);
  });
});
