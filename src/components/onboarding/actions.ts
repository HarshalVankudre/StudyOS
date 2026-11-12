"use server";

import { auth } from "@clerk/nextjs/server";
import { reportError } from "@/lib/ops/report-error";
import { isChecklistItem, type OnboardingState } from "./checklist";
import { getOnboardingState, markOnboardingItem, setOnboardingDismissed } from "./state";

/** The signed-in student's checklist, or null when signed out or on failure. */
export async function getOnboardingStateAction(): Promise<OnboardingState | null> {
  const { userId } = await auth();
  if (!userId) return null;
  try {
    return await getOnboardingState(userId);
  } catch (error) {
    reportError(error, { source: "action", route: "onboarding.get", userId });
    return null;
  }
}

export async function markOnboardingItemAction(item: string): Promise<void> {
  const { userId } = await auth();
  if (!userId || !isChecklistItem(item)) return;
  try {
    await markOnboardingItem(userId, item);
  } catch (error) {
    reportError(error, { source: "action", route: "onboarding.mark", userId });
  }
}

export async function setOnboardingDismissedAction(dismissed: boolean): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  try {
    await setOnboardingDismissed(userId, dismissed === true);
  } catch (error) {
    reportError(error, { source: "action", route: "onboarding.dismiss", userId });
  }
}
