import { describe, expect, it } from "vitest";
import { FALLBACK_SUPPORT_EMAIL, ownOrigins, supportEmail } from "./site";

describe("ownOrigins", () => {
  it("lists the configured app and site origins once each, without paths", () => {
    const origins = ownOrigins({
      APP_URL: "https://studyos.app/",
      NEXT_PUBLIC_APP_URL: "https://studyos.app",
      STUDYOS_APP_ORIGIN: "https://app.studyos.app",
    });
    expect(origins).toContain("https://studyos.app");
    expect(origins).toContain("https://app.studyos.app");
    expect(new Set(origins).size).toBe(origins.length);
  });

  it("skips values that are not web URLs", () => {
    const origins = ownOrigins({ APP_URL: "not a url", STUDYOS_APP_ORIGIN: "ftp://x.y" });
    expect(origins.every((o) => o.startsWith("http"))).toBe(true);
    expect(origins).not.toContain("ftp://x.y");
  });
});

describe("supportEmail", () => {
  it("uses STUDYOS_SUPPORT_EMAIL when it is a plausible address", () => {
    expect(supportEmail({ STUDYOS_SUPPORT_EMAIL: " help@studyos.app " })).toBe("help@studyos.app");
  });

  it("falls back to the owner's address when unset or malformed", () => {
    expect(supportEmail({})).toBe(FALLBACK_SUPPORT_EMAIL);
    for (const bad of ["", "nobody", "a@b", "x y@z.com", "<a@b.co>"]) {
      expect(supportEmail({ STUDYOS_SUPPORT_EMAIL: bad })).toBe(FALLBACK_SUPPORT_EMAIL);
    }
  });
});
