import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createToolRegistry, type ToolDefinition } from "../tools/registry";
import { createSkillRegistry } from "./registry";

function tool(id: string, enabled = true): ToolDefinition {
  return {
    id,
    description: id,
    input: z.object({}),
    output: z.object({}),
    limits: { timeoutMs: 1000 },
    networkPermission: "none",
    enabled,
    handler: () => ({}),
  };
}

describe("skill registry", () => {
  it("registers a skill that references only enabled tools", () => {
    const tools = createToolRegistry();
    tools.register(tool("inspect_workspace"));
    const skills = createSkillRegistry(tools);
    expect(() =>
      skills.register({
        id: "layout-repair",
        version: "1.0.0",
        instructions: "do the thing",
        toolIds: ["inspect_workspace"],
      }),
    ).not.toThrow();
    expect(skills.list()).toContain("layout-repair");
  });

  it("rejects a skill referencing an unknown tool (cannot self-grant)", () => {
    const tools = createToolRegistry();
    const skills = createSkillRegistry(tools);
    expect(() =>
      skills.register({
        id: "bad",
        version: "1.0.0",
        instructions: "x",
        toolIds: ["shell_exec"],
      }),
    ).toThrow();
  });

  it("rejects a skill referencing a registered-but-disabled tool", () => {
    const tools = createToolRegistry();
    tools.register(tool("shell_exec", false));
    const skills = createSkillRegistry(tools);
    expect(() =>
      skills.register({
        id: "bad",
        version: "1.0.0",
        instructions: "x",
        toolIds: ["shell_exec"],
      }),
    ).toThrow();
  });
});
