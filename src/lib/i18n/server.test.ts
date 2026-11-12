import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  headers: new Headers(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "studyos_locale" && request.cookie ? { name, value: request.cookie } : undefined,
  }),
  headers: async () => request.headers,
}));

import { getLocale } from "./server";

describe("getLocale", () => {
  const saved = process.env.STUDYOS_GEO_COUNTRY;
  beforeEach(() => {
    request.cookie = undefined;
    request.headers = new Headers();
    delete process.env.STUDYOS_GEO_COUNTRY;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.STUDYOS_GEO_COUNTRY;
    else process.env.STUDYOS_GEO_COUNTRY = saved;
  });

  it("an explicit choice (the cookie) wins over everything", async () => {
    request.cookie = "ja";
    request.headers = new Headers({ "accept-language": "de-DE,de;q=0.9", "x-vercel-ip-country": "FR" });
    expect(await getLocale()).toBe("ja");
  });

  it("the browser's language wins over the visitor's country", async () => {
    request.headers = new Headers({ "accept-language": "en-US,en;q=0.9" });
    process.env.STUDYOS_GEO_COUNTRY = "DE";
    expect(await getLocale()).toBe("en");
  });

  it("geography is used when the browser states no supported language", async () => {
    request.headers = new Headers({ "accept-language": "ru-RU" });
    process.env.STUDYOS_GEO_COUNTRY = "DE";
    expect(await getLocale()).toBe("de");
  });

  it("falls back to English", async () => {
    expect(await getLocale()).toBe("en");
  });
});
