/**
 * Friendly descriptions of what the agent is doing, for the progress card.
 *
 * The server sends each tool step as data (`AgentStepInfo`: the tool and, for
 * a batch of edits, the kinds of operation in it). The client turns that into
 * short, translated sentences such as "Adding a page". Raw model reasoning and
 * internal names ("add_page", ids, tool names) never reach the interface.
 */
import type { AgentStepInfo } from "./agent-shared";

export type LiveStepKey =
  | "reading"
  | "finding"
  | "checking"
  | "visual"
  | "lookup"
  | "retrying"
  | "working"
  | "addPage"
  | "editPage"
  | "removePage"
  | "addRows"
  | "updateRows"
  | "removeRows"
  | "addDatabase"
  | "editDatabase"
  | "removeDatabase"
  | "grades"
  | "workspace";

const OP_STEP: Record<string, LiveStepKey> = {
  add_page: "addPage",
  update_page: "editPage",
  set_page_blocks: "editPage",
  replace_page: "editPage",
  delete_page: "removePage",
  add_row: "addRows",
  update_row: "updateRows",
  delete_row: "removeRows",
  add_database: "addDatabase",
  update_database: "editDatabase",
  replace_database: "editDatabase",
  add_property: "editDatabase",
  update_property: "editDatabase",
  delete_property: "editDatabase",
  add_view: "editDatabase",
  update_view: "editDatabase",
  delete_view: "editDatabase",
  delete_database: "removeDatabase",
  set_grades_block: "grades",
  update_workspace: "workspace",
};

const TOOL_STEP: Record<string, LiveStepKey> = {
  inspect_workspace: "reading",
  summarize_workspace: "reading",
  read_area: "reading",
  find_entities: "finding",
  validate_ops: "checking",
  check_component: "visual",
  run_in_sandbox: "visual",
  controlled_fetch: "lookup",
};

/** The step data the server attaches to a tool's progress event. */
export function toolStepInfo(tool: string, input: unknown, output: unknown): AgentStepInfo {
  const info: AgentStepInfo = { tool };
  const ok = (output as { ok?: unknown } | null)?.ok;
  if (typeof ok === "boolean") info.ok = ok;
  if (tool === "apply_ops") {
    const ops = (input as { ops?: unknown } | null)?.ops;
    if (Array.isArray(ops)) {
      const kinds = ops
        .map((op) => (op as { op?: unknown } | null)?.op)
        .filter((kind): kind is string => typeof kind === "string");
      info.ops = [...new Set(kinds)].slice(0, 20);
    }
  }
  return info;
}

/**
 * The sentence keys for one step, in a stable order and without repeats.
 * Unknown tools and operations fall back to a neutral "working" line.
 */
export function liveStepKeys(step: AgentStepInfo | undefined): LiveStepKey[] {
  if (!step) return ["working"];
  if (step.tool === "apply_ops") {
    if (step.ok === false) return ["retrying"];
    const keys = (step.ops ?? []).map((op) => OP_STEP[op] ?? "working");
    const unique = [...new Set(keys)];
    // A specific line says more than "working" next to it.
    const specific = unique.filter((k) => k !== "working");
    return specific.length ? specific.slice(0, 3) : ["working"];
  }
  if (step.tool === "check_component" && step.ok === false) return ["retrying"];
  return [TOOL_STEP[step.tool] ?? "working"];
}

/** One readable line for a step, e.g. "Adding a page · Updating entries". */
export function describeLiveStep(
  step: AgentStepInfo | undefined,
  labels: Record<LiveStepKey, string>,
): string {
  return liveStepKeys(step)
    .map((key) => labels[key])
    .join(" · ");
}
