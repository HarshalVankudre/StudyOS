"use client";

import { createContext, useContext } from "react";
import type { Workspace } from "@/lib/workspace/types";
import type { SaveStatus, UpdateOptions } from "./workspace-sync";

export type { SaveStatus, UpdateOptions };

export interface WorkspaceCtx {
  workspace: Workspace;
  /**
   * Mutate the workspace via a draft (cloned under the hood). Every call is
   * recorded in the undo history (typing in one field is merged into one
   * step), saved automatically, and a removal shows an Undo toast.
   *
   * How a block's edits survive changes made elsewhere (another device, the
   * AI agent, a crash): find what you edit BY ID inside the mutator (page id,
   * block id, card id, question id) and change it in place; never by index,
   * never by replacing a whole list or block you did not change. The engine
   * turns the edit into id-addressed changes and re-applies them on top of a
   * newer version field by field (text is merged three ways).
   *
   * For an edit computed from the value it starts from (a flashcard grade, a
   * quiz score, a counter), pass `{ rebase: "rerun" }`: the mutator itself is
   * run again on the newer version. Such a mutator must also be idempotent
   * (it can run on a document that already contains its effect, e.g. when a
   * save's reply was lost): carry a natural key such as the answer's
   * timestamp and do nothing when it is already there. See
   * study/gradeEdit.ts for the pattern.
   */
  update: (mutator: (draft: Workspace) => void, options?: UpdateOptions) => void;
  status: SaveStatus;
  /**
   * Bumps whenever the document changed other than by a plain edit (undo,
   * redo, the AI agent, another tab, a merge). Fields that buffer typing
   * follow such changes by themselves (see editor/useCommittedDraft.ts), so
   * nothing needs to remount on it.
   */
  rev: number;
  /** True while the agent is actively processing — autosave is paused and
   *  edits made meanwhile are merged onto the agent's result. */
  agentBusy: boolean;
  /** Set by AgentChat to pause/resume autosave. */
  setAgentBusy: (busy: boolean) => void;
  /** Workspace-level undo/redo (also Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z). */
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /**
   * Write everything (including typing still buffered in a field) and wait
   * until the server has it. Call before starting an AI agent task so it
   * reads the latest version; `version` is the saved version the editor is
   * on afterwards, `ok` is false when saving is stuck (offline, conflict...).
   */
  settle?: () => Promise<{ ok: boolean; version: number | null }>;
  /** The saved version the editor is currently based on. */
  getVersion?: () => number | null;
  /** Try saving again now (the Retry button). */
  retrySave?: () => void;
}

const Ctx = createContext<WorkspaceCtx | null>(null);

export const WorkspaceProvider = Ctx.Provider;

export function useWorkspace(): WorkspaceCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}
