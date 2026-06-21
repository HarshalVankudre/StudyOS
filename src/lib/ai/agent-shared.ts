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
  title: string;
  detail?: string;
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
    };
