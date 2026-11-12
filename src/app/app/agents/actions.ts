"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import {
  runDailyStudyAgent,
  setDailyStudyItemCompleted,
  updateDailyStudyAgentConfig,
  type SetItemResult,
} from "@/lib/agents/daily-study/store";
import { checkUsageLimit } from "@/lib/usage-limits";

export async function ensureDailyStudyPlanAction(
  timeZone: string,
): Promise<void> {
  try {
    await runDailyStudyAgent({ trigger: "auto", timeZone: cleanString(timeZone, 100) });
  } catch {
    // The store records a failed run for the Agent Center. Keep an automatic
    // first-visit run from taking down the dashboard.
  }
  revalidateAgentSurfaces();
}

/**
 * "Plan my day" / "Rebuild from today": re-plan the rest of today around the
 * time the student has (`minutes`, optional), keeping what is already done.
 */
export async function rebuildTodayAction(input: {
  timeZone?: string;
  minutes?: number;
}): Promise<{ ok: boolean }> {
  const minutes = typeof input?.minutes === "number" && Number.isFinite(input.minutes)
    ? input.minutes
    : undefined;
  // A rebuild loads and plans across every workspace the student owns:
  // throttled per user (generous for a person, a wall for a loop).
  const { userId } = await auth();
  if (!userId) return { ok: false };
  if (!(await checkUsageLimit(userId, "daily_plan")).allowed) return { ok: false };
  try {
    await runDailyStudyAgent({
      trigger: "manual",
      timeZone: cleanString(input?.timeZone, 100) || undefined,
      todayMinutes: minutes,
    });
    return { ok: true };
  } catch {
    // A durable failed run is more useful here than a generic route error.
    return { ok: false };
  } finally {
    revalidateAgentSurfaces();
  }
}

/** Form variant of `rebuildTodayAction` (works without JavaScript). */
export async function runDailyStudyAgentAction(
  formData: FormData,
): Promise<void> {
  const minutes = Number(formData.get("minutes"));
  await rebuildTodayAction({
    timeZone: formString(formData, "timeZone"),
    minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : undefined,
  });
}

export async function saveDailyStudyAgentConfigAction(
  formData: FormData,
): Promise<void> {
  await updateDailyStudyAgentConfig({
    enabled: formData.get("enabled") === "on",
    dailyMinutes: Number(formData.get("dailyMinutes")),
    timeZone: formString(formData, "timeZone"),
  });
  revalidateAgentSurfaces();
}

/**
 * Check a plan item off or back on. Where it makes sense this completes the
 * to-do or row in the workspace too (see store.setDailyStudyItemCompleted).
 */
export async function setTodayItemAction(input: {
  planId: string;
  itemId: string;
  completed: boolean;
  finish?: boolean;
}): Promise<SetItemResult> {
  const planId = cleanString(input?.planId, 100);
  const itemId = cleanString(input?.itemId, 400);
  if (!planId || !itemId || typeof input.completed !== "boolean") {
    return { ok: false, reason: "not_found" };
  }
  const result = await setDailyStudyItemCompleted(planId, itemId, input.completed, {
    finish: input.finish === true,
  });
  revalidateAgentSurfaces();
  return result;
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function revalidateAgentSurfaces(): void {
  revalidatePath("/app");
  revalidatePath("/app/agents");
}
