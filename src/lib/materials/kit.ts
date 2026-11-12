/**
 * Build the workspace page a study kit lands on: ordinary, editable blocks
 * (headings and bullet lists for the notes, a `flashcards` block, a `quiz`
 * block), with a callout saying what was made and that every item cites its
 * page. Pure, so the editor can insert it through its normal edit path.
 */
import type { Block, Page } from "@/lib/workspace/types";
import { fmt } from "@/lib/i18n/interpolate";
import type { KitResult } from "./types";

export interface KitPageLabels {
  pageTitle: string; // "{title} · study kit"
  summary: string; // "{cards} flashcards and {questions} …"
  summaryNotesOnly: string;
  pagesRange: string; // "pages {from}–{to}"
  notesHeading: string;
  flashcardsHeading: string;
  quizHeading: string;
}

export function buildKitPage(
  result: KitResult,
  labels: KitPageLabels,
  newId: () => string = () => crypto.randomUUID(),
): Page {
  const blocks: Block[] = [];
  const range = fmt(labels.pagesRange, { from: result.from, to: result.to });
  const counts = { cards: result.cards.length, questions: result.questions.length, title: result.title, range };
  blocks.push({
    id: newId(),
    type: "callout",
    emoji: "📌",
    text: fmt(
      result.cards.length + result.questions.length > 0 ? labels.summary : labels.summaryNotesOnly,
      counts,
    ),
  });

  if (result.notes.length > 0) {
    blocks.push({ id: newId(), type: "heading", level: 2, text: labels.notesHeading });
    for (const section of result.notes) {
      blocks.push({ id: newId(), type: "heading", level: 3, text: section.heading });
      for (const point of section.points) {
        blocks.push({ id: newId(), type: "bulleted_list_item", text: point });
      }
    }
  }

  if (result.cards.length > 0) {
    blocks.push({ id: newId(), type: "heading", level: 2, text: labels.flashcardsHeading });
    blocks.push({
      id: newId(),
      type: "flashcards",
      title: result.title,
      cards: result.cards.map((card) => ({
        id: card.id,
        front: card.front,
        back: card.back,
        source: card.source,
      })),
    });
  }

  if (result.questions.length > 0) {
    blocks.push({ id: newId(), type: "heading", level: 2, text: labels.quizHeading });
    blocks.push({ id: newId(), type: "quiz", title: result.title, questions: result.questions });
  }

  return {
    id: newId(),
    title: fmt(labels.pageTitle, { title: result.title }),
    icon: "🧠",
    blocks,
  };
}
