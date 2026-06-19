/**
 * Server-side skill registry.
 *
 * A skill is a versioned bundle of planner instructions plus the set of tool ids
 * it is allowed to use. A skill cannot self-grant a capability: registering a
 * skill that references a tool which is not registered (or is disabled by policy)
 * throws, so a skill can only ever call tools the server already enabled.
 */
import { type ToolRegistry, toolRegistry } from "../tools/registry";
import "../tools/builtin"; // ensure the app registry is populated before skills

export interface SkillDefinition {
  id: string;
  version: string;
  /** Server-side guidance for the planner; never shown to the user. */
  instructions: string;
  /** Tools this skill may call — each must be registered and enabled. */
  toolIds: string[];
}

export interface SkillRegistry {
  register(skill: SkillDefinition): void;
  get(id: string): SkillDefinition | undefined;
  list(): string[];
}

export function createSkillRegistry(
  tools: ToolRegistry = toolRegistry,
): SkillRegistry {
  const skills = new Map<string, SkillDefinition>();
  return {
    register(skill) {
      if (!skill?.id || !skill.version || !Array.isArray(skill.toolIds)) {
        throw new Error(`invalid skill: ${skill?.id ?? "(no id)"}`);
      }
      for (const id of skill.toolIds) {
        const tool = tools.get(id);
        if (!tool || tool.enabled === false) {
          throw new Error(
            `skill "${skill.id}" references unavailable tool "${id}"`,
          );
        }
      }
      skills.set(skill.id, skill);
    },
    get: (id) => skills.get(id),
    list: () => [...skills.keys()],
  };
}

export const skillRegistry = createSkillRegistry();

// Initial skill: workspace design/layout repair, using only enabled tools.
skillRegistry.register({
  id: "layout-repair",
  version: "1.0.0",
  instructions:
    "Inspect the workspace, then propose the smallest set of operations that improves layout and readability. Validate the operations before returning them.",
  toolIds: ["inspect_workspace", "validate_ops"],
});
