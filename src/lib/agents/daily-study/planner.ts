import type {
  Block,
  Database,
  DatabaseProperty,
  DatabaseRow,
  Page,
  Workspace,
} from "@/lib/workspace/types";
import type { DailyStudyPlanItem } from "./types";

const MAX_PLAN_ITEMS = 6;
const MIN_SESSION_MINUTES = 10;
const MAX_TITLE_LENGTH = 180;

const COMPLETE_WORDS = [
  "done",
  "complete",
  "completed",
  "finished",
  "submitted",
  "archived",
  "read",
  "hecho",
  "completado",
  "terminado",
  "entregado",
  "erledigt",
  "abgeschlossen",
  "eingereicht",
  "terminé",
  "fini",
  "soumis",
  "completato",
  "concluído",
  "concluido",
  "voltooid",
  "完成",
  "已完成",
  "完了",
  "済",
  "مكتمل",
  "تم",
] as const;

const COMPLETION_PROPERTY_WORDS = [
  ...COMPLETE_WORDS,
  "status",
  "state",
  "progress",
  "estado",
  "statut",
  "stato",
  "status",
  "状态",
  "ステータス",
  "الحالة",
] as const;

const TITLE_PROPERTY_WORDS = [
  "assignment",
  "task",
  "name",
  "title",
  "exam",
  "assessment",
  "item",
  "topic",
  "reading",
] as const;

const DUE_PROPERTY_WORDS = [
  "due",
  "deadline",
  "exam",
  "test",
  "quiz",
  "date",
  "fecha",
  "frist",
  "fällig",
  "echeance",
  "échéance",
  "scadenza",
  "prazo",
  "datum",
  "日期",
  "締切",
  "موعد",
] as const;

const WEIGHT_WORDS = [
  "weight",
  "grade",
  "percent",
  "%",
  "gewicht",
  "peso",
  "poids",
  "ponderazione",
  "权重",
  "重み",
  "الوزن",
] as const;

interface Candidate {
  id: string;
  kind: DailyStudyPlanItem["kind"];
  title: string;
  source: string;
  reason: string;
  workspaceId: string;
  href: string;
  score: number;
  recommendedMinutes: number;
  dueDate?: string;
  dueCount?: number;
}

export interface BuiltDailyStudyPlan {
  summary: string;
  items: DailyStudyPlanItem[];
  sourceCount: number;
  candidateCount: number;
}

/**
 * Observe all workspace data and turn it into a bounded, explainable study day.
 * This planner is deterministic on purpose: it costs no AI credits, cannot
 * hallucinate coursework, and every recommendation points to its source.
 */
export function buildDailyStudyPlan(
  workspaces: Workspace[],
  localDate: string,
  dailyMinutes: number,
): BuiltDailyStudyPlan {
  const budget = normalizeDailyMinutes(dailyMinutes);
  const candidates = workspaces
    .flatMap((workspace) => collectWorkspaceCandidates(workspace, localDate))
    .sort(compareCandidates);

  const items: DailyStudyPlanItem[] = [];
  let remaining = budget;

  for (const candidate of candidates) {
    if (items.length >= MAX_PLAN_ITEMS || remaining < MIN_SESSION_MINUTES) break;

    const durationMinutes = Math.min(candidate.recommendedMinutes, remaining);
    items.push({
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      source: candidate.source,
      reason: candidate.reason,
      workspaceId: candidate.workspaceId,
      href: candidate.href,
      durationMinutes,
      ...(candidate.dueDate ? { dueDate: candidate.dueDate } : {}),
      ...(candidate.dueCount ? { dueCount: candidate.dueCount } : {}),
      completed: false,
    });
    remaining -= durationMinutes;
  }

  const selectedWorkspaces = new Set(items.map((item) => item.workspaceId)).size;
  const summary =
    items.length === 0
      ? "No open deadlines, due flashcards, or unfinished tasks were found."
      : `${items.length} focused ${plural(items.length, "session", "sessions")} across ${selectedWorkspaces} ${plural(selectedWorkspaces, "workspace", "workspaces")}, starting with “${items[0].title}”.`;

  return {
    summary,
    items,
    sourceCount: workspaces.length,
    candidateCount: candidates.length,
  };
}

export function normalizeDailyMinutes(value: number): number {
  if (!Number.isFinite(value)) return 60;
  return Math.min(240, Math.max(15, Math.round(value)));
}

function collectWorkspaceCandidates(
  workspace: Workspace,
  localDate: string,
): Candidate[] {
  const candidates: Candidate[] = [];

  for (const database of workspace.databases) {
    candidates.push(...collectDatabaseCandidates(workspace, database, localDate));
  }

  for (const page of workspace.pages) {
    for (const block of page.blocks) {
      const candidate = collectBlockCandidate(workspace, page, block, localDate);
      if (candidate) candidates.push(candidate);
    }
  }

  return candidates;
}

function collectDatabaseCandidates(
  workspace: Workspace,
  database: Database,
  localDate: string,
): Candidate[] {
  const dateProperties = orderedProperties(
    database.properties.filter((property) => property.type === "date"),
    DUE_PROPERTY_WORDS,
  );
  if (dateProperties.length === 0) return [];

  return database.rows.flatMap((row) => {
    if (isCompletedRow(database, row)) return [];

    const due = dateProperties
      .map((property) => row.cells[property.id])
      .find(isIsoDay);
    if (!due) return [];

    const days = calendarDayDifference(localDate, due);
    if (days > 30) return [];

    const weight = findWeight(database, row);
    const title =
      findRowTitle(database, row) ??
      (cleanText(database.name) || "Untitled study item");
    const source = sourceLabel(workspace.name, database.name);
    return [
      {
        id: `deadline:${workspace.id}:${database.id}:${row.id}`,
        kind: "deadline" as const,
        title,
        source,
        reason: deadlineReason(days, weight),
        workspaceId: workspace.id,
        href: `/app/${encodeURIComponent(workspace.id)}`,
        score: deadlineScore(days, weight),
        recommendedMinutes: deadlineDuration(days),
        dueDate: due,
      },
    ];
  });
}

function collectBlockCandidate(
  workspace: Workspace,
  page: Page,
  block: Block,
  localDate: string,
): Candidate | null {
  if (block.type === "flashcards") {
    const dueCount = block.cards.filter(
      (card) => !card.dueAt || card.dueAt <= localDate,
    ).length;
    if (dueCount === 0) return null;

    const deckTitle = cleanText(block.title || page.title || "Flashcards");
    return {
      id: `flashcards:${workspace.id}:${page.id}:${block.id}`,
      kind: "flashcards",
      title: `Review ${deckTitle}`,
      source: sourceLabel(workspace.name, page.title),
      reason: `${dueCount} ${plural(dueCount, "card is", "cards are")} due for spaced-repetition review.`,
      workspaceId: workspace.id,
      href: `/app/${encodeURIComponent(workspace.id)}`,
      score: 620 + Math.min(dueCount, 50) * 4,
      recommendedMinutes: clamp(Math.ceil(dueCount * 1.5), 15, 35),
      dueCount,
    };
  }

  if (block.type === "todo" && !block.checked && cleanText(block.text)) {
    return {
      id: `task:${workspace.id}:${page.id}:${block.id}`,
      kind: "task",
      title: cleanText(block.text),
      source: sourceLabel(workspace.name, page.title),
      reason: `This is still open on “${cleanText(page.title)}”.`,
      workspaceId: workspace.id,
      href: `/app/${encodeURIComponent(workspace.id)}`,
      score: 120,
      recommendedMinutes: 20,
    };
  }

  return null;
}

function isCompletedRow(database: Database, row: DatabaseRow): boolean {
  for (const property of database.properties) {
    const value = row.cells[property.id];
    const propertyName = normalize(property.name);

    if (
      property.type === "checkbox" &&
      value === true &&
      includesAny(propertyName, COMPLETION_PROPERTY_WORDS)
    ) {
      return true;
    }

    if ((property.type === "status" || property.type === "select") && typeof value === "string") {
      const label = property.options?.find((option) => option.id === value)?.label ?? value;
      if (isCompleteLabel(label)) return true;
    }
  }
  return false;
}

function findRowTitle(database: Database, row: DatabaseRow): string | null {
  const textProperties = orderedProperties(
    database.properties.filter((property) => property.type === "text"),
    TITLE_PROPERTY_WORDS,
  );
  for (const property of textProperties) {
    const value = row.cells[property.id];
    if (typeof value === "string" && cleanText(value)) return cleanText(value);
  }
  return null;
}

function findWeight(database: Database, row: DatabaseRow): number | null {
  const property = orderedProperties(
    database.properties.filter((candidate) => candidate.type === "number"),
    WEIGHT_WORDS,
  ).find((candidate) => includesAny(normalize(candidate.name), WEIGHT_WORDS));
  if (!property) return null;
  const value = row.cells[property.id];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function orderedProperties(
  properties: DatabaseProperty[],
  preferredWords: readonly string[],
): DatabaseProperty[] {
  return [...properties].sort((a, b) => {
    const aPreferred = includesAny(normalize(a.name), preferredWords) ? 1 : 0;
    const bPreferred = includesAny(normalize(b.name), preferredWords) ? 1 : 0;
    return bPreferred - aPreferred;
  });
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return a.title.localeCompare(b.title);
}

function deadlineScore(days: number, weight: number | null): number {
  let score: number;
  if (days < 0) score = 1_000 + Math.min(Math.abs(days), 30) * 10;
  else if (days === 0) score = 900;
  else if (days === 1) score = 760;
  else if (days <= 3) score = 650 - days * 10;
  else if (days <= 7) score = 500 - days * 5;
  else if (days <= 14) score = 340 - days * 3;
  else score = 200 - days;
  return score + Math.min(Math.max(weight ?? 0, 0), 100) * 2;
}

function deadlineDuration(days: number): number {
  if (days <= 0) return 45;
  if (days <= 3) return 35;
  if (days <= 7) return 30;
  return 25;
}

function deadlineReason(days: number, weight: number | null): string {
  let reason: string;
  if (days < 0) {
    const overdue = Math.abs(days);
    reason = `Overdue by ${overdue} ${plural(overdue, "day", "days")} — move this first.`;
  } else if (days === 0) {
    reason = "Due today — protect time for it now.";
  } else if (days === 1) {
    reason = "Due tomorrow — make visible progress today.";
  } else if (days <= 7) {
    reason = `Due in ${days} days — an early session lowers deadline risk.`;
  } else {
    reason = `Due in ${days} days — keep it moving before it becomes urgent.`;
  }

  if (weight !== null && weight > 0) {
    reason += ` It carries ${formatNumber(weight)}% weight.`;
  }
  return reason;
}

function calendarDayDifference(from: string, to: string): number {
  return Math.round((isoDayTime(to) - isoDayTime(from)) / 86_400_000);
}

function isoDayTime(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
}

function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function isCompleteLabel(value: string): boolean {
  const normalized = normalize(value);
  return COMPLETE_WORDS.some((word) => normalized === word);
}

function includesAny(value: string, words: readonly string[]): boolean {
  return words.some((word) => value.includes(word));
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
}

function sourceLabel(workspaceName: string, sectionName: string): string {
  return cleanText(`${workspaceName} · ${sectionName}`) || "StudyOS workspace";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function plural(count: number, singular: string, pluralValue: string): string {
  return count === 1 ? singular : pluralValue;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
