import "../tools/builtin";          // inspect_workspace, validate_ops, controlled_fetch
import "../tools/workspace-tools";  // summarize_workspace, find_entities, read_area, apply_ops
import "../tools/register-sandbox"; // run_in_sandbox (gated by AGENT_SANDBOX)
import "../tools/component-tools";  // check_component (interactive artifacts)
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

  registry.register({
    id: "interactive-builder",
    version: "1.0.0",
    instructions:
      "Build ONE self-contained interactive React component. Write a top-level component named `App` (function App(){...}) using ONLY the globals `React` and `Recharts` (Recharts for charts) — NO import/export statements. If it needs data, read it first with the inspection tools and bake the values into the source as literals (it has no live data access). Call check_component and fix any error it reports. Then insert it via apply_ops with set_page_blocks as a block { type:'react_artifact', title:<short>, source:<the component> }. Keep ids exact.",
    toolIds: [...INSPECT, "check_component", "apply_ops"],
  });

  registry.register({
    id: "flashcard-maker",
    version: "1.0.0",
    instructions:
      "Create or extend a spaced-repetition flashcard deck. If the user points at existing material (a page, notes, a course, a topic in the workspace), inspect it first with find_entities/read_area and ground the cards in that content; otherwise generate from your own knowledge of the topic. Then apply_ops with set_page_blocks appending (or updating) a block of shape { id, type:'flashcards', title:<short topic>, cards:[{ id:<uuid>, front:<question/term>, back:<answer/definition> }, ...] }. Write clear, atomic Q&A pairs — one fact per card, question on the front, concise answer on the back. Default to 10-20 cards unless the user asks for a specific count. NEVER set the scheduling fields (ease, intervalDays, reps, dueAt, lastReviewedAt) — new cards omit them. Reuse existing ids exactly; generate a fresh uuid for each new card.",
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
