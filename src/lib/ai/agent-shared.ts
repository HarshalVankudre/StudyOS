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
}

export type AgentPhase =
  | "inspecting"
  | "planning"
  | "updating"
  | "validating"
  | "saving";

export type AgentAreaStatus = "queued" | "working" | "complete";

export type AgentStreamEvent =
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
      type: "result";
      response: AgentResponse;
    }
  | {
      type: "error";
      message: string;
    };
