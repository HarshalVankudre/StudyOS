import { describe, expect, it } from "vitest";
import { securityContact, securityTxt } from "./security-txt";

const NOW = new Date("2026-11-13T10:20:30.456Z");

describe("securityTxt", () => {
  it("names a contact and an expiry less than a year ahead (RFC 9116)", () => {
    const text = securityTxt(NOW, { STUDYOS_SUPPORT_EMAIL: "help@studyos.example" }, "https://studyos.example");
    expect(text).toContain("Contact: mailto:help@studyos.example\n");
    const expires = /^Expires: (.+)$/m.exec(text)?.[1];
    expect(expires).toBe("2027-05-12T10:20:30Z");
    const ms = new Date(expires!).getTime() - NOW.getTime();
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(365 * 24 * 60 * 60 * 1000);
    expect(text).toContain("Canonical: https://studyos.example/.well-known/security.txt\n");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("prefers a dedicated security address, ignoring an implausible one", () => {
    expect(securityContact({ STUDYOS_SECURITY_EMAIL: "security@studyos.example", STUDYOS_SUPPORT_EMAIL: "help@studyos.example" })).toBe(
      "security@studyos.example",
    );
    expect(securityContact({ STUDYOS_SECURITY_EMAIL: "not an address", STUDYOS_SUPPORT_EMAIL: "help@studyos.example" })).toBe(
      "help@studyos.example",
    );
  });
});
