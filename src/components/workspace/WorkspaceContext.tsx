"use client";

import { createContext, useContext } from "react";
import type { Workspace } from "@/lib/workspace/types";

export type SaveStatus = "saved" | "saving" | "error";

export interface WorkspaceCtx {
  workspace: Workspace;
  /** Mutate the workspace via a draft (cloned under the hood); triggers autosave. */
  update: (mutator: (draft: Workspace) => void) => void;
  status: SaveStatus;
  /**
   * Bumps whenever the AI replaces the whole workspace. Uncontrolled inputs
   * (which use `defaultValue`) fold this into their `key` so they remount with
   * the AI's new values — manual typing leaves `rev` untouched, so the caret is
   * never disturbed mid-edit.
   */
  rev: number;
}

const Ctx = createContext<WorkspaceCtx | null>(null);

export const WorkspaceProvider = Ctx.Provider;

export function useWorkspace(): WorkspaceCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}
