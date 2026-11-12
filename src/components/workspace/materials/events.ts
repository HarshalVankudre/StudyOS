/**
 * Opening the study-kit dialog from anywhere in the editor (the insert menu,
 * the study hub) without threading callbacks through the page tree: callers
 * dispatch a window event, and the one StudyKitHost mounted by the editor
 * opens the dialog.
 */
export const STUDY_KIT_EVENT = "studyos:study-kit";

export type StudyKitIntent =
  /** Choose or add material, then make any of notes, flashcards, a quiz. */
  | { mode: "material" }
  /** Use a notes page of the workspace as the material. */
  | { mode: "page"; pageId: string; make: "flashcards" | "quiz" };

export function openStudyKit(intent: StudyKitIntent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StudyKitIntent>(STUDY_KIT_EVENT, { detail: intent }));
}
