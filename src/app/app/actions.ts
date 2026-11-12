"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  checkUsageLimit,
  MAX_WORKSPACES_PER_USER,
  workspaceLimitReached,
} from "@/lib/usage-limits";
import { getI18n } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/interpolate";
import * as store from "@/lib/workspace/store";
import {
  InvalidWorkspaceError,
  WorkspaceTooLargeError,
} from "@/lib/workspace/repair";
import { prisma } from "@/lib/db";
import { studentClock } from "@/lib/ai/student-clock";
import { buildSampleWorkspace } from "@/lib/workspace/sample";
import type { Workspace } from "@/lib/workspace/types";
import type { SaveLog } from "@/lib/workspace/save-ids";

/** Outcome of an autosave. Never throws for expected outcomes. */
export type SaveWorkspaceActionResult =
  | { status: "saved"; version: number }
  /**
   * Someone (another tab, the AI agent) saved a newer version first. `saves`
   * says which editor save produced which version, so the tab can tell
   * whether one of its own landed (lib/workspace/save-ids.ts).
   */
  | { status: "conflict"; version: number; saves?: SaveLog }
  /** The workspace no longer exists or was moved to the trash. */
  | { status: "not_found" }
  | { status: "too_large" }
  | { status: "invalid" };

/**
 * Save edits to a workspace (called by the editor's autosave). The document
 * is validated (and repaired where safe) on the server before it is written,
 * and only written if `baseVersion` is still the latest saved version.
 * `saveId` and `tabId` (from the editor) are recorded with the new version.
 */
export async function saveWorkspaceAction(
  id: string,
  ws: Workspace,
  baseVersion: number,
  saveId?: string,
  tabId?: string,
): Promise<SaveWorkspaceActionResult> {
  if (typeof id !== "string" || !Number.isInteger(baseVersion)) {
    return { status: "invalid" };
  }
  try {
    // An editor's save always names itself to the save log. One that does not
    // (a tab of a build from before the log) must not look like a server-side
    // write: "" makes its version one of unknown origin (save-ids.ts).
    return await store.saveWorkspace(id, ws, baseVersion, saveId ?? "", tabId ?? "");
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

export type DuplicateWorkspaceResult =
  | { ok: true; id: string }
  | { ok: false; code: "not_found" | "limit" | "rate_limited"; message: string };

/**
 * Duplicate a workspace. Each copy can be up to 2 MB, so copies are
 * rate-limited and count toward the per-account workspace cap.
 */
export async function duplicateWorkspaceAction(
  id: string,
): Promise<DuplicateWorkspaceResult> {
  const { dict } = await getI18n();
  const { userId } = await auth();
  if (!userId || typeof id !== "string" || id.length > 100) {
    return { ok: false, code: "not_found", message: dict.safety.actionFailed };
  }
  if (await workspaceLimitReached(userId)) {
    return {
      ok: false,
      code: "limit",
      message: fmt(dict.limits.workspaceCap, { max: MAX_WORKSPACES_PER_USER }),
    };
  }
  if (!(await checkUsageLimit(userId, "workspace_duplicate")).allowed) {
    return { ok: false, code: "rate_limited", message: dict.limits.rateLimited };
  }
  const newId = await store.duplicateWorkspace(id, (name) =>
    fmt(dict.safety.copyName, { name }),
  );
  revalidatePath("/app");
  return newId
    ? { ok: true, id: newId }
    : { ok: false, code: "not_found", message: dict.safety.actionFailed };
}

/**
 * The student's local day, in the time zone the Today plan recorded on their
 * first visit (UTC when there is none yet), so the demo's dates sit around
 * their today and nothing in it starts out overdue.
 */
async function studentToday(userId: string | null): Promise<string> {
  try {
    const config = userId
      ? await prisma.dailyStudyAgentConfig.findUnique({ where: { userId }, select: { timeZone: true } })
      : null;
    return studentClock(config?.timeZone).date;
  } catch {
    return studentClock().date;
  }
}

/** Save the built-in sample workspace and open it. */
export async function loadDemoAction(): Promise<void> {
  const { userId } = await auth();
  // The demo button only shows on an empty home page; an account at the
  // workspace cap (reachable only by posting the action directly) gets none.
  if (userId && (await workspaceLimitReached(userId))) redirect("/app");
  const id = await store.saveNewWorkspace(buildSampleWorkspace(await studentToday(userId)));
  redirect(`/app/${id}`);
}
