import { FileQuestion, GraduationCap, Layers, ListTodo, NotebookPen } from "lucide-react";

/**
 * How each kind of work looks, shared by Today and the agenda so the two
 * views agree: the soft fill of its tag and its icon. A plain module (not a
 * client one) so server components can read it too.
 */
export const KIND_TINT = {
  deadline: "bg-matcha",
  exam: "bg-cloud",
  flashcards: "bg-heather",
  quiz: "bg-oat",
  task: "bg-oat",
} as const;

export const KIND_ICON = {
  deadline: NotebookPen,
  exam: GraduationCap,
  flashcards: Layers,
  quiz: FileQuestion,
  task: ListTodo,
} as const;
