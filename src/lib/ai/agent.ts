/**
 * Shared helpers of the in-workspace AI agent.
 *
 * The agent itself is the bounded tool loop in agent-loop.ts. The earlier
 * two-call planner/editor (which sent the whole workspace on both calls) was
 * removed; only what the loop still uses lives here.
 */
import type { Workspace } from "@/lib/workspace/types";
import type { AgentArea } from "./agent-shared";

/** Every page and database of a workspace, as areas the agent can name. */
export function workspaceAreas(workspace: Workspace): AgentArea[] {
  return [
    ...workspace.pages.map(
      (page): AgentArea => ({
        id: page.id,
        type: "page",
        label: page.title,
        icon: page.icon,
      }),
    ),
    ...workspace.databases.map(
      (database): AgentArea => ({
        id: database.id,
        type: "database",
        label: database.name,
        icon: database.icon,
      }),
    ),
  ];
}
