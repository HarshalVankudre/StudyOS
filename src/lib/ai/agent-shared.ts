/**
 * Shared, dependency-free types for the in-workspace AI agent.
 *
 * Kept separate from `agent.ts` (which is server-only) so the chat UI can import
 * the message/response shapes without pulling server code into the client bundle.
 */
import type { Workspace } from "@/lib/workspace/types";

/** One turn of the conversation, as sent back to the model for context. */
export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentChoice {
  id: string;
  label: string;
  /** Message sent back to the agent when the user selects this choice. */
  value: string;
}

export interface AgentArea {
  id: string;
  type: "page" | "database";
  label: string;
  icon?: string;
}

/** What the agent returns for a single user turn. */
export interface AgentResponse {
  /** The chat message to show the user. */
  reply: string;
  /** True when the agent rewrote the workspace this turn. */
  changed: boolean;
  /** The full updated workspace — present only when `changed` is true. */
  workspace?: Workspace;
  /** Choices shown when the agent needs the user to disambiguate a request. */
  choices?: AgentChoice[];
  /** Workspace areas inspected or changed during this turn. */
  affectedAreas?: AgentArea[];
  /** Server-generated id for the agent change that may be undone. */
  changeId?: string;
  /** Credits this turn cost (0 when nothing ran, e.g. the local mock). */
  creditsCost?: number;
  /** The user's credit balance after this turn was charged. */
  creditsBalance?: number;
  /**
   * Set when the turn stopped early at its limit (credits, steps or time)
   * instead of finishing; any changes made before the stop were kept.
   */
  stopReason?: "budget" | "time";
  /**
   * Server-only: compact, id-bearing note of what changed, stored with the
   * reply so follow-ups can refer back. Stripped before reaching the client.
   */
  changeNote?: string;
}

/** Undo state of a stored agent change, as the server can honour it now. */
export type AgentUndoState = "available" | "undone" | "unavailable";

/** One persisted chat message, as the history endpoint returns it. */
export interface AgentChatHistoryItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelContent?: string;
  changed?: boolean;
  choices?: AgentChoice[];
  affectedAreas?: AgentArea[];
  changeId?: string;
  undo?: AgentUndoState;
  creditsCost?: number;
  stopReason?: "budget" | "time";
  createdAt: string;
}

export type AgentPhase =
  | "inspecting"
  | "planning"
  | "updating"
  | "validating"
  | "saving";

export type AgentAreaStatus = "queued" | "working" | "complete";

/** A completed, user-facing milestone in the Living Story (no technical detail). */
export interface AgentDiscovery {
  id: string;
  /** Server-side English summary; the interface shows `step` instead when present. */
  title: string;
  detail?: string;
  /** What the step did, as data the client turns into a translated sentence. */
  step?: AgentStepInfo;
}

/** The machine-readable side of one agent step (see lib/ai/agent-steps.ts). */
export interface AgentStepInfo {
  tool: string;
  ok?: boolean;
  /** For apply_ops: the distinct kinds of change in the batch ("add_page", ...). */
  ops?: string[];
}

export type AgentStreamEvent =
  | {
      // Sent once at the start so the client can reconnect to / cancel this task.
      type: "task";
      taskId: string;
    }
  | {
      type: "phase";
      phase: AgentPhase;
      message: string;
      progress: number;
    }
  | {
      type: "plan";
      summary: string;
      areas: AgentArea[];
    }
  | {
      type: "area";
      areaId: string;
      status: AgentAreaStatus;
      progress: number;
    }
  | {
      type: "discovery";
      discovery: AgentDiscovery;
      progress: number;
    }
  | {
      // Live reasoning ("thinking") tokens streamed from the model as it works.
      // Ephemeral UX: streamed to the client but not persisted, so it does not
      // replay on reconnect. `delta` is an incremental chunk to append.
      type: "thinking";
      phase: AgentPhase;
      delta: string;
    }
  | {
      type: "result";
      response: AgentResponse;
    }
  | {
      type: "error";
      message: string;
      /**
       * Machine-readable reason. "insufficient_credits" and "stale_workspace"
       * are refusals before any model ran (nothing was charged).
       * "workspace_conflict": the work was done but overlaps edits saved
       * during the task, so it was not applied (and not charged).
       */
      code?:
        | "insufficient_credits"
        | "stale_workspace"
        | "workspace_conflict"
        | "rate_limited"
        | "failed";
    };
