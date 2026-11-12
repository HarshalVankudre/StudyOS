"use client";

import { createContext, useContext } from "react";
import type { Workspace } from "@/lib/workspace/types";
import type { SaveStatus } from "./workspace-sync";

export type { SaveStatus };

export interface WorkspaceCtx {
  workspace: Workspace;
  /**
   * Mutate the workspace via a draft (cloned under the hood). Every call is
   * recorded in the undo history (typing in one field is merged into one
   * step), saved automatically, and a removal shows an Undo toast.
   */
  update: (mutator: (draft: Workspace) => void) => void;
  status: SaveStatus;
  /**
   * Bumps whenever the whole workspace is replaced (undo/redo, the AI agent,
   * a newer version from another tab). Uncontrolled inputs (which use
   * `defaultValue`) fold this into their `key` so they remount with the new
   * values; manual typing leaves `rev` untouched, so the caret is never
   * disturbed mid-edit.
   */
  rev: number;
  /** True while the agent is actively processing — autosave is paused and
   *  edits made meanwhile are replayed on top of the agent's result. */
  agentBusy: boolean;
  /** Set by AgentChat to pause/resume autosave. */
  setAgentBusy: (busy: boolean) => void;
  /** Workspace-level undo/redo (also Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z). */
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

const Ctx = createContext<WorkspaceCtx | null>(null);

export const WorkspaceProvider = Ctx.Provider;

export function useWorkspace(): WorkspaceCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}
