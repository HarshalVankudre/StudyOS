/**
 * Server side of the first-run checklist (see ./checklist.ts for the model).
 * Every read and write is scoped to one user id from Clerk.
 */
import "server-only";

import { prisma } from "@/lib/db";
import {
  CHECKLIST_ITEMS,
  DISMISSED_KIND,
  ONBOARDING_PREFIX,
  RESTORED_KIND,
  STUDY_TARGET,
  foldOnboardingEvents,
  type ChecklistItem,
  type OnboardingState,
} from "./checklist";

async function readEvents(userId: string) {
  return prisma.usageEvent.findMany({
    where: { userId, kind: { startsWith: ONBOARDING_PREFIX } },
    select: { kind: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
}

/** Items proven by data the student already has, checked only when still open. */
async function derivedItems(userId: string, open: Set<ChecklistItem>): Promise<ChecklistItem[]> {
  const [agentChange, studied, calendar] = await Promise.all([
    open.has("askAi")
      ? prisma.workspaceChange.findFirst({ where: { ownerId: userId, kind: "agent" }, select: { id: true } })
      : null,
    open.has("study")
      ? prisma.studyDay.aggregate({ where: { userId }, _sum: { reviews: true, practice: true } })
      : null,
    open.has("calendar") ? prisma.calendarToken.findUnique({ where: { userId }, select: { userId: true } }) : null,
  ]);
  const out: ChecklistItem[] = [];
  if (agentChange) out.push("askAi");
  if (studied && (studied._sum.reviews ?? 0) + (studied._sum.practice ?? 0) >= STUDY_TARGET) out.push("study");
  if (calendar) out.push("calendar");
  return out;
}

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const state = foldOnboardingEvents(await readEvents(userId));
  const open = new Set(CHECKLIST_ITEMS.filter((i) => !state.done.includes(i)));
  if (open.size === 0) return state;
  const derived = await derivedItems(userId, open);
  if (derived.length > 0) {
    // Record them so the tick survives pruning of the underlying rows.
    await prisma.usageEvent
      .createMany({ data: derived.map((item) => ({ userId, kind: `${ONBOARDING_PREFIX}${item}` })) })
      .catch(() => {});
  }
  const done = new Set([...state.done, ...derived]);
  return { done: CHECKLIST_ITEMS.filter((i) => done.has(i)), dismissed: state.dismissed };
}

/** Record that the student did `item` (idempotent). */
export async function markOnboardingItem(userId: string, item: ChecklistItem): Promise<void> {
  const kind = `${ONBOARDING_PREFIX}${item}`;
  const existing = await prisma.usageEvent.findFirst({ where: { userId, kind }, select: { id: true } });
  if (!existing) await prisma.usageEvent.create({ data: { userId, kind } });
}

/** Hide (or bring back) the guide on every device. */
export async function setOnboardingDismissed(userId: string, dismissed: boolean): Promise<void> {
  await prisma.usageEvent.create({ data: { userId, kind: dismissed ? DISMISSED_KIND : RESTORED_KIND } });
}
