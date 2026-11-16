import type {
  Block,
  Database,
  DatabaseRow,
  FlashcardsBlock,
  Page,
  QuizBlock,
  Workspace,
} from "@/lib/workspace/types";
import { completionField, dayDiff } from "@/lib/workspace/view-logic";
import { isNew, isStudyable } from "@/lib/study/srs";
// The quiz block's own rule, so the plan counts exactly the questions a run takes.
import { isPlayableQuestion } from "@/lib/study/quiz";
import {
  cleanText,
  courseKeywords,
  datedRows,
  estimateEffortMinutes,
  examPrepTotalMinutes,
  FORMALITY_MINUTES,
  mentions,
  rowCourse,
} from "./classify";
import {
  DEFAULT_DAILY_MINUTES,
  MAX_DAILY_MINUTES,
  MAX_STORED_PLAN_ITEMS,
  RESTART_AFTER_CARRIES,
  type DailyStudyPlanItem,
  type ExamCountdown,
  type PlanDetails,
  type PlanItemMode,
  type PlanReason,
  type PlanTarget,
  type Workload,
} from "./types";

/**
 * The Daily Study Agent's planner. Deterministic on purpose: it costs no AI
 * credits, cannot invent coursework, and every item points at its source.
 *
 * It reads every workspace (deadlines in databases, exams, flashcard decks,
 * quizzes and open to-dos), estimates the effort ahead, and fills the
 * student's time for today with a short list, each item with a time estimate,
 * a structured reason (rendered in the student's language at display time)
 * and a deep link. Unfinished items from the last plan roll forward with a
 * small priority boost; nothing is ever marked as failed.
 */

const MAX_PLAN_ITEMS = 6;
const MAX_TASK_ITEMS = 3;
const MIN_SESSION_MINUTES = 10;
/** New cards introduced per deck session; the rest wait for later days. */
export const NEW_CARDS_PER_SESSION = 10;
/** Overdue work older than this is left out of the plan (no nagging), and out of the agenda. */
export const OVERDUE_WINDOW_DAYS = 14;
/** Exams further out than this get a countdown but no sessions yet. */
const EXAM_PREP_WINDOW_DAYS = 21;
/** Exams within this many days get a countdown. */
const EXAM_COUNTDOWN_DAYS = 45;
/** How far ahead the workload check looks. */
const WORKLOAD_HORIZON_DAYS = 10;
const RESTART_MINUTES = 15;
const MAX_LEDGER_KEYS = 300;
/** Share of the day held for flashcard sessions before other work is fitted. */
const REVIEW_SHARE = 0.35;
/** Days shorter than this keep plain priority order (no held share). */
const REVIEW_SHARE_MIN_BUDGET = 30;
/** Decks that get the held share. */
const MAX_REVIEW_ITEMS = 2;
/** Longest one work session grows to when the day has time left over. */
const MAX_SESSION_MINUTES = 90;
/** Minutes per card, for sizing a review session (and counting what fits). */
const MINUTES_PER_REVIEW = 0.6;
const MINUTES_PER_NEW_CARD = 1.5;
const MAX_DECK_MINUTES = 30;

/**
 * Module exams (a German Klausur that decides a whole module, see
 * classify `ExamInfo.module`): prepared over six weeks, twice a week from 42
 * to 29 days out, every other day from 28 to 15, daily in the last 14 days.
 */
export const MODULE_PREP_WINDOW_DAYS = 42;
const MODULE_EVERY_OTHER_DAY_FROM = 28;
const MODULE_DAILY_FROM = 14;
/**
 * A module exam session starts at the usual exam session size, so several
 * exams share a day, and grows up to this when the day has time left (the
 * nearest exam first, since it scores highest).
 */
const MODULE_SESSION_MAX_MINUTES = 90;
const EXAM_SESSION_MINUTES = 45;

/**
 * Administrative deadlines (registrations, re-registration, fees): on the
 * plan from a week before, always on it in the last three days (they take
 * minutes and cannot be made up). At most this many a day, so a week full of
 * deregistration windows cannot crowd out the studying.
 */
const FORMALITY_LEAD_DAYS = 7;
const FORMALITY_GUARANTEE_DAYS = 3;
const MAX_FORMALITY_ITEMS = 3;

export interface PreviousPlan {
  localDate: string;
  items: Pick<DailyStudyPlanItem, "id" | "completed" | "kind" | "mode" | "minutes" | "carry" | "ledgerKey">[];
  progress: Record<string, number>;
}

/** Plug-in point for a grades module: the weight (percent) of an assessment row. */
export type WeightResolver = (
  workspace: Workspace,
  database: Database,
  row: DatabaseRow,
) => number | null | undefined;

export interface PlannerInput {
  workspaces: Workspace[];
  /** The student's local day, YYYY-MM-DD. */
  localDate: string;
  /** The student's usual minutes per day. */
  dailyMinutes: number;
  /** Minutes for today only ("I have 30 minutes today"). */
  todayMinutes?: number;
  /** The most recent plan before today, for roll-forward. */
  previous?: PreviousPlan | null;
  /** Today's plan when rebuilding: items already done are kept as done. */
  current?: { items: DailyStudyPlanItem[]; progress?: Record<string, number> } | null;
  /**
   * Refreshing today's plan because the workspaces changed (not because the
   * student asked): time already spent on items checked off comes out of
   * today's budget, so the day does not grow behind the student's back.
   */
  refresh?: boolean;
  /**
   * Optional weight source (e.g. the grades module). Returning a number
   * overrides the row's own weight column; undefined falls back to it.
   */
  weightOf?: WeightResolver;
}

export interface BuiltDailyStudyPlan {
  items: DailyStudyPlanItem[];
  details: PlanDetails;
  sourceCount: number;
  candidateCount: number;
}

type PlanItemDraft = Omit<DailyStudyPlanItem, "completed">;

/**
 * A short fingerprint of what a plan was built from: which workspaces exist
 * and which rows their dated databases hold. A stored plan whose fingerprint
 * no longer matches is out of date: a workspace was created, duplicated,
 * restored or trashed, or rows were added or removed (a deadline import).
 * Edits inside a row (a status, a date) do not change it; reconcile handles
 * those without re-planning.
 */
export function planSourcesKey(workspaces: Workspace[]): string {
  const parts: string[] = [];
  for (const workspace of [...workspaces].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    parts.push(`w:${workspace.id}`);
    for (const database of workspace.databases) {
      if (!database.properties.some((property) => property.type === "date")) continue;
      parts.push(`d:${database.id}`, ...database.rows.map((row) => row.id).sort());
    }
  }
  // FNV-1a, 32-bit, twice with different seeds: compact and stable.
  const hash = (seed: number) => {
    let h = seed >>> 0;
    for (const part of parts) {
      for (let i = 0; i < part.length; i += 1) {
        h ^= part.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      h ^= 0x1f;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return `${workspaces.length}-${hash(0x811c9dc5)}${hash(0x9747b28c)}`;
}

/**
 * The items a student should see: never anything from a workspace that is
 * not in `workspaces` (the trash, or gone). Stored check-offs are kept, so a
 * workspace restored the same day brings its done items back.
 */
export function visiblePlanItems(
  items: DailyStudyPlanItem[],
  workspaces: Workspace[],
): DailyStudyPlanItem[] {
  const ids = new Set(workspaces.map((workspace) => workspace.id));
  return items.filter((item) => ids.has(item.target.workspaceId));
}

/**
 * The plan details a student should see beside `visiblePlanItems`. A plan
 * built from these same workspaces is shown as it is. A stale one (the
 * refresh after a workspace was trashed lost a race or failed) must not
 * contradict its own list: exam countdowns from workspaces no longer there
 * are dropped, and so is the workload heads-up, which cannot be split by
 * workspace and would otherwise cite work from the trash.
 */
export function visiblePlanDetails(details: PlanDetails, workspaces: Workspace[]): PlanDetails {
  if (details.sources !== undefined && details.sources === planSourcesKey(workspaces)) return details;
  const ids = new Set(workspaces.map((workspace) => workspace.id));
  return {
    ...details,
    exams: details.exams.filter((exam) => ids.has(exam.target.workspaceId)),
    workload: null,
  };
}

interface Candidate {
  item: PlanItemDraft;
  score: number;
  /** A plain review session's deck, so the session can be resized honestly. */
  deck?: DeckLoad;
  /** An administrative deadline: a fixed few minutes, outside the item cap. */
  formality?: boolean;
  /** A formality due within FORMALITY_GUARANTEE_DAYS: placed before anything else. */
  guaranteed?: boolean;
  /** A module exam session may grow to this when the day has time left. */
  growTo?: number;
}

/** What a deck has for today: reviews due, new cards to introduce, all cards ready. */
interface DeckLoad {
  reviewsDue: number;
  newPlanned: number;
  /** Reviews due plus every new card (what the deck's own "Study N due" offers). */
  ready: number;
}

interface DeckInfo {
  workspaceId: string;
  page: Page;
  block: FlashcardsBlock;
  text: string;
  reviewsDue: number;
  newPlanned: number;
  studyable: number;
}

interface QuizInfo {
  workspaceId: string;
  page: Page;
  block: QuizBlock;
  text: string;
  playable: number;
}

interface ExamRow {
  workspace: Workspace;
  database: Database;
  row: DatabaseRow;
  title: string;
  course: string | null;
  days: number;
  date: string;
  major: boolean;
  /** Decides a module (see MODULE_PREP_WINDOW_DAYS). */
  module: boolean;
  /** Total preparation minutes (classify `examPrepTotalMinutes`). */
  prepTotal: number;
  weight: number | null;
  target: PlanTarget;
  ledgerKey: string;
}

interface WorkloadEntry {
  candidateId: string | null;
  title: string;
  /** Days until it must be done (0 = today). */
  due: number;
  minutes: number;
}

export function normalizeDailyMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAILY_MINUTES;
  return Math.min(MAX_DAILY_MINUTES, Math.max(15, Math.round(value)));
}

/** Minutes for a one-day override ("I only have 15 minutes today"). */
export function normalizeTodayMinutes(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(480, Math.max(10, Math.round(value)));
}

export function buildDailyStudyPlan(input: PlannerInput): BuiltDailyStudyPlan {
  const { workspaces, localDate } = input;
  const dailyBudget = normalizeDailyMinutes(input.dailyMinutes);
  const todayOverride = normalizeTodayMinutes(input.todayMinutes);
  const budget = todayOverride ?? dailyBudget;

  // ---- Roll-forward bookkeeping -------------------------------------------
  const previous =
    input.previous && input.previous.localDate < localDate ? input.previous : null;
  const ledger: Record<string, number> = { ...(previous?.progress ?? input.current?.progress ?? {}) };
  if (previous) {
    for (const item of previous.items) {
      if (item.completed && item.ledgerKey && item.mode !== "study") {
        ledger[item.ledgerKey] = (ledger[item.ledgerKey] ?? 0) + item.minutes;
      }
    }
  }
  const carried = new Map<string, { from: string; count: number }>();
  if (previous) {
    for (const item of previous.items) {
      if (!item.completed) {
        carried.set(item.id, { from: previous.localDate, count: (item.carry?.count ?? 0) + 1 });
      }
    }
  }

  // ---- Observe ------------------------------------------------------------
  const candidates: Candidate[] = [];
  const workload: WorkloadEntry[] = [];
  const exams: ExamRow[] = [];
  const decks: DeckInfo[] = [];
  const quizzes: QuizInfo[] = [];
  const openLedgerKeys = new Set<string>();

  for (const workspace of workspaces) {
    for (const database of workspace.databases) {
      collectRows(workspace, database);
    }
    for (const page of workspace.pages) {
      for (const block of page.blocks) collectBlock(workspace, page, block);
    }
  }

  function collectRows(workspace: Workspace, database: Database) {
    const rows = datedRows(workspace, database, { weightOf: input.weightOf });
    if (rows.length === 0) return;
    const field = completionField(database);
    for (const { row, due, title, weight, exam, formality, target, ledgerKey } of rows) {
      const days = dayDiff(localDate, due);

      if (formality) {
        if (days < -OVERDUE_WINDOW_DAYS) continue;
        // Kept in the ledger, so a formality ticked off in a list without a
        // done column stays done on the days after.
        openLedgerKeys.add(ledgerKey);
        if ((ledger[ledgerKey] ?? 0) >= FORMALITY_MINUTES) continue;
        const id = `deadline:${workspace.id}:${database.id}:${row.id}`;
        if (days <= WORKLOAD_HORIZON_DAYS) {
          workload.push({ candidateId: id, title, due: Math.max(0, days), minutes: FORMALITY_MINUTES });
        }
        if (days > FORMALITY_LEAD_DAYS) continue;
        // One short item to finish: never split into sessions, never "start
        // early", never shrunk to a restart. Overdue, it is scored like any
        // overdue deadline (it may still be possible, or need a call).
        candidates.push({
          score: days < 0 ? deadlineScore(days, weight) : formalityScore(days),
          formality: true,
          guaranteed: days >= 0 && days <= FORMALITY_GUARANTEE_DAYS,
          item: {
            id,
            kind: "deadline",
            mode: field ? "finish" : "session",
            title,
            workspaceName: cleanText(workspace.name),
            section: cleanText(database.name),
            target,
            minutes: FORMALITY_MINUTES,
            reason: { code: formalityCode(days), days, effortMinutes: FORMALITY_MINUTES },
            ...(weight !== null ? { weight } : {}),
            dueDate: due,
            ledgerKey,
          },
        });
        continue;
      }

      if (exam.isExam) {
        if (days < 0 || days > EXAM_COUNTDOWN_DAYS) continue;
        openLedgerKeys.add(ledgerKey);
        exams.push({
          workspace,
          database,
          row,
          title,
          course: rowCourse(workspace, database, row),
          days,
          date: due,
          major: exam.major,
          module: exam.module === true,
          prepTotal: examPrepTotalMinutes(workspace, database, row, exam, weight),
          weight,
          target,
          ledgerKey,
        });
        continue;
      }

      if (days < -OVERDUE_WINDOW_DAYS) continue;
      openLedgerKeys.add(ledgerKey);
      const effort = Math.max(
        15,
        estimateEffortMinutes(database, row, title, weight) - (ledger[ledgerKey] ?? 0),
      );
      const id = `deadline:${workspace.id}:${database.id}:${row.id}`;
      if (days <= WORKLOAD_HORIZON_DAYS) {
        workload.push({ candidateId: id, title, due: Math.max(0, days), minutes: effort });
      }
      if (days > EXAM_PREP_WINDOW_DAYS) continue;

      // Due within a day (or already passed): finish it. Further out: a
      // work session toward it, sized to spread the effort over the days left.
      const finishing = days <= 1;
      const mode: PlanItemMode = finishing && field ? "finish" : "session";
      const minutes = finishing
        ? clampRound(effort, 15, 60)
        : clampRound(Math.ceil(effort / Math.max(days, 1)), 15, 60);
      candidates.push({
        score: deadlineScore(days, weight),
        item: {
          id,
          kind: "deadline",
          mode,
          title,
          workspaceName: cleanText(workspace.name),
          section: cleanText(database.name),
          target,
          minutes,
          reason: { code: deadlineCode(days), days, effortMinutes: effort },
          ...(weight !== null ? { weight } : {}),
          dueDate: due,
          ledgerKey,
        },
      });
    }
  }

  function collectBlock(workspace: Workspace, page: Page, block: Block) {
    if (block.type === "flashcards") {
      let reviewsDue = 0;
      let fresh = 0;
      let studyable = 0;
      for (const card of block.cards) {
        // A card with an empty side cannot be studied, so it is never "due".
        if (!isStudyable(card)) continue;
        studyable += 1;
        if (isNew(card)) fresh += 1;
        else if (card.dueAt && card.dueAt <= localDate) reviewsDue += 1;
      }
      if (studyable === 0) return;
      const newPlanned = Math.min(fresh, NEW_CARDS_PER_SESSION);
      const deckTitle = cleanText(block.title || page.title || workspace.name);
      decks.push({
        workspaceId: workspace.id,
        page,
        block,
        text: `${page.title} ${block.title ?? ""}`,
        reviewsDue,
        newPlanned,
        studyable,
      });
      if (reviewsDue + newPlanned === 0 || !deckTitle) return;
      const deck: DeckLoad = { reviewsDue, newPlanned, ready: reviewsDue + fresh };
      const minutes = deckMinutes(reviewsDue, newPlanned);
      candidates.push({
        score: reviewsDue > 0 ? 600 + Math.min(reviewsDue, 50) * 4 : 360 + newPlanned * 2,
        deck,
        item: deckItem(
          {
            id: `flashcards:${workspace.id}:${page.id}:${block.id}`,
            kind: "flashcards",
            mode: "study",
            title: deckTitle,
            workspaceName: cleanText(workspace.name),
            section: cleanText(page.title),
            target: { workspaceId: workspace.id, pageId: page.id, blockId: block.id },
            minutes,
            reason: { code: reviewsDue > 0 ? "cards_due" : "new_cards" },
          },
          deck,
          minutes,
        ),
      });
      return;
    }

    if (block.type === "quiz") {
      const playable = (block.questions ?? []).filter(isPlayableQuestion).length;
      if (playable === 0) return;
      quizzes.push({
        workspaceId: workspace.id,
        page,
        block,
        text: `${page.title} ${block.title ?? ""}`,
        playable,
      });
      return;
    }

    if (block.type === "todo" && !block.checked) {
      const text = cleanText(block.text);
      if (!text) return;
      candidates.push({
        score: 140,
        item: {
          id: `task:${workspace.id}:${page.id}:${block.id}`,
          kind: "task",
          mode: "finish",
          title: text,
          workspaceName: cleanText(workspace.name),
          section: cleanText(page.title),
          target: { workspaceId: workspace.id, pageId: page.id, blockId: block.id },
          minutes: 15,
          reason: { code: "open_task" },
        },
      });
    }
  }

  // ---- Exams: countdowns and review sessions planned backwards -------------
  const countdowns: ExamCountdown[] = exams
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
    .slice(0, 6)
    .map((exam) => {
      // "Final exam" alone does not say which one: name the course, unless
      // the title already does.
      const course =
        exam.course && !exam.title.toLowerCase().includes(exam.course.toLowerCase())
          ? exam.course.slice(0, 180)
          : undefined;
      return {
        id: `exam:${exam.ledgerKey}`,
        title: exam.title,
        workspaceName: cleanText(exam.workspace.name),
        ...(course ? { course } : {}),
        date: exam.date,
        days: exam.days,
        major: exam.major,
        target: exam.target,
      };
    });

  /**
   * Exams in the workload window with no review session today: if the
   * workload check says to start one of them today, its notes session is
   * added then, so the heads-up never names work the plan leaves out.
   */
  const examFallbacks = new Map<string, Candidate>();
  const usedDecks = new Set<string>();
  /** Days to the nearest module exam after today (none: Infinity). */
  const nearestModuleExam = Math.min(
    Infinity,
    ...exams.filter((exam) => exam.module && exam.days >= 1).map((exam) => exam.days),
  );
  for (const exam of exams) {
    const prepLeft = Math.max(0, exam.prepTotal - (ledger[exam.ledgerKey] ?? 0));
    const baseId = `exam:${exam.ledgerKey}`;
    // The workload check counts an exam's remaining preparation once the
    // exam is inside its horizon: all of it must happen before the exam.
    // Preparation for a module exam further out can still move to later
    // days, so it is not counted yet (no "30 hours don't fit" six weeks out).
    const inWorkload = exam.days >= 1 && exam.days <= WORKLOAD_HORIZON_DAYS && prepLeft > 0;
    const workloadEntry: WorkloadEntry | null = inWorkload
      ? { candidateId: null, title: exam.title, due: exam.days, minutes: prepLeft }
      : null;
    if (workloadEntry) workload.push(workloadEntry);
    if (exam.days > (exam.module ? MODULE_PREP_WINDOW_DAYS : EXAM_PREP_WINDOW_DAYS)) continue;

    // A module exam's sessions spread what is left over the review days to
    // come: they start at the usual size and may grow (`growTo`). In the last
    // two weeks a session is never shorter than the usual size, and the
    // nearest exam may take up to the longest session: the next Klausur is
    // what the day is for.
    const daily = exam.module && exam.days >= 1 && exam.days <= MODULE_DAILY_FROM;
    const sessionTarget = !exam.module
      ? null
      : daily && exam.days === nearestModuleExam
        ? MODULE_SESSION_MAX_MINUTES
        : Math.max(
            daily ? EXAM_SESSION_MINUTES : 0,
            clampRound(Math.ceil(prepLeft / moduleSessionsLeft(exam.days)), 20, MODULE_SESSION_MAX_MINUTES),
          );
    const wasCarried = [...carried.keys()].some((id) => id.startsWith(`${baseId}:`));
    if (!isReviewDay(exam.days, exam.major, exam.module) && !wasCarried) {
      if (workloadEntry) {
        const id = `${baseId}:notes`;
        workloadEntry.candidateId = id;
        examFallbacks.set(id, {
          score: 700 - exam.days * 8 + (exam.major ? 40 : 0),
          item: {
            id,
            kind: "exam",
            mode: "session",
            title: exam.title,
            workspaceName: cleanText(exam.workspace.name),
            section: cleanText(exam.database.name),
            target: exam.target,
            minutes: clampRound(Math.ceil(prepLeft / Math.max(exam.days, 1)), 20, 45),
            reason: { code: "exam_review", days: exam.days, examTitle: exam.title },
            ...(exam.weight !== null ? { weight: exam.weight } : {}),
            dueDate: exam.date,
            ledgerKey: exam.ledgerKey,
          },
        });
      }
      continue;
    }
    const firstCandidate = candidates.length;

    const sameWorkspaceExams = exams.filter((e) => e.workspace.id === exam.workspace.id);
    const singleCourse =
      new Set(sameWorkspaceExams.map((e) => e.course ?? e.title)).size <= 1;
    const keywords = courseKeywords(exam.course ?? exam.title);
    const matches = <T extends { workspaceId: string; text: string }>(list: T[]) => {
      const inWorkspace = list.filter((x) => x.workspaceId === exam.workspace.id);
      const named = inWorkspace.filter((x) => mentions(x.text, keywords));
      return named.length > 0 ? named : singleCourse ? inWorkspace : [];
    };

    const reason = (count?: number): PlanReason => ({
      code: exam.days === 0 ? "exam_today" : exam.days === 1 ? "exam_tomorrow" : "exam_review",
      days: exam.days,
      examTitle: exam.title,
      ...(count ? { count } : {}),
    });
    const score =
      (exam.days === 0 ? 920 : exam.days === 1 ? 880 : exam.days <= 3 ? 800 : 720 - exam.days * 8) +
      (exam.major ? 40 : 0);
    const sessionMinutes =
      exam.days === 0
        ? 20
        : sessionTarget !== null
          ? Math.min(sessionTarget, EXAM_SESSION_MINUTES)
          : clampRound(Math.ceil(prepLeft / Math.max(exam.days, 1)), 20, EXAM_SESSION_MINUTES);
    const growTo =
      exam.days > 0 && sessionTarget !== null && sessionTarget > sessionMinutes ? { growTo: sessionTarget } : {};
    const common = {
      workspaceName: cleanText(exam.workspace.name),
      ...(exam.weight !== null ? { weight: exam.weight } : {}),
      dueDate: exam.date,
      ledgerKey: exam.ledgerKey,
    };

    const deck = matches(decks)
      .filter((d) => !usedDecks.has(d.block.id))
      .sort((a, b) => b.reviewsDue + b.newPlanned - (a.reviewsDue + a.newPlanned) || b.studyable - a.studyable)[0];
    const quiz = matches(quizzes).sort((a, b) => b.playable - a.playable)[0];
    let planned = 0;

    if (deck) {
      usedDecks.add(deck.block.id);
      const due = deck.reviewsDue + deck.newPlanned;
      planned += 1;
      candidates.push({
        score,
        // A practice run (no cards due) is a work session that can grow.
        ...(due > 0 ? {} : growTo),
        item: {
          ...common,
          id: `${baseId}:${deck.block.id}`,
          kind: "exam",
          // With cards due, finishing them is the session (completes by
          // itself). With none due it is a practice run the student ticks off.
          mode: due > 0 ? "study" : "session",
          title: cleanText(deck.block.title || deck.page.title || exam.title),
          section: cleanText(deck.page.title),
          target: { workspaceId: exam.workspace.id, pageId: deck.page.id, blockId: deck.block.id },
          minutes: due > 0 ? Math.max(deckMinutes(deck.reviewsDue, deck.newPlanned), sessionMinutes) : sessionMinutes,
          reason: reason(due > 0 ? due : undefined),
          ...(due > 0 ? { dueCount: due } : {}),
        },
      });
    }
    // A practice quiz on the last three days, and every other review day.
    if (quiz && (exam.days <= 3 || exam.days % 2 === 1 || !deck)) {
      planned += 1;
      candidates.push({
        score: score - 5,
        item: {
          ...common,
          id: `${baseId}:${quiz.block.id}`,
          kind: "quiz",
          mode: "study",
          title: cleanText(quiz.block.title || quiz.page.title || exam.title),
          section: cleanText(quiz.page.title),
          target: { workspaceId: exam.workspace.id, pageId: quiz.page.id, blockId: quiz.block.id },
          minutes: clampRound(Math.min(quiz.playable * 2, 30), 10, 30),
          reason: reason(),
        },
      });
    }
    if (planned === 0) {
      candidates.push({
        score,
        ...growTo,
        item: {
          ...common,
          id: `${baseId}:notes`,
          kind: "exam",
          mode: "session",
          title: exam.title,
          section: cleanText(exam.database.name),
          target: exam.target,
          minutes: sessionMinutes,
          reason: reason(),
        },
      });
    }
    // Starting this exam's prep early (workload) boosts its first session.
    if (workloadEntry && candidates[firstCandidate]) {
      workloadEntry.candidateId = candidates[firstCandidate].item.id;
    }
  }

  // A deck used for exam prep replaces its plain review item.
  const pool = candidates.filter(
    (c) =>
      !(c.item.kind === "flashcards" && c.item.target.blockId && usedDecks.has(c.item.target.blockId)),
  );

  // ---- Honest workload ---------------------------------------------------
  const deckLoad = pool
    .filter((c) => c.item.kind === "flashcards" && c.item.reason.code === "cards_due")
    .reduce((sum, c) => sum + c.item.minutes, 0);
  const capacity = Math.max(dailyBudget - Math.min(deckLoad, dailyBudget / 2), dailyBudget / 2);
  const overload = checkWorkload(workload, capacity);
  if (overload) {
    for (const id of overload.startIds) {
      const fallback = examFallbacks.get(id);
      if (fallback && !pool.some((c) => c.item.id === id)) pool.push(fallback);
    }
    for (const c of pool) {
      if (overload.startIds.has(c.item.id)) {
        c.score += 250;
        if (c.item.reason.code === "due_soon" || c.item.reason.code === "due_later") {
          c.item = { ...c.item, reason: { ...c.item.reason, code: "start_early" } };
        }
      }
    }
  }

  // ---- Roll forward --------------------------------------------------------
  for (const c of pool) {
    const carry = carried.get(c.item.id);
    if (!carry) continue;
    c.item = { ...c.item, carry };
    if (c.item.mode !== "study") c.score += 100;
    if (carry.count >= RESTART_AFTER_CARRIES && c.item.mode !== "study") {
      // Waiting a while: make the next step small instead of bigger.
      c.item = { ...c.item, minutes: Math.min(c.item.minutes, RESTART_MINUTES) };
    }
  }

  pool.sort(compareCandidates);

  // ---- Fit today's time ------------------------------------------------------
  const kept = (input.current?.items ?? []).filter((item) => item.completed);
  const keptIds = new Set(kept.map((item) => item.id));
  const open = pool.filter((c) => !keptIds.has(c.item.id));
  let remaining = input.refresh
    ? budget - kept.reduce((sum, item) => sum + item.minutes, 0)
    : budget;
  const placed: { c: Candidate; minutes: number }[] = [];
  const isPlaced = (c: Candidate) => placed.some((p) => p.c === c);
  const place = (c: Candidate, minutes: number) => {
    const rounded = roundDown5(minutes);
    placed.push({ c, minutes: rounded });
    remaining -= rounded;
  };

  // The review share is a share of the day as the student has it, before
  // any formality takes its few minutes.
  const dayForShare = remaining;
  let formalities = 0;

  // A formality due within a few days goes in first: it takes minutes and
  // cannot be made up afterwards.
  for (const c of open) {
    if (!c.guaranteed || formalities >= MAX_FORMALITY_ITEMS) continue;
    if (remaining < c.item.minutes) break;
    place(c, c.item.minutes);
    formalities += 1;
  }

  // Due reviews first get a bounded share of the day, so a big deadline
  // cannot crowd the cards out (a skipped review day makes the next longer).
  // Very short days keep the plain priority order.
  if (dayForShare >= REVIEW_SHARE_MIN_BUDGET) {
    let share = Math.max(MIN_SESSION_MINUTES, roundDown5(dayForShare * REVIEW_SHARE));
    let reviews = 0;
    for (const c of open) {
      if (!c.deck) continue;
      if (share < MIN_SESSION_MINUTES || reviews >= MAX_REVIEW_ITEMS) break;
      const minutes = Math.min(c.item.minutes, share, remaining);
      if (minutes < MIN_SESSION_MINUTES) break;
      place(c, minutes);
      reviews += 1;
      share -= roundDown5(minutes);
    }
  }

  // Formalities do not count toward the item cap (they have their own).
  let workItems = placed.filter((p) => !p.c.formality).length;
  let tasks = 0;
  for (const c of open) {
    if (remaining < MIN_SESSION_MINUTES) break;
    if (isPlaced(c)) continue;
    if (c.formality ? formalities >= MAX_FORMALITY_ITEMS : workItems >= MAX_PLAN_ITEMS) continue;
    if (c.item.kind === "task" && tasks >= MAX_TASK_ITEMS) continue;
    const minutes = Math.min(c.item.minutes, remaining);
    if (minutes < MIN_SESSION_MINUTES) continue;
    if (c.item.kind === "task") tasks += 1;
    if (c.formality) formalities += 1;
    else workItems += 1;
    place(c, minutes);
  }

  // Time still free: give it back to what was shortened (a review session cut
  // to its share, a deadline due tomorrow), then let work sessions run longer
  // toward their remaining effort, so the plan uses the time the student has.
  const byPriority = [...placed].sort((a, b) => compareCandidates(a.c, b.c));
  // A stored plan holds at most MAX_STORED_PLAN_ITEMS, items already done
  // included (a rebuild keeps them): the least pressing give way.
  const room = Math.max(0, MAX_STORED_PLAN_ITEMS - kept.length);
  for (const dropped of byPriority.splice(room)) remaining += dropped.minutes;
  for (const p of byPriority) {
    if (remaining < 5) break;
    const grow = Math.min(p.c.item.minutes - p.minutes, remaining);
    if (grow >= 5) {
      p.minutes += roundDown5(grow);
      remaining -= roundDown5(grow);
    }
  }
  for (const p of byPriority) {
    if (remaining < 5) break;
    // A formality takes its few minutes, no more.
    if (p.c.formality) continue;
    if (p.c.item.kind !== "deadline" && p.c.growTo === undefined) continue;
    // Waiting a while: the small restart step stays small.
    if ((p.c.item.carry?.count ?? 0) >= RESTART_AFTER_CARRIES) continue;
    // A module exam session grows toward its share of the preparation left;
    // byPriority puts the nearest exam first, so it gets the most of the day.
    const limit =
      p.c.growTo ?? Math.min(p.c.item.reason.effortMinutes ?? p.minutes, MAX_SESSION_MINUTES);
    const grow = Math.min(limit - p.minutes, remaining);
    if (grow >= 5) {
      p.minutes += roundDown5(grow);
      remaining -= roundDown5(grow);
    }
  }

  const items: DailyStudyPlanItem[] = byPriority.map(({ c, minutes }) => ({
    ...(c.deck ? deckItem(c.item, c.deck, minutes) : { ...c.item, minutes }),
    completed: false,
  }));
  if (items[0]) items[0] = { ...items[0], startHere: true };

  const progress: Record<string, number> = {};
  for (const key of Object.keys(ledger)) {
    if (openLedgerKeys.has(key) && Object.keys(progress).length < MAX_LEDGER_KEYS) {
      progress[key] = ledger[key];
    }
  }

  const all = [...items, ...kept];
  const details: PlanDetails = {
    budgetMinutes: budget,
    ...(todayOverride !== undefined ? { budgetOverride: true } : {}),
    workload: overload?.workload ?? null,
    exams: countdowns,
    progress,
    ...(previous ? { previousDate: previous.localDate } : {}),
    ...(previous ? { carried: all.filter((i) => i.carry).length } : {}),
    sources: planSourcesKey(workspaces),
  };

  return {
    items: all,
    details,
    sourceCount: workspaces.length,
    candidateCount: pool.length,
  };
}

/**
 * Review days counted backwards from an exam: every one of the last three
 * days, every day of the last week for a major exam, and spaced sessions
 * (5, 7, 10, 14, 21 days out) before that.
 *
 * A module exam (`module`) is prepared like a German Klausurenphase: twice a
 * week from 42 to 29 days out (42, 38, 35, 31), every other day from 28 to
 * 15 (28, 26, ..., 16), and every day of the last 14.
 */
export function isReviewDay(daysToExam: number, major: boolean, module = false): boolean {
  if (daysToExam < 0) return false;
  if (module) {
    if (daysToExam > MODULE_PREP_WINDOW_DAYS) return false;
    if (daysToExam <= MODULE_DAILY_FROM) return true;
    if (daysToExam <= MODULE_EVERY_OTHER_DAY_FROM) return daysToExam % 2 === 0;
    return daysToExam % 7 === 0 || daysToExam % 7 === 3;
  }
  if (daysToExam <= 3) return true;
  if (major && daysToExam <= 7) return true;
  return [5, 7, 10, 14, 21].includes(daysToExam);
}

/** Module exam review days from today (included) to the day before the exam. */
function moduleSessionsLeft(daysToExam: number): number {
  let count = 0;
  for (let day = daysToExam; day >= 1; day -= 1) if (isReviewDay(day, true, true)) count += 1;
  return Math.max(1, count);
}

/** A formality due today first of all; a week out still above most work sessions. */
function formalityScore(days: number): number {
  return days <= 0 ? 950 : 940 - days * 40;
}

function formalityCode(days: number): PlanReason["code"] {
  if (days < 0) return "formality_overdue";
  if (days === 0) return "formality_today";
  if (days === 1) return "formality_tomorrow";
  return "formality_soon";
}

/**
 * Does the work due in the coming days fit the student's daily time? For each
 * due day D (two or more days out) in the horizon, everything due by D must
 * be done on the D days before it (today counts). Reports the first window that does not fit, with
 * the largest pieces in it as what to start today.
 */
function checkWorkload(
  entries: WorkloadEntry[],
  capacityPerDay: number,
): { workload: Workload; startIds: Set<string> } | null {
  const dues = [...new Set(entries.map((e) => e.due))].sort((a, b) => a - b);
  for (const due of dues) {
    // Look ahead: a window of at least two days, so there is still time to
    // act on the warning (work due sooner still counts toward later windows).
    if (due < 2) continue;
    const inWindow = entries.filter((e) => e.due <= due);
    const needed = inWindow.reduce((sum, e) => sum + e.minutes, 0);
    const days = Math.max(1, due);
    const available = Math.round(capacityPerDay * days);
    if (needed <= available) continue;
    const start = inWindow
      .filter((e) => e.due >= 1 || inWindow.every((x) => x.due === 0))
      .sort((a, b) => b.minutes - a.minutes || a.due - b.due)
      .slice(0, 2);
    return {
      workload: {
        overloaded: true,
        days,
        neededMinutes: Math.round(needed),
        availableMinutes: available,
        startToday: start.map((e) => e.title),
      },
      startIds: new Set(start.map((e) => e.candidateId).filter((id): id is string => Boolean(id))),
    };
  }
  return null;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.score !== b.score) return b.score - a.score;
  const ad = a.item.dueDate;
  const bd = b.item.dueDate;
  if (ad && bd && ad !== bd) return ad.localeCompare(bd);
  if (ad && !bd) return -1;
  if (bd && !ad) return 1;
  return a.item.title.localeCompare(b.item.title) || a.item.id.localeCompare(b.item.id);
}

function deadlineScore(days: number, weight: number | null): number {
  let score: number;
  if (days < 0) score = Math.max(650, 860 - Math.abs(days) * 15);
  else if (days === 0) score = 900;
  else if (days === 1) score = 780;
  else if (days <= 3) score = 660 - days * 10;
  else if (days <= 7) score = 520 - days * 5;
  else if (days <= 14) score = 340 - days * 3;
  else score = 200 - days;
  return score + Math.min(Math.max(weight ?? 0, 0), 60) * 2;
}

function deadlineCode(days: number): PlanReason["code"] {
  if (days < 0) return "overdue";
  if (days === 0) return "due_today";
  if (days === 1) return "due_tomorrow";
  if (days <= 7) return "due_soon";
  return "due_later";
}

function deckMinutes(reviewsDue: number, newPlanned: number): number {
  return clampRound(
    Math.ceil(reviewsDue * MINUTES_PER_REVIEW + newPlanned * MINUTES_PER_NEW_CARD),
    10,
    MAX_DECK_MINUTES,
  );
}

/** How many cards fit in `minutes`: reviews first, then new cards. */
export function cardsForMinutes(
  minutes: number,
  reviewsDue: number,
  newPlanned: number,
): { reviews: number; fresh: number } {
  const reviews = Math.min(reviewsDue, Math.floor(minutes / MINUTES_PER_REVIEW + 1e-9));
  const left = minutes - reviews * MINUTES_PER_REVIEW;
  const fresh = Math.min(newPlanned, Math.max(0, Math.floor(left / MINUTES_PER_NEW_CARD + 1e-9)));
  // A session always has at least one card (the minimum session is ten minutes).
  if (reviews + fresh === 0) return reviewsDue > 0 ? { reviews: 1, fresh: 0 } : { reviews: 0, fresh: Math.min(1, newPlanned) };
  return { reviews, fresh };
}

/**
 * A review session sized to `minutes`: the cards planned are what fits, and
 * when that is fewer than the deck has ready the item says so (`readyCount`),
 * so "20 cards" never hides that 64 are waiting.
 */
function deckItem(item: PlanItemDraft, deck: DeckLoad, minutes: number): PlanItemDraft {
  const fit = cardsForMinutes(minutes, deck.reviewsDue, deck.newPlanned);
  const count = fit.reviews + fit.fresh;
  const reason: PlanReason = {
    ...item.reason,
    code: fit.reviews > 0 ? "cards_due" : "new_cards",
    count,
  };
  if (count < deck.ready) reason.readyCount = deck.ready;
  else delete reason.readyCount;
  return { ...item, minutes, reason, dueCount: count };
}

/** Clamp, then round to a friendly multiple of five minutes. */
function clampRound(value: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  return Math.min(max, Math.max(min, Math.round(clamped / 5) * 5));
}

function roundDown5(value: number): number {
  return value >= 10 ? Math.floor(value / 5) * 5 : value;
}
