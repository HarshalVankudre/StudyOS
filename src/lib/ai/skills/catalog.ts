import "../tools/builtin";          // inspect_workspace, validate_ops, controlled_fetch
import "../tools/workspace-tools";  // summarize_workspace, find_entities, read_area, apply_ops
import "../tools/register-sandbox"; // run_in_sandbox (gated by AGENT_SANDBOX)
import { skillRegistry, type SkillRegistry } from "./registry";
import { agentSandboxEnabled } from "@/lib/flags";

const INSPECT = ["summarize_workspace", "find_entities", "read_area", "inspect_workspace"];

export function registerStage1Skills(registry: SkillRegistry = skillRegistry): void {
  registry.register({
    id: "precise-edit",
    version: "1.0.0",
    instructions:
      "Make the smallest correct change. Locate the exact target with find_entities/read_area, then call apply_ops with the minimal operations. Never touch unrelated areas. Reuse existing ids exactly.",
    toolIds: [...INSPECT, "apply_ops"],
  });

  registry.register({
    id: "study-planner",
    version: "1.0.0",
    instructions:
      "Build or update study/revision/exam/assignment plans. Inspect existing courses, deadlines, and trackers first; coordinate changes across the relevant databases and pages; express each as a minimal apply_ops operation. Keep dates ISO and leave unknown facts as TBD.",
    toolIds: [...INSPECT, "apply_ops"],
  });

  registry.register({
    id: "quality-reviewer",
    version: "1.0.0",
    instructions:
      "Final review for any change. Re-inspect the staged result, confirm references resolve and nothing unrelated changed, and either confirm or request one more apply_ops fix. Mandatory before finishing a mutating turn.",
    toolIds: [...INSPECT, "apply_ops"],
  });

  // This guard MUST stay in sync with the same `agentSandboxEnabled()` guard in
  // ../tools/register-sandbox.ts: when the flag is off the tool is not registered,
  // and the skill registry rejects a skill that references an absent toolId.
  if (agentSandboxEnabled()) {
    registry.register({
      id: "render-visual",
      version: "1.0.0",
      instructions:
        "Use when the request needs a rendered image (LaTeX, a diagram, a plot). Write the source with run_in_sandbox (inputs + run commands that write files under out/, list them in outputs). For each returned artifact, read the target page and call apply_ops with set_page_blocks that appends a media block { type:'media', assetId:<handle.assetId>, mediaKind:'image', mime:<handle.mime>, caption:<short> }. Keep ids exact; never inline the image yourself.",
      toolIds: [...INSPECT, "apply_ops", "run_in_sandbox"],
    });
  }
}

registerStage1Skills();
