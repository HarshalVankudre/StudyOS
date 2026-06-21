import { describe, expect, it } from "vitest";
import { skillRegistry } from "./registry";
import "./catalog";

describe("interactive-builder skill", () => {
  it("is registered with check_component + apply_ops in its toolIds", () => {
    const skill = skillRegistry.get("interactive-builder");
    expect(skill).toBeTruthy();
    expect(skill!.toolIds).toContain("check_component");
    expect(skill!.toolIds).toContain("apply_ops");
  });
});
