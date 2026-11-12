/**
 * First-run checklist: the five things that show a new student what StudyOS
 * does, and the pure logic for ticking them off. Each item ticks itself when
 * the student actually does it; nothing here is ever "mark as done" by hand.
 *
 * Where the state lives (so it follows the student across devices): one
 * UsageEvent row per milestone, kind "evt:onboarding:<item>", plus
 * "evt:onboarding:dismissed" / "evt:onboarding:restored" for the guide's
 * visibility. These rows are already covered by account erasure, the data
 * export and the analytics retention rule, so no new table is needed.
 * Items that leave their own trace are also derived from it on the server
 * (agent changes, studied cards, a calendar feed) and then recorded, so a
 * pruned trace never un-ticks an item.
 */
import { completionField, isRowComplete } from "@/lib/workspace/view-logic";
import type { Workspace } from "@/lib/workspace/types";

export const CHECKLIST_ITEMS = ["checkOff", "askAi", "study", "deadlines", "calendar"] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];

export const ONBOARDING_PREFIX = "evt:onboarding:";
export const DISMISSED_KIND = `${ONBOARDING_PREFIX}dismissed`;
export const RESTORED_KIND = `${ONBOARDING_PREFIX}restored`;

/** Reviews (or practice answers) that count as "studied a few cards". */
export const STUDY_TARGET = 3;

export interface OnboardingState {
  done: ChecklistItem[];
  dismissed: boolean;
}

export function isChecklistItem(value: unknown): value is ChecklistItem {
  return typeof value === "string" && (CHECKLIST_ITEMS as readonly string[]).includes(value);
}

/** Read the stored milestone events (any order) into the checklist state. */
export function foldOnboardingEvents(events: { kind: string; createdAt: Date }[]): OnboardingState {
  const done = new Set<ChecklistItem>();
  let lastDismissed = -Infinity;
  let lastRestored = -Infinity;
  for (const e of events) {
    if (!e.kind.startsWith(ONBOARDING_PREFIX)) continue;
    const name = e.kind.slice(ONBOARDING_PREFIX.length);
    const at = e.createdAt.getTime();
    if (e.kind === DISMISSED_KIND) lastDismissed = Math.max(lastDismissed, at);
    else if (e.kind === RESTORED_KIND) lastRestored = Math.max(lastRestored, at);
    else if (isChecklistItem(name)) done.add(name);
  }
  return {
    done: CHECKLIST_ITEMS.filter((i) => done.has(i)),
    dismissed: lastDismissed > lastRestored,
  };
}

/** Checked to-dos plus database rows marked complete. */
export function countCompleted(ws: Workspace): number {
  let n = 0;
  for (const page of ws.pages) {
    for (const block of page.blocks) if (block.type === "todo" && block.checked) n++;
  }
  for (const db of ws.databases) {
    const field = completionField(db);
    if (!field) continue;
    for (const row of db.rows) if (isRowComplete(db, row, field)) n++;
  }
  return n;
}

/** Database rows that carry at least one date: the student's deadlines. */
export function countDated(ws: Workspace): number {
  let n = 0;
  for (const db of ws.databases) {
    const dateProps = db.properties.filter((p) => p.type === "date").map((p) => p.id);
    if (dateProps.length === 0) continue;
    for (const row of db.rows) {
      if (dateProps.some((id) => typeof row.cells[id] === "string" && row.cells[id] !== "")) n++;
    }
  }
  return n;
}

export interface Baseline {
  completed: number;
  dated: number;
}

export function baselineOf(ws: Workspace): Baseline {
  return { completed: countCompleted(ws), dated: countDated(ws) };
}

/**
 * Items the student has just done in this editor session: more things
 * checked off, or more dated rows, than when the workspace was opened.
 */
export function sessionProgress(ws: Workspace, baseline: Baseline): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  if (countCompleted(ws) > baseline.completed) out.push("checkOff");
  if (countDated(ws) > baseline.dated) out.push("deadlines");
  return out;
}
