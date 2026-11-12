import { assignSchedule, reviewCard, type Grade } from "@/lib/study/srs";
import type { Flashcard, Workspace } from "@/lib/workspace/types";

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
 * `{ rebase: "rerun" }`):
 *  - it finds the card by id, so it lands on the right card wherever the
 *    card is now, and does nothing if the card was deleted;
 *  - it computes the next schedule from the card as it is NOW in the
 *    document it runs on, so a grade given on another device (or an edit by
 *    the AI agent) in the meantime is built upon, not overwritten;
 *  - it is idempotent: `at` (the moment of the answer) becomes the card's
 *    `lastReviewedAt`, so running it again on a document that already holds
 *    this answer (a save whose reply was lost) changes nothing.
 */
export function applyGrade(draft: Workspace, ref: CardRef, grade: Grade, at: Date): void {
  const card = findCard(draft, ref);
  if (!card) return;
  if (card.lastReviewedAt === at.toISOString()) return;
  assignSchedule(card, reviewCard(card, grade, at));
}
