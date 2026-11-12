import { describe, expect, it } from "vitest";
import { LOCALES } from "./config";
import { CLERK_APP_NAME, clerkLocalization } from "./clerk";

function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
}

describe("clerkLocalization", () => {
  it("titles the sign-in and sign-up cards with our name, not Clerk's dashboard setting", () => {
    const en = clerkLocalization("en");
    expect(en.signIn?.start?.title).toBe(`Sign in to ${CLERK_APP_NAME}`);
    expect(en.signIn?.emailCode?.subtitle).toBe(`to continue to ${CLERK_APP_NAME}`);
  });

  it("leaves no {{applicationName}} outside the OAuth consent screens, in every language", () => {
    for (const { code: locale } of LOCALES) {
      const all = strings(clerkLocalization(locale));
      expect(all.length).toBeGreaterThan(100);
      const left = all.filter(([path, v]) => v.includes("{{applicationName}}") && !path.startsWith("oauthConsent"));
      expect(left, locale).toEqual([]);
    }
  });

  it("keeps the OAuth consent placeholder, which names the third-party app", () => {
    const consent = strings(clerkLocalization("en").oauthConsent);
    expect(consent.some(([, v]) => v.includes("{{applicationName}}"))).toBe(true);
  });
});
