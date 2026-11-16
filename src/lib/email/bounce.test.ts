// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bounceHash, refusalApplies } from "./bounce";

const ENV = { CLERK_SECRET_KEY: "sk_test_bounce" };

describe("the hash of a refused address", () => {
  it("is the same for the same address, whatever its case or spacing, and never the address itself", () => {
    const hash = bounceHash("Student@Example.com", ENV)!;
    expect(bounceHash(" student@example.com ", ENV)).toBe(hash);
    expect(hash).not.toContain("student");
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("differs per address and per server secret, and is null without one", () => {
    expect(bounceHash("a@example.com", ENV)).not.toBe(bounceHash("b@example.com", ENV));
    expect(bounceHash("a@example.com", ENV)).not.toBe(bounceHash("a@example.com", { CLERK_SECRET_KEY: "sk_test_other" }));
    expect(bounceHash("a@example.com", {})).toBeNull();
  });
});

describe("whether a refusal still applies", () => {
  const hash = (address: string) => bounceHash(address, ENV);

  it("applies to the refused address only", () => {
    const stored = hash("old@example.com");
    expect(refusalApplies(stored, "OLD@example.com", hash)).toBe(true);
    expect(refusalApplies(stored, "new@example.com", hash)).toBe(false);
  });

  it("applies to any address when it cannot be compared (no hash stored, or no secret now)", () => {
    expect(refusalApplies(null, "any@example.com", hash)).toBe(true);
    expect(refusalApplies(hash("old@example.com"), "new@example.com", () => null)).toBe(true);
  });
});
