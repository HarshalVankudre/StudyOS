// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ unsubscribe: vi.fn() }));
vi.mock("@/lib/notifications/service", () => ({ unsubscribeEmail: m.unsubscribe }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: vi.fn() }));

import { signUnsubscribeToken, unsubscribeKey } from "@/lib/email/unsubscribe";
import { de } from "@/lib/i18n/dictionaries/de";
import { en } from "@/lib/i18n/dictionaries/en";
import { escapeHtml } from "@/lib/email/render";
import { GET, POST } from "./route";

const SECRET = "sk_test_unsubscribe_route";
const url = (token: string) => `https://app.studyos.test/api/notifications/unsubscribe?t=${token}`;
let token: string;

beforeEach(() => {
  vi.stubEnv("CLERK_SECRET_KEY", SECRET);
  token = signUnsubscribeToken("user_1", unsubscribeKey({ CLERK_SECRET_KEY: SECRET })!);
  m.unsubscribe.mockReset();
  m.unsubscribe.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** What a mail app sends for one-click unsubscribe (RFC 8058). */
const oneClick = (t: string) =>
  new Request(url(t), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });

describe("POST (one-click, RFC 8058)", () => {
  it("turns email off for the student the link names and answers 200 with no body, no sign-in needed", async () => {
    const res = await POST(oneClick(token));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(m.unsubscribe).toHaveBeenCalledWith("user_1");
  });

  it("refuses a tampered or foreign link and changes nothing", async () => {
    const other = signUnsubscribeToken("user_1", unsubscribeKey({ CLERK_SECRET_KEY: "another" })!);
    const [id, sig] = token.split(".");
    const swapped = `${Buffer.from("user_2").toString("base64url")}.${sig}`;
    for (const bad of [other, swapped, `${id}.`, "", "nonsense"]) {
      expect((await POST(oneClick(bad))).status, bad).toBe(400);
    }
    expect(m.unsubscribe).not.toHaveBeenCalled();
  });

  it("keeps links already sent working across key rotations (UNSUBSCRIBE_SECRET, its previous value, the Clerk key)", async () => {
    const OWN = "own-unsubscribe-secret-0123456789abcdef";
    const OLD = "old-unsubscribe-secret-0123456789abcdef";
    vi.stubEnv("UNSUBSCRIBE_SECRET", OWN);
    vi.stubEnv("UNSUBSCRIBE_SECRET_PREVIOUS", OLD);
    const signedWith = (env: Record<string, string>) => signUnsubscribeToken("user_1", unsubscribeKey(env)!);
    for (const t of [
      // Sent before UNSUBSCRIBE_SECRET existed (the Clerk-derived key).
      token,
      signedWith({ UNSUBSCRIBE_SECRET: OLD }),
      signedWith({ UNSUBSCRIBE_SECRET: OWN }),
    ]) {
      expect((await POST(oneClick(t))).status).toBe(200);
    }
    expect(m.unsubscribe).toHaveBeenCalledTimes(3);
    expect((await POST(oneClick(signedWith({ UNSUBSCRIBE_SECRET: "never-configured-here-0123456789ab" })))).status).toBe(400);
  });

  it("answers 500 when it could not be saved, so the mail app may try again", async () => {
    m.unsubscribe.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await POST(oneClick(token))).status).toBe(500);
  });

  it("shows a confirmation page when a person pressed the page's button", async () => {
    const res = await POST(
      new Request(url(token), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "accept-language": "de-DE,de;q=0.9" },
        body: "confirm=1",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toContain(escapeHtml(de.email.unsubDoneTitle));
    expect(html).toContain(`<html lang="de"`);
    expect(m.unsubscribe).toHaveBeenCalledWith("user_1");
  });
});

describe("GET (the link opened in a browser, or by a link scanner)", () => {
  it("changes nothing: it shows a page whose button posts back with the same link", async () => {
    const res = await GET(new Request(url(token)));
    expect(res.status).toBe(200);
    expect(m.unsubscribe).not.toHaveBeenCalled();
    const html = await res.text();
    expect(html).toContain(escapeHtml(en.email.unsubTitle));
    expect(html).toContain(`<form method="post" action="/api/notifications/unsubscribe?t=${token}">`);
    expect(html).toContain(`<input type="hidden" name="confirm" value="1">`);
    expect(html).toContain(`href="/app/settings#notifications"`);
    // The token is in the address: no referrer, no caching, no indexing.
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    // Also in the page itself (a site-wide Referrer-Policy header may win over the route's).
    expect(html).toContain(`<meta name="referrer" content="no-referrer">`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("is in the visitor's language: their StudyOS choice first, then the browser's", async () => {
    const cookie = await (await GET(new Request(url(token), { headers: { cookie: "a=1; studyos_locale=ar", "accept-language": "de" } }))).text();
    expect(cookie).toContain(`<html lang="ar" dir="rtl">`);
    const browser = await (await GET(new Request(url(token), { headers: { "accept-language": "fr-FR,fr;q=0.9,en;q=0.5" } }))).text();
    expect(browser).toContain(`<html lang="fr" dir="ltr">`);
    const fallback = await (await GET(new Request(url(token)))).text();
    expect(fallback).toContain(`<html lang="en" dir="ltr">`);
  });

  it("explains a link that does not work, without a button", async () => {
    const res = await GET(new Request(url("broken.link")));
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain(escapeHtml(en.email.unsubInvalidTitle));
    expect(html).not.toContain("<form");
  });
});
