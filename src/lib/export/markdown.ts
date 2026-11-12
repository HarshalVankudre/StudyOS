/**
 * Page → Markdown. Block text in StudyOS is already Markdown (+ $math$), so
 * text blocks are written as they are, with the right block prefix; the rich
 * blocks (database views, flashcards, quizzes, components, images) become
 * plain Markdown a student can read anywhere.
 */
import { buildGradeReport, formatGrade, formatPercent, type UkClassLabels } from "@/lib/grades";
import { dayKeyOf, applyView } from "@/lib/workspace/view-logic";
import type { Block, Database, GradesBlock, Page, SourceRef, Workspace } from "@/lib/workspace/types";
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
  /** Before a card's or question's citation. */
  source: string;
  /** A cited page, with {page}. */
  sourcePage: string;
  gradeCurrent: string;
  /** With {percent}. */
  gradeDecided: string;
  gradeTarget: string;
  gradeWork: string;
  gradeWeight: string;
  gradeScore: string;
  gradeNotGraded: string;
  gradeNoCourse: string;
  gradeNoScores: string;
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
  source: "Source",
  sourcePage: "p. {page}",
  gradeCurrent: "Current grade",
  gradeDecided: "{percent} of the grade decided",
  gradeTarget: "Target",
  gradeWork: "Graded work",
  gradeWeight: "Weight",
  gradeScore: "Score",
  gradeNotGraded: "not graded yet",
  gradeNoCourse: "No course",
  gradeNoScores: "No scores yet.",
};

export interface MarkdownOptions {
  /** Missing labels fall back to English. */
  labels?: Partial<MarkdownLabels>;
  /** Number formatting for grades (default "en"). */
  locale?: string;
  /** Names of UK degree classes, for grade blocks on that scale. */
  ukLabels?: UkClassLabels;
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

interface ResolvedOptions {
  labels: MarkdownLabels;
  origin: string;
  today: string;
  locale: string;
  ukLabels?: UkClassLabels;
}

/** One line of inline text with emphasis markers escaped, so it cannot break the italics around it. */
function plainInline(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").replace(/([\*_`])/g, "\$1").trim();
}

/** "*Source: Lecture 7, p. 3 — “quoted passage”*", or "" when nothing is cited. */
export function sourceLine(source: SourceRef | undefined, L: MarkdownLabels): string {
  if (!source) return "";
  const label = source.label?.trim();
  const page =
    typeof source.page === "number" && source.page > 0 ? L.sourcePage.replace("{page}", String(source.page)) : "";
  const where = [label && plainInline(label), page].filter(Boolean).join(", ");
  const quote = source.quote?.trim() ? `“${plainInline(source.quote)}”` : "";
  const text = [where, quote].filter(Boolean).join(" — ");
  return text ? `*${L.source}: ${text}*` : "";
}

/**
 * A grades block as people read it: per course the current grade, how much
 * of it is decided and the target, then the graded work with weights and
 * scores. Computed with the same math as the block on screen.
 */
function gradesToMarkdown(block: GradesBlock, ws: Pick<Workspace, "databases">, o: ResolvedOptions): string {
  const L = o.labels;
  // The report only reads the workspace's databases.
  const report = buildGradeReport(ws as Workspace, block, { ukLabels: o.ukLabels });
  const title = block.title || report?.database.name || "";
  if (!report) return title ? `**${title}**` : "";
  const pct = (n: number) => formatPercent(n, o.locale);
  const grade = (n: number) => {
    const shown = formatGrade(n, report.scale, o.locale);
    return report.scale.display === "percent" ? shown : `${shown} (${pct(n)})`;
  };
  const parts: string[] = [];
  if (title) parts.push(`**${title}**`);
  for (const course of report.courses) {
    const g = course.grade;
    const facts = [
      `${L.gradeCurrent}: ${g.current === null ? "—" : grade(g.current)}`,
      L.gradeDecided.replace("{percent}", pct(g.decidedShare * 100)),
      course.target !== null ? `${L.gradeTarget}: ${grade(course.target)}` : "",
    ].filter(Boolean);
    parts.push(`**${plainInline(course.label || L.gradeNoCourse)}** · ${facts.join(" · ")}`);
    const rows = g.items.filter((item) => item.counted || item.percent !== null);
    if (rows.length === 0) {
      parts.push(L.gradeNoScores);
      continue;
    }
    const lines = [
      `| ${tableCell(L.gradeWork)} | ${tableCell(L.gradeWeight)} | ${tableCell(L.gradeScore)} |`,
      "| --- | --- | --- |",
      ...rows.map((item) => {
        const weight = item.counted && g.totalWeight > 0 ? pct((item.weight / g.totalWeight) * 100) : "—";
        const score = item.percent === null ? L.gradeNotGraded : pct(item.percent);
        return `| ${tableCell(item.name)} | ${weight} | ${tableCell(score)} |`;
      }),
    ];
    parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}

function blockToMarkdown(
  block: Block,
  ws: Pick<Workspace, "databases">,
  number: number,
  o: ResolvedOptions,
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
        const cite = sourceLine(card.source, L);
        parts.push(`**${L.question}:** ${card.front}\n\n**${L.answer}:** ${card.back}${cite ? `\n\n${cite}` : ""}`);
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
        const cite = sourceLine(q.source, L);
        if (cite) lines.push("", `${pad}${cite}`);
        parts.push(lines.join("\n"));
      });
      return parts.join("\n\n");
    }
    case "grades":
      return gradesToMarkdown(block, ws, o);
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
  const o: ResolvedOptions = {
    labels: { ...ENGLISH_MARKDOWN_LABELS, ...options.labels },
    origin: (options.origin ?? "").replace(/\/+$/, ""),
    today: options.today ?? dayKeyOf(new Date()),
    locale: options.locale ?? "en",
    ukLabels: options.ukLabels,
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
