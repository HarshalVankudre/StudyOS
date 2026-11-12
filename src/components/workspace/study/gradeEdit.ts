import { recordReview } from "@/lib/study/review-log";
import { GRADES, type Grade } from "@/lib/study/srs";
import type { Flashcard, Workspace } from "@/lib/workspace/types";
import type { UpdateOptions } from "../workspace-sync";

/** Where a reviewed card lives. */
export interface CardRef {
  pageId: string;
  blockId: string;
  cardId: string;
}

/** The card as it is in `workspace` now, or undefined if it was deleted. */
export function findCard(workspace: Workspace, ref: CardRef): Flashcard | undefined {
  const block = workspace.pages
    .find((p) => p.id === ref.pageId)
    ?.blocks.find((b) => b.id === ref.blockId);
  return block?.type === "flashcards" ? block.cards.find((c) => c.id === ref.cardId) : undefined;
}

/**
 * Record one grade on a card, in a workspace draft. This is the pattern for
 * any edit computed from the value it starts from (pass it to `update` with
 * `gradeOptions`, i.e. `{ rebase: "rerun" }`):
 *  - it finds the card by id, so it lands on the right card wherever the
 *    card is now, and does nothing if the card was deleted;
 *  - it is idempotent: the review is keyed by `at` (the moment of the
 *    answer), and a review already in the card's log is not recorded again.
 *    So running it again on a document that already holds this answer (a
 *    save whose reply was lost, a recovered draft) changes nothing;
 *  - it does not depend on the order devices sync in: the card's schedule is
 *    rebuilt from its logged reviews in time order (lib/study/review-log.ts),
 *    so a review made earlier on a device that syncs later (failed on an
 *    offline phone in the morning, passed on the laptop in the evening) is
 *    still counted, in its place.
 */
export function applyGrade(draft: Workspace, ref: CardRef, grade: Grade, at: Date): void {
  const card = findCard(draft, ref);
  if (!card) return;
  recordReview(card, grade, at);
}

/**
 * The `update` options of a grade: re-run on a newer document, and described
 * as data so a draft recovered after the tab was closed re-runs it too.
 */
export function gradeOptions(ref: CardRef, grade: Grade, at: Date): UpdateOptions {
  return {
    rebase: "rerun",
    replay: {
      name: "grade",
      args: { pageId: ref.pageId, blockId: ref.blockId, cardId: ref.cardId, grade, at: at.toISOString() },
    },
  };
}

/** The grade described by `gradeOptions`, as an edit again (null if `args` is not one). */
export function gradeReplayer(args: unknown): ((draft: Workspace) => void) | null {
  if (typeof args !== "object" || args === null) return null;
  const a = args as Record<string, unknown>;
  const at = typeof a.at === "string" ? new Date(a.at) : null;
  if (
    typeof a.pageId !== "string" ||
    typeof a.blockId !== "string" ||
    typeof a.cardId !== "string" ||
    !GRADES.includes(a.grade as Grade) ||
    !at ||
    Number.isNaN(at.getTime())
  ) {
    return null;
  }
  const ref: CardRef = { pageId: a.pageId, blockId: a.blockId, cardId: a.cardId };
  return (draft) => applyGrade(draft, ref, a.grade as Grade, at);
}
