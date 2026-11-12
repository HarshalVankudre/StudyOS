import { describe, expect, it } from "vitest";
import { FALLBACK_SUPPORT_EMAIL, supportEmail } from "./site";

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
