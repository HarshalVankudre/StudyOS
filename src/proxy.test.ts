// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// clerkMiddleware hands back the handler itself; createRouteMatcher matches
// like Clerk's (path-to-regexp patterns over the request's pathname).
vi.mock("@clerk/nextjs/server", async () => {
  const { createRequire: requireFrom } = await import("node:module");
  const { pathToRegexp } = requireFrom(import.meta.url)("next/dist/compiled/path-to-regexp") as {
    pathToRegexp: (path: string, keys: unknown[], options: object) => RegExp;
  };
  return {
    clerkMiddleware: (handler: unknown) => handler,
    createRouteMatcher: (patterns: string[]) => {
      const regexps = patterns.map((p) => pathToRegexp(p, [], {}));
      return (req: { nextUrl: URL }) => regexps.some((r) => r.test(req.nextUrl.pathname));
    },
  };
});

import { createRequire } from "node:module";
import proxy, { config, isNewVisitorBuild, returnBackUrl } from "./proxy";

// Next's own compiler for `config.matcher`, the one the build uses (not in
// its type declarations, hence the require).
const { getMiddlewareMatchers } = createRequire(import.meta.url)(
  "next/dist/build/analysis/get-page-static-info",
) as { getMiddlewareMatchers: (matcher: unknown, nextConfig: object) => { regexp: string }[] };

const request = (url: string) => ({ url, nextUrl: new URL(url) });

describe("which paths run through the proxy (Clerk)", () => {
  const matchers = getMiddlewareMatchers(config.matcher, {}).map((m) => new RegExp(m.regexp));
  const runs = (path: string) => matchers.some((m) => m.test(path));

  it("skips the share images of the public pages", () => {
    for (const path of ["/opengraph-image", "/twitter-image", "/pricing/opengraph-image", "/pricing/twitter-image"]) {
      expect(runs(path), path).toBe(false);
    }
  });

  it("still runs for every page, the signed-in areas and the APIs", () => {
    for (const path of [
      "/",
      "/pricing",
      "/terms",
      "/privacy",
      "/legal-notice",
      "/app",
      "/app/abc",
      "/app/opengraph-image",
      "/app/abc/twitter-image",
      "/generate",
      "/generate/opengraph-image",
      "/sign-in",
      "/api/health",
      "/opengraph-images-gallery",
    ]) {
      expect(runs(path), path).toBe(true);
    }
  });

  it("skips static files and Next's assets, as before", () => {
    for (const path of ["/icon.png", "/sw.js", "/manifest.webmanifest", "/_next/static/chunks/a.js"]) {
      expect(runs(path), path).toBe(false);
    }
  });
});

describe("shared pages (/s/<token>)", () => {
  const token = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  const matchers = getMiddlewareMatchers(config.matcher, {}).map((m) => new RegExp(m.regexp));
  const runs = (path: string) => matchers.some((m) => m.test(path));
  type Handler = (auth: () => Promise<unknown>, req: ReturnType<typeof request>) => Promise<unknown>;
  const handler = proxy as unknown as Handler;

  it("run through the proxy (Clerk), so 'Save a copy' knows who is signed in", () => {
    for (const path of [`/s/${token}`, `/s/${token}/asset/asset_1`]) {
      expect(runs(path), path).toBe(true);
    }
  });

  it("let signed-out visitors through, while the app still sends them to sign in", async () => {
    const redirectToSignIn = vi.fn(() => "to-sign-in");
    const auth = vi.fn(async () => ({ userId: null, redirectToSignIn }));
    for (const path of [`/s/${token}`, `/s/${token}/asset/asset_1`]) {
      expect(await handler(auth, request(`https://app.example.com${path}`)), path).toBeUndefined();
    }
    expect(redirectToSignIn).not.toHaveBeenCalled();
    expect(await handler(auth, request("https://app.example.com/app/w1"))).toBe("to-sign-in");
    expect(await handler(auth, request("https://app.example.com/generate"))).toBe("to-sign-in");
  });
});

describe("invite links (/r/<code>)", () => {
  const matchers = getMiddlewareMatchers(config.matcher, {}).map((m) => new RegExp(m.regexp));
  const runs = (path: string) => matchers.some((m) => m.test(path));
  type Handler = (auth: () => Promise<unknown>, req: ReturnType<typeof request>) => Promise<unknown>;
  const handler = proxy as unknown as Handler;

  it("run through the proxy (Clerk), so the route knows a visitor is already signed in", () => {
    expect(runs("/r/K7MPQ2XR")).toBe(true);
  });

  it("let signed-out visitors through: the friend opening the link has no account yet", async () => {
    const redirectToSignIn = vi.fn(() => "to-sign-in");
    const auth = vi.fn(async () => ({ userId: null, redirectToSignIn }));
    expect(await handler(auth, request("https://app.example.com/r/K7MPQ2XR"))).toBeUndefined();
    expect(redirectToSignIn).not.toHaveBeenCalled();
  });
});

describe("email unsubscribe links (/api/notifications/unsubscribe)", () => {
  type Handler = (auth: () => Promise<unknown>, req: ReturnType<typeof request>) => Promise<unknown>;
  const handler = proxy as unknown as Handler;
  const matchers = getMiddlewareMatchers(config.matcher, {}).map((m) => new RegExp(m.regexp));
  const runs = (path: string) => matchers.some((m) => m.test(path));

  it("skip the proxy (Clerk) altogether: mail apps post to them signed out", () => {
    expect(runs("/api/notifications/unsubscribe")).toBe(false);
    expect(runs("/api/notifications/unsubscribe/")).toBe(false);
  });

  it("leave every other notifications API, and look-alike paths, running through it", () => {
    for (const path of [
      "/api/notifications/settings",
      "/api/notifications/email",
      "/api/notifications/test",
      "/api/notifications/unsubscribed",
      "/api/notifications/unsubscribe-all",
      "/api/ops/notifications",
      "/api/notifications",
      "/api",
      "/trpc/x",
    ]) {
      expect(runs(path), path).toBe(true);
    }
  });

  it("let signed-out visitors and mail apps through: the signed token is the credential", async () => {
    const redirectToSignIn = vi.fn(() => "to-sign-in");
    const auth = vi.fn(async () => ({ userId: null, redirectToSignIn }));
    expect(await handler(auth, request("https://app.example.com/api/notifications/unsubscribe?t=abc.def"))).toBeUndefined();
    expect(redirectToSignIn).not.toHaveBeenCalled();
  });
});

describe("the landing page's prompt form (/generate?prompt=…)", () => {
  type Handler = (auth: () => Promise<unknown>, req: ReturnType<typeof request>) => Promise<unknown>;
  const handler = proxy as unknown as Handler;

  it("sends a signed-out visitor who typed a prompt to sign-up, with the prompt kept for afterwards", async () => {
    const redirectToSignIn = vi.fn(() => "to-sign-in");
    const redirectToSignUp = vi.fn(() => "to-sign-up");
    const auth = vi.fn(async () => ({ userId: null, redirectToSignIn, redirectToSignUp }));
    const url = "https://app.example.com/generate?prompt=Biology%20101%20and%20Statistics";
    expect(await handler(auth, request(url))).toBe("to-sign-up");
    expect(redirectToSignUp).toHaveBeenCalledWith({ returnBackUrl: url });
    expect(redirectToSignIn).not.toHaveBeenCalled();
  });

  it("keeps sign-in for the generator without a prompt and for the app", async () => {
    const redirectToSignIn = vi.fn(() => "to-sign-in");
    const redirectToSignUp = vi.fn(() => "to-sign-up");
    const auth = vi.fn(async () => ({ userId: null, redirectToSignIn, redirectToSignUp }));
    for (const path of ["/generate", "/generate?prompt=", "/generate?prompt=%20%20", "/app?prompt=x", "/app/w1"]) {
      expect(await handler(auth, request(`https://app.example.com${path}`)), path).toBe("to-sign-in");
    }
    expect(redirectToSignUp).not.toHaveBeenCalled();
  });

  it("lets a signed-in student straight through", async () => {
    const redirectToSignUp = vi.fn();
    const auth = vi.fn(async () => ({ userId: "user_1", redirectToSignIn: vi.fn(), redirectToSignUp }));
    expect(await handler(auth, request("https://app.example.com/generate?prompt=Chemistry"))).toBeUndefined();
    expect(redirectToSignUp).not.toHaveBeenCalled();
  });

  it("recognises only the generator itself", () => {
    const at = (url: string) => isNewVisitorBuild(request(url));
    expect(at("https://a.example/generate?prompt=x")).toBe(true);
    expect(at("https://a.example/generate/?prompt=x")).toBe(true);
    expect(at("https://a.example/generate/opengraph-image?prompt=x")).toBe(false);
    expect(at("https://a.example/generate")).toBe(false);
  });
});

describe("sign-in return address", () => {
  it("uses the public address, not the server's internal one, behind a reverse proxy", () => {
    // What the app sees on its own server: the proxy's scheme, its own host.
    const req = request("https://localhost:3000/app/abc?tab=today");
    expect(returnBackUrl(req, { APP_URL: "https://app.example.com" })).toBe(
      "https://app.example.com/app/abc?tab=today",
    );
    expect(returnBackUrl(req, { NEXT_PUBLIC_APP_URL: "https://app.example.com/" })).toBe(
      "https://app.example.com/app/abc?tab=today",
    );
  });

  it("prefers APP_URL over NEXT_PUBLIC_APP_URL", () => {
    const req = request("https://localhost:3000/generate");
    expect(
      returnBackUrl(req, { APP_URL: "https://a.example.com", NEXT_PUBLIC_APP_URL: "https://b.example.com" }),
    ).toBe("https://a.example.com/generate");
  });

  it("keeps the request's own URL when no public address is configured or it is malformed", () => {
    const req = request("https://preview-123.example.app/app");
    expect(returnBackUrl(req, {})).toBe("https://preview-123.example.app/app");
    expect(returnBackUrl(req, { APP_URL: "  " })).toBe("https://preview-123.example.app/app");
    expect(returnBackUrl(req, { APP_URL: "not a url" })).toBe("https://preview-123.example.app/app");
  });
});
