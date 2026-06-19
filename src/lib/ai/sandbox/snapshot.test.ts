import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/workspace/sample";
import { sanitizeWorkspaceForSandbox } from "./snapshot";

describe("sandbox snapshot sanitizer", () => {
  it("emits only validated workspace fields", () => {
    const json = sanitizeWorkspaceForSandbox(sampleWorkspace);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(sampleWorkspace);
  });

  it("strips any non-workspace keys (e.g. an injected ownerId)", () => {
    const tainted = {
      ...sampleWorkspace,
      ownerId: "user-secret",
      __proto__hack: true,
    } as unknown as typeof sampleWorkspace;
    const json = sanitizeWorkspaceForSandbox(tainted);
    expect(json).not.toContain("user-secret");
    expect(json).not.toContain("ownerId");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.ownerId).toBeUndefined();
  });
});
