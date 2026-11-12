/**
 * Page → Markdown. Block text in StudyOS is already Markdown (+ $math$), so
 * text blocks are written as they are, with the right block prefix; the rich
 * blocks (database views, flashcards, quizzes, components, images) become
 * plain Markdown a student can read anywhere.
 */
import { dayKeyOf, applyView } from "@/lib/workspace/view-logic";
import type { Block, Database, Page, Workspace } from "@/lib/workspace/types";
import { cellText, visibleProperties } from "./cells";

/** Words that appear in exported files, from the student's language. */
export interface MarkdownLabels {
  flashcards: string;
  question: string;
  answer: string;
  explanation: string;
  trueLabel: string;
  falseLabel: string;
  quiz: string;
  component: string;
}

export const ENGLISH_MARKDOWN_LABELS: MarkdownLabels = {
  flashcards: "Flashcards",
  question: "Q",
  answer: "A",
  explanation: "Explanation",
  trueLabel: "True",
  falseLabel: "False",
  quiz: "Quiz",
  component: "Interactive component",
};

export interface MarkdownOptions {
  labels?: MarkdownLabels;
  /** Prefix for image links, e.g. "https://studyos.app" (default: relative). */
  origin?: string;
  /** The day database views are evaluated on (default: today, local). */
  today?: string;
}

/** Escape a value for one Markdown table cell. */
export function tableCell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

/** Indent every line after the first (continuation lines of a list item). */
function hang(text: string, indent: string): string {
  return text.replace(/\r?\n/g, `\n${indent}`);
}

function quoteLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");
}

/** A code fence longer than any backtick run inside `source`. */
function fenceFor(source: string): string {
  const longest = Math.max(0, ...(source.match(/`+/g) ?? []).map((m) => m.length));
  return "`".repeat(Math.max(3, longest + 1));
}

/** A Markdown table of the rows a view shows (its filters, sort and columns). */
export function databaseTable(
  db: Database,
  ws: Pick<Workspace, "databases">,
  viewId: string | undefined,
  today: string,
): string {
  const view = db.views.find((v) => v.id === viewId) ?? db.views[0];
  const props = visibleProperties(db, view?.visiblePropertyIds);
  const rows = view ? applyView(db, view, { today }) : db.rows;
  if (props.length === 0) return "";
  const head = `| ${props.map((p) => tableCell(p.name)).join(" | ")} |`;
  const sep = `| ${props.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (r) => `| ${props.map((p) => tableCell(cellText(ws, p, r.cells[p.id]))).join(" | ")} |`,
  );
  return [head, sep, ...body].join("\n");
}

function blockToMarkdown(
  block: Block,
  ws: Pick<Workspace, "databases">,
  number: number,
  o: Required<Pick<MarkdownOptions, "labels" | "origin" | "today">>,
): string {
  const L = o.labels;
  switch (block.type) {
    case "heading":
      return `${"#".repeat(Math.min(3, Math.max(1, block.level)) + 1)} ${block.text.replace(/\s*\n\s*/g, " ")}`;
    case "paragraph":
      return block.text;
    case "todo":
      return `- [${block.checked ? "x" : " "}] ${hang(block.text, "  ")}`;
    case "bulleted_list_item":
      return `- ${hang(block.text, "  ")}`;
    case "numbered_list_item": {
      const marker = `${number}. `;
      return `${marker}${hang(block.text, " ".repeat(marker.length))}`;
    }
    case "quote":
      return quoteLines(block.text);
    case "callout":
      return quoteLines(block.emoji ? `${block.emoji} ${block.text}` : block.text);
    case "divider":
      return "---";
    case "media": {
      const alt = (block.alt || block.caption || "").replace(/[[\]]/g, "");
      const img = `![${alt}](${o.origin}/api/asset/${encodeURIComponent(block.assetId)})`;
      return block.caption ? `${img}\n\n*${block.caption}*` : img;
    }
    case "database_view": {
      const db = ws.databases.find((d) => d.id === block.databaseId);
      if (!db) return "";
      const view = db.views.find((v) => v.id === block.viewId);
      const title = `**${db.icon ? `${db.icon} ` : ""}${db.name}**${view ? ` · ${view.name}` : ""}`;
      const table = databaseTable(db, ws, block.viewId, o.today);
      return table ? `${title}\n\n${table}` : title;
    }
    case "react_artifact": {
      const fence = fenceFor(block.source);
      return `**${block.title || L.component}**\n\n${fence}jsx\n${block.source}\n${fence}`;
    }
    case "flashcards": {
      const parts = [`**${block.title || L.flashcards}**`];
      for (const card of block.cards) {
        parts.push(`**${L.question}:** ${card.front}\n\n**${L.answer}:** ${card.back}`);
      }
      return parts.join("\n\n");
    }
    case "quiz": {
      const parts = [`**${block.title || L.quiz}**`];
      (block.questions ?? []).forEach((q, i) => {
        const marker = `${i + 1}. `;
        const pad = " ".repeat(marker.length);
        const lines = [`${marker}${hang(q.prompt, pad)}`];
        if (q.kind === "mcq" && q.choices) {
          q.choices.forEach((choice, ci) => {
            const right = ci === q.answerIndex;
            lines.push(`${pad}- ${right ? `**${choice}** ✓` : choice}`);
          });
        } else if (q.kind === "true_false" && typeof q.answerBool === "boolean") {
          lines.push(`${pad}**${L.answer}:** ${q.answerBool ? L.trueLabel : L.falseLabel}`);
        } else if (q.answerText) {
          lines.push(`${pad}**${L.answer}:** ${hang(q.answerText, pad)}`);
        }
        if (q.explanation) lines.push("", `${pad}*${L.explanation}:* ${hang(q.explanation, pad)}`);
        parts.push(lines.join("\n"));
      });
      return parts.join("\n\n");
    }
    case "grades": {
      // The grade summary is computed from a database; export that database.
      const db = block.databaseId ? ws.databases.find((d) => d.id === block.databaseId) : undefined;
      const title = block.title || db?.name || "";
      const table = db ? databaseTable(db, ws, undefined, o.today) : "";
      return [title && `**${title}**`, table].filter(Boolean).join("\n\n");
    }
    default:
      // A block type newer than this exporter: leave it out rather than fail.
      return "";
  }
}

const LIST_TYPES = new Set<Block["type"]>(["todo", "bulleted_list_item", "numbered_list_item"]);

/** The page as one Markdown document, starting with its title. */
export function pageToMarkdown(
  page: Page,
  ws: Pick<Workspace, "databases">,
  options: MarkdownOptions = {},
): string {
  const o = {
    labels: options.labels ?? ENGLISH_MARKDOWN_LABELS,
    origin: (options.origin ?? "").replace(/\/+$/, ""),
    today: options.today ?? dayKeyOf(new Date()),
  };
  const title = `# ${page.icon ? `${page.icon} ` : ""}${page.title}`.trimEnd();
  let out = title;
  let prev: Block | null = null;
  let number = 0;
  for (const block of page.blocks) {
    number = block.type === "numbered_list_item" ? (prev?.type === "numbered_list_item" ? number + 1 : 1) : 0;
    const md = blockToMarkdown(block, ws, number, o);
    if (!md) {
      prev = block;
      continue;
    }
    // Consecutive items of one list stay one list (single newline).
    const tight = prev && LIST_TYPES.has(block.type) && prev.type === block.type;
    out += tight ? `\n${md}` : `\n\n${md}`;
    prev = block;
  }
  return `${out}\n`;
}
