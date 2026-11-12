"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/interpolate";
import * as store from "@/lib/workspace/store";
import {
  InvalidWorkspaceError,
  WorkspaceTooLargeError,
} from "@/lib/workspace/repair";
import { sampleWorkspace } from "@/lib/workspace/sample";
import type { Workspace } from "@/lib/workspace/types";

/** Outcome of an autosave. Never throws for expected outcomes. */
export type SaveWorkspaceActionResult =
  | { status: "saved"; version: number }
  /** Someone (another tab, the AI agent) saved a newer version first. */
  | { status: "conflict"; version: number }
  /** The workspace no longer exists or was moved to the trash. */
  | { status: "not_found" }
  | { status: "too_large" }
  | { status: "invalid" };

/**
 * Save edits to a workspace (called by the editor's autosave). The document
 * is validated (and repaired where safe) on the server before it is written,
 * and only written if `baseVersion` is still the latest saved version.
 */
export async function saveWorkspaceAction(
  id: string,
  ws: Workspace,
  baseVersion: number,
): Promise<SaveWorkspaceActionResult> {
  if (typeof id !== "string" || !Number.isInteger(baseVersion)) {
    return { status: "invalid" };
  }
  try {
    return await store.saveWorkspace(id, ws, baseVersion);
  } catch (error) {
    if (error instanceof WorkspaceTooLargeError) return { status: "too_large" };
    if (error instanceof InvalidWorkspaceError) return { status: "invalid" };
    throw error;
  }
}

/** The latest saved workspace and its version (for resyncing an editor tab). */
export async function getWorkspaceStateAction(
  id: string,
): Promise<store.WorkspaceState | null> {
  return store.getWorkspaceState(id);
}

/** Cheap check of the latest saved version (null = gone or trashed). */
export async function getWorkspaceVersionAction(
  id: string,
): Promise<number | null> {
  return store.getWorkspaceVersion(id);
}

/** Move a workspace to the trash (restorable for 30 days). */
export async function trashWorkspaceAction(id: string): Promise<boolean> {
  const ok = await store.trashWorkspace(id);
  revalidatePath("/app");
  return ok;
}

/** Restore a workspace from the trash. */
export async function restoreWorkspaceAction(id: string): Promise<boolean> {
  const ok = await store.restoreWorkspace(id);
  revalidatePath("/app");
  return ok;
}

/** Permanently delete a workspace that is already in the trash. */
export async function deleteWorkspaceForeverAction(id: string): Promise<boolean> {
  const ok = await store.deleteWorkspacePermanently(id);
  revalidatePath("/app");
  return ok;
}

/** Duplicate a workspace; returns the new workspace's id. */
export async function duplicateWorkspaceAction(
  id: string,
): Promise<string | null> {
  const { dict } = await getI18n();
  const newId = await store.duplicateWorkspace(id, (name) =>
    fmt(dict.safety.copyName, { name }),
  );
  revalidatePath("/app");
  return newId;
}

/** Save the built-in sample workspace and open it. */
export async function loadDemoAction(): Promise<void> {
  const id = await store.saveNewWorkspace(sampleWorkspace);
  redirect(`/app/${id}`);
}
