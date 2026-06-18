"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { editWorkspace } from "@/lib/ai/generate";
import { modelForPlan } from "@/lib/ai/plans";
import { getUserPlan } from "@/lib/billing";
import { getLocale } from "@/lib/i18n/server";
import * as store from "@/lib/workspace/store";
import { sampleWorkspace } from "@/lib/workspace/sample";
import type { Workspace } from "@/lib/workspace/types";

/** Save edits to a workspace (called by the editor's autosave). */
export async function updateWorkspaceAction(
  id: string,
  ws: Workspace,
): Promise<void> {
  await store.updateWorkspace(id, ws);
}

/** Apply a natural-language AI edit, picking the model by plan, persist, return. */
export async function editWorkspaceAction(
  id: string,
  current: Workspace,
  instruction: string,
): Promise<Workspace> {
  const clean = (instruction ?? "").toString().slice(0, 2000).trim();
  if (!clean) throw new Error("Tell the AI what to change.");
  const [model, locale] = await Promise.all([
    getUserPlan().then(modelForPlan),
    getLocale(),
  ]);
  const updated = await editWorkspace(current, clean, model, locale);
  await store.updateWorkspace(id, updated);
  return updated;
}

/** Delete a workspace and refresh the list. */
export async function deleteWorkspaceAction(id: string): Promise<void> {
  await store.deleteWorkspace(id);
  revalidatePath("/app");
}

/** Save the built-in sample workspace and open it. */
export async function loadDemoAction(): Promise<void> {
  const id = await store.saveNewWorkspace(sampleWorkspace);
  redirect(`/app/${id}`);
}
