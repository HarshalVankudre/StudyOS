"use server";

import { revalidatePath } from "next/cache";
import {
  runDailyStudyAgent,
  setDailyStudyItemCompleted,
  updateDailyStudyAgentConfig,
} from "@/lib/agents/daily-study/store";

export async function ensureDailyStudyPlanAction(
  timeZone: string,
): Promise<void> {
  try {
    await runDailyStudyAgent({ trigger: "auto", timeZone });
  } catch {
    // The store records a failed run for the Agent Center. Keep an automatic
    // first-visit run from taking down the dashboard.
  }
  revalidateAgentSurfaces();
}
export async function runDailyStudyAgentAction(
  formData: FormData,
): Promise<void> {
  try {
    await runDailyStudyAgent({
      trigger: "manual",
      timeZone: formString(formData, "timeZone"),
    });
  } catch {
    // A durable failed run is more useful here than a generic route error.
  }
  revalidateAgentSurfaces();
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

export async function toggleDailyStudyItemAction(
  formData: FormData,
): Promise<void> {
  const planId = formString(formData, "planId").slice(0, 100);
  const itemId = formString(formData, "itemId").slice(0, 300);
  if (!planId || !itemId) return;

  await setDailyStudyItemCompleted(
    planId,
    itemId,
    formData.get("completed") === "true",
  );
  revalidateAgentSurfaces();
}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function revalidateAgentSurfaces(): void {
  revalidatePath("/app");
  revalidatePath("/app/agents");
}
