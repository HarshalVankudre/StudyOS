import { z } from "zod";

export const DAILY_STUDY_AGENT_KEY = "daily-study";
export const DEFAULT_DAILY_MINUTES = 60;
export const DAILY_MINUTES_OPTIONS = [30, 45, 60, 90, 120] as const;
/** "How much time do you have today?" choices offered when rebuilding. */
export const TODAY_MINUTES_OPTIONS = [15, 30, 60, 90] as const;

/**
 * Plan storage versions. Version 1 stored English sentences (`summary`,
 * `reason`, a pre-built `href`). Version 2 stores structured data only and is
 * rendered through the i18n dictionaries at display time (see present.ts), so
 * switching language changes the plan text. A version-1 plan for today is
 * rebuilt as version 2 on first read, keeping what the student checked off.
 */
export const PLAN_VERSION = 2;

/** After this many roll-forwards, an item shrinks to a small restart. */
export const RESTART_AFTER_CARRIES = 3;

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().min(1).max(200);

/**
 * Where a plan item lives. Turned into a deep link with `workspaceHref`
 * (lib/workspace/deep-link.ts): `/app/<workspaceId>?page=<pageId>` plus
 * `&block=<blockId>` or `&db=<databaseId>&row=<rowId>`.
 */
export const planTargetSchema = z.object({
  workspaceId: id,
  pageId: id.optional(),
  blockId: id.optional(),
  databaseId: id.optional(),
  rowId: id.optional(),
});
export type PlanTarget = z.infer<typeof planTargetSchema>;

export const REASON_CODES = [
  "overdue",
  "due_today",
  "due_tomorrow",
  "due_soon",
  "due_later",
  "start_early",
  "exam_today",
  "exam_tomorrow",
  "exam_review",
  "cards_due",
  "new_cards",
  "open_task",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const planReasonSchema = z.object({
  code: z.enum(REASON_CODES),
  /** Calendar days to the due date / exam (negative when it has passed). */
  days: z.number().int().min(-400).max(400).optional(),
  /** Cards ready, for flashcard reasons. */
  count: z.number().int().nonnegative().max(100_000).optional(),
  /**
   * Every card the deck has ready today, when the session takes only part of
   * them (a bounded session: the rest wait for later days).
   */
  readyCount: z.number().int().nonnegative().max(100_000).optional(),
  /** The exam this session prepares for (the student's own title). */
  examTitle: z.string().max(180).optional(),
  /** Estimated minutes of work left before the due date. */
  effortMinutes: z.number().int().nonnegative().max(100_000).optional(),
});
export type PlanReason = z.infer<typeof planReasonSchema>;

/**
 * - deadline: a database row with a due date (assignment, reading, project)
 * - exam: a review session planned backwards from an exam
 * - flashcards: a deck with cards ready for review
 * - quiz: a practice quiz (exam prep)
 * - task: an open to-do block
 */
export const PLAN_ITEM_KINDS = ["deadline", "exam", "flashcards", "quiz", "task"] as const;
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number];

/**
 * How checking an item off behaves:
 * - finish: completes the source (checks the to-do, sets the row's done value)
 * - session: records today's work session only; the coursework stays open
 * - study: completes by itself when the student studies (cards, quiz)
 */
export const PLAN_ITEM_MODES = ["finish", "session", "study"] as const;
export type PlanItemMode = (typeof PLAN_ITEM_MODES)[number];

const cellValue = z.union([
  z.string().max(2_000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(100),
  z.null(),
]);

export const planItemSchema = z.object({
  id: z.string().min(1).max(400),
  kind: z.enum(PLAN_ITEM_KINDS),
  mode: z.enum(PLAN_ITEM_MODES),
  /** The student's own words (row title, to-do text, deck title). Never translated. */
  title: z.string().min(1).max(180),
  workspaceName: z.string().max(180),
  /** Page or database the item sits in. */
  section: z.string().max(180),
  target: planTargetSchema,
  minutes: z.number().int().min(5).max(240),
  reason: planReasonSchema,
  /** Grade weight in percent, when the row has one. */
  weight: z.number().min(0).max(100).optional(),
  dueDate: dayKey.optional(),
  /** Cards planned for this session (flashcards and deck-based exam prep). */
  dueCount: z.number().int().positive().max(100_000).optional(),
  /** Rolled forward from an earlier day's plan. */
  carry: z
    .object({ from: dayKey, count: z.number().int().positive().max(365) })
    .optional(),
  /**
   * The coursework row this session works toward (`workspace:database:row`),
   * so finished sessions shrink its remaining effort in later plans.
   */
  ledgerKey: z.string().max(400).optional(),
  /** First item to start with ("not sure where to start? here"). */
  startHere: z.boolean().optional(),
  completed: z.boolean(),
  completedAt: z.string().max(40).optional(),
  /** Study progress today, e.g. cards reviewed of those planned. */
  progress: z
    .object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
    .optional(),
  /** The row's completion cell before StudyOS marked it done (for Undo). */
  restore: cellValue.optional(),
});
export type DailyStudyPlanItem = z.infer<typeof planItemSchema>;

export const dailyStudyPlanItemsSchema = z.array(planItemSchema).max(12);

export const examCountdownSchema = z.object({
  id: z.string().min(1).max(400),
  title: z.string().min(1).max(180),
  workspaceName: z.string().max(180),
  /** The course the exam belongs to, when its row names one (not already in the title). */
  course: z.string().max(180).optional(),
  date: dayKey,
  days: z.number().int().min(0).max(400),
  major: z.boolean(),
  target: planTargetSchema,
});
export type ExamCountdown = z.infer<typeof examCountdownSchema>;

/**
 * Honest workload check: work due within `days` days needs about
 * `neededMinutes`, while the student's daily time gives `availableMinutes`.
 */
export const workloadSchema = z.object({
  overloaded: z.boolean(),
  days: z.number().int().min(1).max(60),
  neededMinutes: z.number().int().nonnegative(),
  availableMinutes: z.number().int().nonnegative(),
  /** Titles of what to start today (the student's own words). */
  startToday: z.array(z.string().max(180)).max(3),
});
export type Workload = z.infer<typeof workloadSchema>;

export const planDetailsSchema = z.object({
  /** Minutes planned for today (the daily budget, or today's override). */
  budgetMinutes: z.number().int().min(5).max(600),
  /** True when the student chose a different amount of time for today. */
  budgetOverride: z.boolean().optional(),
  workload: workloadSchema.nullable(),
  exams: z.array(examCountdownSchema).max(6),
  /**
   * Minutes of work sessions already done per row (`workspace:database:row`),
   * carried from plan to plan so effort estimates shrink as work gets done.
   */
  progress: z.record(z.string().max(400), z.number().int().nonnegative()),
  /** Local day of the plan before this one, when there was one. */
  previousDate: dayKey.optional(),
  /** Unfinished items rolled forward from that plan. */
  carried: z.number().int().nonnegative().optional(),
  /** Fingerprint of the workspaces the plan was built from (planner `planSourcesKey`). */
  sources: z.string().max(64).optional(),
});
export type PlanDetails = z.infer<typeof planDetailsSchema>;

export const EMPTY_PLAN_DETAILS: PlanDetails = {
  budgetMinutes: DEFAULT_DAILY_MINUTES,
  workload: null,
  exams: [],
  progress: {},
};

/** Version-1 item: only what roll-forward needs (its id and whether it was done). */
const legacyItemSchema = z.object({
  id: z.string().min(1).max(400),
  completed: z.boolean(),
});

export interface DailyStudyAgentConfigData {
  enabled: boolean;
  dailyMinutes: number;
  timeZone: string;
}

export interface DailyStudyPlanData {
  id: string;
  localDate: string;
  timeZone: string;
  version: number;
  items: DailyStudyPlanItem[];
  details: PlanDetails;
  sourceCount: number;
  candidateCount: number;
  generatedAt: Date;
}

/** The plan as handed to client components (plain JSON). */
export interface TodayPlanView {
  id: string;
  localDate: string;
  timeZone: string;
  items: DailyStudyPlanItem[];
  details: PlanDetails;
  sourceCount: number;
  candidateCount: number;
  generatedAt: string;
}

export interface AgentRunData {
  id: string;
  trigger: "auto" | "manual";
  status: "running" | "completed" | "failed";
  /** Structured run summary (version 2), or null for older runs and failures. */
  result: RunSummary | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface AgentCenterSnapshot {
  config: DailyStudyAgentConfigData;
  plan: TodayPlanView | null;
  runs: AgentRunData[];
}

/** What a run produced, stored as JSON in AgentRun.summary and rendered localized. */
export const runSummarySchema = z.object({
  v: z.literal(2),
  items: z.number().int().nonnegative(),
  minutes: z.number().int().nonnegative(),
  workspaces: z.number().int().nonnegative(),
  overloaded: z.boolean().optional(),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

export function parseRunSummary(value: string | null): RunSummary | null {
  if (!value || !value.startsWith("{")) return null;
  try {
    const parsed = runSummarySchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseDailyStudyPlanItems(value: string): DailyStudyPlanItem[] {
  const parsed = dailyStudyPlanItemsSchema.safeParse(JSON.parse(value));
  if (!parsed.success) throw new Error("The saved daily study plan is invalid.");
  return parsed.data;
}

/** Ids and done flags of any stored plan, version 1 or 2 (empty when unreadable). */
export function parseStoredItemStates(value: string): { id: string; completed: boolean }[] {
  try {
    const parsed = z.array(legacyItemSchema).safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function parsePlanDetails(value: string | null | undefined): PlanDetails {
  if (!value) return { ...EMPTY_PLAN_DETAILS };
  try {
    const parsed = planDetailsSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : { ...EMPTY_PLAN_DETAILS };
  } catch {
    return { ...EMPTY_PLAN_DETAILS };
  }
}
