/**
 * Keeping a stored plan honest with the workspaces it came from, and writing
 * a plan check-off through to the coursework. Pure functions: the store
 * (store.ts) loads and saves; these decide.
 *
 * Source of truth per item mode:
 * - finish:  the to-do's checkbox / the row's done value. Checking the item
 *            off completes the source; checking the source completes the item.
 * - session: the plan (today's session), or the row being done.
 * - study:   studying. A deck item completes when the cards planned for it
 *            have been reviewed today; a quiz item when a quiz was taken today.
 */
import type { CellValue, Workspace } from "@/lib/workspace/types";
import { completionField, dayKeyOf, isRowComplete } from "@/lib/workspace/view-logic";
import { isStudyable, isNew } from "@/lib/study/srs";
import type { DailyStudyPlanItem } from "./types";

function localDayOfInstant(iso: string | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return dayKeyOf(date, timeZone);
  } catch {
    return dayKeyOf(date, "UTC");
  }
}

type Located =
  | { kind: "missing" }
  | { kind: "todo"; checked: boolean }
  | { kind: "row"; done: boolean; canComplete: boolean }
  | { kind: "deck"; reviewedToday: number; stillDue: number }
  | { kind: "quiz"; takenToday: boolean }
  | { kind: "other" };

function locate(
  item: DailyStudyPlanItem,
  workspaces: Map<string, Workspace>,
  localDate: string,
  timeZone: string,
): Located {
  const workspace = workspaces.get(item.target.workspaceId);
  if (!workspace) return { kind: "missing" };
  const { blockId, databaseId, rowId } = item.target;

  if (blockId) {
    const block = workspace.pages.flatMap((p) => p.blocks).find((b) => b.id === blockId);
    if (!block) return { kind: "missing" };
    if (block.type === "todo") return { kind: "todo", checked: block.checked };
    if (block.type === "flashcards") {
      let reviewedToday = 0;
      let stillDue = 0;
      for (const card of block.cards) {
        if (!isStudyable(card)) continue;
        if (localDayOfInstant(card.lastReviewedAt, timeZone) === localDate) reviewedToday += 1;
        if (!isNew(card) && card.dueAt && card.dueAt <= localDate) stillDue += 1;
      }
      return { kind: "deck", reviewedToday, stillDue };
    }
    if (block.type === "quiz") {
      const takenToday =
        (block.attempts ?? []).some((a) => localDayOfInstant(a.at, timeZone) === localDate) ||
        (block.questions ?? []).some(
          (q) => localDayOfInstant(q.stats?.lastAnsweredAt, timeZone) === localDate,
        );
      return { kind: "quiz", takenToday };
    }
    return { kind: "other" };
  }

  if (databaseId && rowId) {
    const database = workspace.databases.find((d) => d.id === databaseId);
    const row = database?.rows.find((r) => r.id === rowId);
    if (!database || !row) return { kind: "missing" };
    const field = completionField(database);
    return { kind: "row", done: isRowComplete(database, row, field), canComplete: Boolean(field) };
  }
  return { kind: "other" };
}

/**
 * Bring item states in line with the workspaces: completion that happened in
 * the editor or a study session shows up in the plan, and items whose source
 * was deleted disappear (unless already done). `changed` says whether the
 * stored plan needs saving.
 */
export function reconcilePlanItems(
  items: DailyStudyPlanItem[],
  workspaces: Workspace[],
  localDate: string,
  timeZone: string,
  now: Date = new Date(),
): { items: DailyStudyPlanItem[]; changed: boolean } {
  const byId = new Map(workspaces.map((w) => [w.id, w]));
  const out: DailyStudyPlanItem[] = [];

  for (const item of items) {
    const found = locate(item, byId, localDate, timeZone);
    if (found.kind === "missing") {
      if (item.completed) out.push(item);
      continue;
    }
    let completed = item.completed;
    let progress = item.progress;
    let mode = item.mode;

    if (found.kind === "todo") {
      completed = item.mode === "finish" ? found.checked : item.completed || found.checked;
    } else if (found.kind === "row") {
      if (item.mode === "finish" && !found.canComplete) mode = "session";
      completed = mode === "finish" ? found.done : item.completed || found.done;
    } else if (found.kind === "deck" && item.mode === "study") {
      const total = item.dueCount ?? 0;
      const done = Math.min(found.reviewedToday, total);
      progress = total > 0 ? { done, total } : undefined;
      const studied = (total > 0 && found.reviewedToday >= total) ||
        (found.reviewedToday > 0 && found.stillDue === 0);
      completed = item.completed || studied;
    } else if (found.kind === "quiz" && item.mode === "study") {
      completed = item.completed || found.takenToday;
    }

    const next: DailyStudyPlanItem = { ...item, mode, completed };
    if (progress) next.progress = progress;
    else delete next.progress;
    if (completed && !item.completed) next.completedAt = now.toISOString();
    if (!completed) delete next.completedAt;
    out.push(next);
  }

  return { items: out, changed: JSON.stringify(out) !== JSON.stringify(items) };
}

/** Can checking this item off complete its source? */
export function writesThrough(item: DailyStudyPlanItem, finish = false): boolean {
  if (item.kind === "task") return true;
  if (!item.target.databaseId || !item.target.rowId) return false;
  return item.mode === "finish" || (finish && item.kind === "deadline");
}

export interface CompletionResult {
  /** The workspace was changed. */
  changed: boolean;
  /** The source could be completed (or reopened) at all. */
  applied: boolean;
  /** For rows: the completion cell before it was marked done. */
  restore?: CellValue;
}

/**
 * Complete (or reopen) the item's source inside `draft`, a copy of the
 * workspace. To-dos get checked; rows get their database's done value using
 * the same "is done" rules as the editor (view-logic `completionField`).
 * Reopening a row restores the value it had before StudyOS completed it.
 */
export function applyCompletion(
  draft: Workspace,
  item: DailyStudyPlanItem,
  done: boolean,
): CompletionResult {
  const { blockId, databaseId, rowId } = item.target;

  if (blockId) {
    for (const page of draft.pages) {
      const block = page.blocks.find((b) => b.id === blockId);
      if (!block) continue;
      if (block.type !== "todo") return { changed: false, applied: false };
      if (block.checked === done) return { changed: false, applied: true };
      block.checked = done;
      return { changed: true, applied: true };
    }
    return { changed: false, applied: false };
  }

  if (databaseId && rowId) {
    const database = draft.databases.find((d) => d.id === databaseId);
    const row = database?.rows.find((r) => r.id === rowId);
    if (!database || !row) return { changed: false, applied: false };
    const field = completionField(database);
    if (!field) return { changed: false, applied: false };
    const key = field.property.id;
    const isDone = isRowComplete(database, row, field);
    if (done) {
      if (isDone) return { changed: false, applied: true };
      const restore = row.cells[key] ?? null;
      row.cells[key] = field.doneValue;
      return { changed: true, applied: true, restore };
    }
    if (!isDone) return { changed: false, applied: true };
    const previous = item.restore;
    const validPrevious =
      previous !== undefined &&
      previous !== null &&
      !field.doneValues.includes(previous as string | boolean) &&
      (field.property.type === "checkbox"
        ? typeof previous === "boolean"
        : (field.property.options ?? []).some((o) => o.id === previous));
    row.cells[key] = validPrevious ? previous : field.openValue;
    return { changed: true, applied: true };
  }

  return { changed: false, applied: false };
}
