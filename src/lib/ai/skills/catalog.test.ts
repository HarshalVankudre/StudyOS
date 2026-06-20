import { describe, expect, it } from "vitest";
import { skillRegistry } from "./registry";
import "./catalog";

describe("stage 1 skills", () => {
  it("registers precise-edit, study-planner, quality-reviewer with valid tool sets", () => {
    for (const id of ["precise-edit", "study-planner", "quality-reviewer"]) {
      const skill = skillRegistry.get(id);
      expect(skill, id).toBeDefined();
      expect(skill!.toolIds.length).toBeGreaterThan(0);
    }
  });
});
