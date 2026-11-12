/**
 * Client-side buffer for the per-day review record. Answers are counted in
 * memory per (workspace, local day) and sent to the server in small batches, so
 * a 100-card session costs a handful of requests, not 100. The local day is
 * fixed when the card is answered, so a session that runs past midnight is
 * split correctly.
 */
import { addCounts, countsForEvent, zeroCounts, type DayCounts, type ReviewEvent } from "./stats";

/** One answered quiz question (practice or exam). Counts as studying. */
export interface QuizAnswerEvent {
  quiz: true;
  correct: boolean;
}

/** Anything that counts toward the per-day study record and the streak. */
export type StudyEvent = ReviewEvent | QuizAnswerEvent;

/** The counts one study event adds to its day. */
export function countsForStudyEvent(event: StudyEvent): DayCounts {
  if ("quiz" in event) {
    const c = zeroCounts();
    c.quizAnswers = 1;
    if (event.correct) c.quizCorrect = 1;
    return c;
  }
  return countsForEvent(event);
}

export interface ReviewBatch {
  workspaceId: string;
  localDate: string;
  counts: DayCounts;
}

export class ReviewBuffer {
  private pending = new Map<string, ReviewBatch>();

  add(workspaceId: string, localDate: string, event: StudyEvent): void {
    const key = `${workspaceId}\u0000${localDate}`;
    const prev = this.pending.get(key);
    const counts = addCounts(prev?.counts ?? zeroCounts(), countsForStudyEvent(event));
    this.pending.set(key, { workspaceId, localDate, counts });
  }

  get size(): number {
    return this.pending.size;
  }

  /** Take everything buffered so far (the buffer is emptied). */
  drain(): ReviewBatch[] {
    const out = [...this.pending.values()];
    this.pending.clear();
    return out;
  }

  /** Put batches back after a failed send, merging with newer answers. */
  restore(batches: ReviewBatch[]): void {
    for (const b of batches) {
      const key = `${b.workspaceId}\u0000${b.localDate}`;
      const prev = this.pending.get(key);
      this.pending.set(key, { ...b, counts: prev ? addCounts(prev.counts, b.counts) : b.counts });
    }
  }
}
