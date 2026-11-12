/**
 * StudyOS — Workspace generator.
 *
 * This is THE BOUNDARY between the app and the AI. Everything upstream just
 * calls `generateWorkspace(prompt)` and gets back a Workspace to render/save.
 *
 * With an AI key configured it calls the model; without one (local
 * development only) it builds a rule-based MOCK. In production a missing key
 * or a failed model call is an honest error — never a silent template.
 */
import { z } from "zod";
import type {
  Block,
  Database,
  DatabaseRow,
  Page,
  SelectOption,
  Workspace,
} from "@/lib/workspace/types";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import { repairWorkspace } from "@/lib/workspace/repair";
import { sampleWorkspace } from "@/lib/workspace/sample";
import { normalizeSourceText, sourceTextBlock } from "@/lib/import/syllabus";
import {
  datesInText,
  extractSyllabusFacts,
  syllabusFactsBlock,
  type SyllabusFacts,
} from "@/lib/import/syllabus-facts";
import { applySyllabusFacts, type AssessmentLabels } from "@/lib/import/syllabus-merge";
import { ensureGradeTracking, type GradeTrackingLabels } from "@/lib/grades/ensure";
import { reportError } from "@/lib/ops/report-error";
import { modelForPlan } from "./plans";
import { streamChatCompletion } from "./openrouter";
import { AiRefusalError } from "./anthropic";
import { AiTruncatedError } from "./ai-errors";
import { isAiConfigured, missingAiKeyMessage, providerForModel } from "./provider";
import {
  forwardUsage as forwardMeteredUsage,
  recordUsage,
  withUsageMeter,
  type TokenUsage,
} from "./usage-meter";
import { addDaysIso, clockPromptBlock, studentClock, type StudentClock } from "./student-clock";
import { clipText, defaultQuestions, normalizeGenQuestions, oneEmoji, QUESTION_LIMITS, type GenQuestion } from "./onboarding";
import {
  GENERATION_COMPONENT_KINDS,
  type GenerationComponent,
  type GenerationComponentKind,
  type WorkspaceGenerationPlan,
} from "./generation-progress";
import {
  inputEvidence,
  polishGeneratedWorkspace,
  removeUnsupportedFacts,
  type InputEvidence,
} from "./generate-polish";
import { createWorkspaceStreamScanner, type WorkspaceStreamEvent } from "./workspace-stream";
import { DEFAULT_LOCALE, englishName, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";

/** Default model when a caller doesn't pass one (free tier). */
const DEFAULT_MODEL = modelForPlan("free");

/**
 * Appended to every system prompt so the model writes user-facing content in the
 * active language. Returns "" for English. Structural tokens (JSON keys, ids,
 * and the `type`/`kind`/`color` enum values) must stay unchanged.
 */
export function languageDirective(locale: Locale): string {
  const language = locale === DEFAULT_LOCALE ? "" : [
    "",
    "LANGUAGE:",
    `- Write ALL user-facing text in ${englishName(locale)}: workspace name, page titles, database names and descriptions, property names, select/status option labels, row text content, headings, callouts, replies, questions, and choice labels.`,
    "- Do NOT translate or change JSON keys, ids, or the literal enum values for `type`, `kind`, and `color`.",
    `- Date values in JSON (date cells, filter values) stay in ISO format (YYYY-MM-DD). Dates written in text (callouts, paragraphs, to-dos, cards, questions, replies) use the natural ${englishName(locale)} format, never YYYY-MM-DD.`,
  ].join("\n");
  return [
    language,
    "",
    "REPLY FORMATTING (your reply text is rendered as Markdown):",
    "- For code, SQL, commands, or identifiers: use backticks, e.g. `SELECT col FROM table` — never use LaTeX commands like \\texttt{}.",
    "- For math: wrap inline math in single dollar signs, e.g. $E = mc^2$; display math in double dollar signs, e.g. $$\\sum_{i=1}^n x_i$$.",
    "- Never output raw LaTeX commands (\\texttt, \\textbf, \\item, etc.) outside of math delimiters — they will not render.",
    "- Use standard Markdown: **bold**, *italic*, lists, tables, and fenced code blocks with language tags.",
  ].join("\n");
}

/** Why a generation delivered nothing usable. */
export type GenerationFailureReason =
  | "not_configured"
  | "model_error"
  | "invalid_output"
  | "refused"
  | "timeout";

/** Generation produced no usable workspace (after any retry). Nothing to save or charge. */
export class GenerationFailedError extends Error {
  readonly reason: GenerationFailureReason;
  constructor(reason: GenerationFailureReason, message?: string, options?: { cause?: unknown }) {
    super(message ?? `Workspace generation failed (${reason})`, options);
    this.name = "GenerationFailedError";
    this.reason = reason;
  }
}

/** The student cancelled: stop, save nothing. */
export class GenerationCancelledError extends Error {
  constructor() {
    super("Workspace generation cancelled");
    this.name = "GenerationCancelledError";
  }
}

/**
 * Key under which a running generation's AbortController is registered, so
 * the cancel endpoint can stop it. Scoped by user: nobody can cancel (or
 * probe) someone else's generation.
 */
export function generationTaskKey(userId: string, generationId: string): string {
  return `generate:${userId}:${generationId}`;
}

/** The model replied, but not with a valid workspace. */
class InvalidOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOutputError";
  }
}

export interface GenerateWorkspaceOptions {
  /** The student's local clock; defaults to now in UTC. */
  clock?: StudentClock;
  /** Aborts in-flight model calls and prevents further attempts. */
  signal?: AbortSignal;
  /** Total model attempts, including the automatic retry. Default 2. */
  maxAttempts?: number;
  /** Epoch ms: no attempt starts that is unlikely to finish by then, and calls abort at it. */
  deadline?: number;
  /**
   * What the model has written so far (databases, row counts, pages), as it
   * streams, so the build screen can show real progress. Best effort: only
   * streaming providers report it, and a retry starts the count again.
   */
  onProgress?: (event: GenerationStreamProgress) => void;
}

/**
 * A streamed piece of the workspace ("text" = just more of the reply), plus
 * how many characters of the reply have arrived.
 */
export type GenerationStreamProgress = (WorkspaceStreamEvent | { type: "text" }) & {
  chars: number;
  attempt: number;
};

/** Upper bound for one generation call; the route's deadline may cut it shorter. */
const GENERATION_CALL_TIMEOUT_MS = 200_000;
/** Upper bound for the small planning / questions calls. */
const SMALL_CALL_TIMEOUT_MS = 90_000;

/**
 * Build a workspace for the student. With a configured model: up to
 * `maxAttempts` model calls (one automatic retry for transient failures and
 * malformed output), then a `GenerationFailedError`. Only the successful
 * attempt's tokens are reported to an enclosing usage meter, so a failed
 * attempt is never billed; a cancelled attempt reports what it consumed.
 */
export async function generateWorkspace(
  prompt: string,
  model: string = DEFAULT_MODEL,
  preferences = "",
  plan?: WorkspaceGenerationPlan,
  locale: Locale = DEFAULT_LOCALE,
  sourceText = "",
  options: GenerateWorkspaceOptions = {},
): Promise<Workspace> {
  const clock = options.clock ?? studentClock();
  const source = normalizeSourceText(sourceText);
  const facts = extractSyllabusFacts(source, clock.date, locale);
  const given = [prompt, preferences, source].join("\n");
  const evidence = inputEvidence(given, datesInText(given, clock.date, locale).length);
  // Deterministic last steps: drop facts the student never gave (invented
  // deadlines, weights, codes), tidy what models routinely get wrong, keep
  // the syllabus's weights and dates, then make sure graded work has a score
  // column and a grades block to read it.
  const finish = (workspace: Workspace) =>
    ensureGradeTracking(
      applySyllabusFacts(
        polish(removeUnsupportedFacts(workspace, evidence), locale, clock),
        facts,
        assessmentLabels(locale),
      ),
      gradeLabels(locale),
    );

  if (!isAiConfigured(model)) {
    // The mock exists for local development without a key. In production a
    // missing key is a misconfiguration, and a template is not what the
    // student asked for.
    if (process.env.NODE_ENV === "production") {
      throw new GenerationFailedError(
        "not_configured",
        missingAiKeyMessage(model, "Workspace generation"),
      );
    }
    return finish(await mockGenerate(prompt, plan, preferences, clock));
  }

  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfCancelled(options.signal);
    const startedAt = Date.now();
    const metered = await withUsageMeter(async () => {
      try {
        const workspace = await openRouterGenerate(
          prompt, model, preferences, plan, locale, source, clock, facts, evidence, options, attempt,
        );
        return { ok: true as const, workspace };
      } catch (error) {
        return { ok: false as const, error };
      }
    });
    if (metered.result.ok) {
      forwardUsage(metered.usage);
      return finish(metered.result.workspace);
    }
    if (options.signal?.aborted) {
      // Cancelled mid-call: bill only what the cut-off call really consumed.
      forwardUsage(metered.usage);
      throw new GenerationCancelledError();
    }
    lastError = metered.result.error;
    reportError(lastError, {
      source: "generateWorkspace",
      status: `attempt ${attempt}/${maxAttempts} failed`,
    });
    const tookMs = Date.now() - startedAt;
    const outOfTime = options.deadline !== undefined && Date.now() + tookMs > options.deadline;
    if (!isRetryable(lastError) || outOfTime) break;
  }
  throw toGenerationFailure(lastError);
}

/** Re-report a nested meter's usage to the enclosing meter (if any). */
function forwardUsage(usage: TokenUsage) {
  // Keeps the per-model priced cost (cache reads/writes included).
  forwardMeteredUsage(usage);
}

function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new GenerationCancelledError();
}

function httpStatusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  const match = error instanceof Error ? error.message.match(/request failed \((\d{3})\)/) : null;
  return match ? Number(match[1]) : undefined;
}

/** Worth one more try: malformed/truncated output, timeouts, rate limits, 5xx, network. */
function isRetryable(error: unknown): boolean {
  if (error instanceof AiRefusalError || error instanceof GenerationFailedError) return false;
  const status = httpStatusOf(error);
  if (status === undefined) return true;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function toGenerationFailure(error: unknown): GenerationFailedError {
  if (error instanceof GenerationFailedError) return error;
  const reason: GenerationFailureReason =
    error instanceof AiRefusalError
      ? "refused"
      : error instanceof InvalidOutputError || /truncated/i.test(String(error))
        ? "invalid_output"
        : error instanceof Error && error.name === "TimeoutError"
          ? "timeout"
          : "model_error";
  return new GenerationFailedError(reason, undefined, { cause: error });
}

function assessmentLabels(locale: Locale): AssessmentLabels {
  const dict = getDictionary(locale);
  return { ...dict.ai.generate.assessments, score: dict.grades.scoreColumnName };
}

function gradeLabels(locale: Locale): GradeTrackingLabels {
  const g = getDictionary(locale).grades;
  return { score: g.scoreColumnName, heading: g.generatedHeading, title: g.defaultTitle };
}

function polish(workspace: Workspace, locale: Locale, clock: StudentClock): Workspace {
  const dict = getDictionary(locale);
  return polishGeneratedWorkspace(workspace, {
    locale,
    today: clock.date,
    labels: { thisWeek: dict.dbViews.thisWeekViewName, gradesTitle: dict.grades.defaultTitle },
  });
}

/** Limits of a plan, stated in the planning prompt and enforced by trimming. */
const PLAN_LIMITS = {
  workspaceName: 60,
  summary: 200,
  label: 40,
  description: 120,
  id: 50,
  components: 9,
} as const;

const generationPlanSchema = z.object({
  workspaceName: z.string().min(1).max(80),
  summary: z.string().min(1).max(240),
  components: z
    .array(
      z.object({
        id: z.string().min(1).max(50),
        kind: z.enum(GENERATION_COMPONENT_KINDS),
        label: z.string().min(1).max(50),
        icon: z.string().min(1).max(8),
        description: z.string().min(1).max(140),
      }),
    )
    .min(3)
    .max(9),
});

/**
 * Decide which workspace components best fit this student before generating
 * the full workspace. The returned plan drives both the model prompt and the
 * live loading UI, so the skeletons represent the actual planned output.
 */
export async function planWorkspace(
  prompt: string,
  model: string = DEFAULT_MODEL,
  preferences = "",
  locale: Locale = DEFAULT_LOCALE,
  sourceText = "",
  options: { signal?: AbortSignal } = {},
): Promise<WorkspaceGenerationPlan> {
  if (!isAiConfigured(model)) {
    return mockWorkspacePlan(prompt, preferences);
  }

  try {
    const raw = await callOpenRouter(
      model,
      buildWorkspacePlanSystemPrompt(locale),
      [
        `Student description:\n"""${prompt}"""`,
        preferences,
        // Choosing components needs the gist, not every page of the material.
        sourceTextBlock(sourceText.slice(0, PLAN_SOURCE_CHARS)),
        "Return only the JSON workspace plan.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      { signal: options.signal, timeoutMs: SMALL_CALL_TIMEOUT_MS, effort: "low", smallStep: true, maxTokens: SMALL_CALL_MAX_TOKENS },
    );
    const plan = normalizePlanReply(extractJson(raw));
    if (!plan) throw new InvalidOutputError("plan reply has no usable components");
    const parsed = generationPlanSchema.safeParse(normalizeWorkspacePlan(plan));
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  } catch (err) {
    if (options.signal?.aborted) throw new GenerationCancelledError();
    // The plan only picks components; the deterministic plan is a fair
    // stand-in and the workspace itself is still built by the model.
    reportError(err, { source: "planWorkspace", status: "failed; using fallback plan" });
    return mockWorkspacePlan(prompt, preferences);
  }
}

/** Source characters the plan and question calls see (the build sees all of it). */
const PLAN_SOURCE_CHARS = 12_000;
const QUESTIONS_SOURCE_CHARS = 8_000;

const DEFAULT_COMPONENT_ICONS: Record<GenerationComponentKind, string> = {
  dashboard: "🏠",
  courses: "📚",
  assignments: "📝",
  planner: "🗓️",
  exams: "🎯",
  readings: "📖",
  notes: "🗒️",
  habits: "🔥",
  grades: "💯",
  projects: "🧩",
  resources: "🔗",
  custom: "✨",
};

/**
 * The model's plan, with every field brought within the stated limits:
 * long text is trimmed, a multi-character icon is cut to one emoji (or the
 * kind's default), an unknown kind becomes "custom", ids are made unique.
 * Null only when there is no component to build.
 */
export function normalizePlanReply(raw: unknown): WorkspaceGenerationPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const reply = raw as Record<string, unknown>;
  const list = Array.isArray(reply.components) ? reply.components : [];
  const ids = new Set<string>();
  const components: GenerationComponent[] = [];
  for (const item of list) {
    if (components.length >= PLAN_LIMITS.components) break;
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const label = typeof c.label === "string" ? clipText(c.label, PLAN_LIMITS.label) : "";
    if (!label) continue;
    const kind: GenerationComponentKind = (GENERATION_COMPONENT_KINDS as readonly string[]).includes(String(c.kind))
      ? (c.kind as GenerationComponentKind)
      : "custom";
    const baseId =
      (typeof c.id === "string" ? c.id : label)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, PLAN_LIMITS.id - 4) || kind;
    let id = baseId;
    for (let n = 2; ids.has(id); n += 1) id = `${baseId}-${n}`;
    ids.add(id);
    const description = typeof c.description === "string" ? clipText(c.description, PLAN_LIMITS.description) : "";
    components.push({
      id,
      kind,
      label,
      icon: oneEmoji(c.icon) || DEFAULT_COMPONENT_ICONS[kind],
      description: description || label,
    });
  }
  if (components.length === 0) return null;
  const name = typeof reply.workspaceName === "string" ? clipText(reply.workspaceName, PLAN_LIMITS.workspaceName) : "";
  const summary = typeof reply.summary === "string" ? clipText(reply.summary, PLAN_LIMITS.summary) : "";
  return {
    workspaceName: name || "Study HQ",
    summary: summary || name || "Study HQ",
    components,
  };
}

function buildWorkspacePlanSystemPrompt(locale: Locale): string {
  return [
    "You are the StudyOS workspace architect.",
    "Choose the smallest useful set of components for this specific student. Do not force every student into the same template.",
    "A component represents a visible dashboard, page, tracker, or database the final workspace will contain.",
    "",
    "RULES:",
    "- Always include dashboard and courses.",
    "- Include assignments and a planner when the student has scheduled coursework or deadlines.",
    "- Add exams, readings, notes, habits, grades, projects, or resources only when their description or answers make them useful.",
    "- All graded work (homework, quizzes, labs, projects, exams) is ONE list in the final workspace. An exams or projects component is a page that views that list; a grades component is a page with the live grade calculator over that list, never a separate grade table.",
    "- Personalize every component to the student's actual subject — labels, icons and descriptions should fit their field (e.g. 'Lab Notebook' 🧪 for chemistry, 'Case Briefs' ⚖️ for law, 'Problem Sets' ✏️ for math), never generic placeholders.",
    "- Map their answers directly to components: whatever they say they want to track or struggle with should each surface as a relevant page or tracker.",
    "- Use 4–8 components total.",
    "",
    "LIMITS (stay well inside them):",
    `- workspaceName: at most ${PLAN_LIMITS.workspaceName - 20} characters. summary: one sentence, at most ${PLAN_LIMITS.summary - 60} characters.`,
    `- label: 1–3 words, at most ${PLAN_LIMITS.label - 15} characters. description: one short sentence, at most ${PLAN_LIMITS.description - 40} characters.`,
    "- icon: exactly one emoji.",
    "- id: a unique lowercase kebab-case string, e.g. \"problem-sets\".",
    `- kind must be one of: ${GENERATION_COMPONENT_KINDS.join(", ")}.`,
    "",
    "Output only JSON with this exact shape, nothing else:",
    '{"workspaceName":"Biology Study HQ","summary":"A focused semester system for labs, exams, and readings.","components":[{"id":"dashboard","kind":"dashboard","label":"Dashboard","icon":"🏠","description":"The semester at a glance."}]}',
    languageDirective(locale),
  ].join("\n");
}

function normalizeWorkspacePlan(
  plan: WorkspaceGenerationPlan,
): WorkspaceGenerationPlan {
  const seen = new Set<string>();
  const components = plan.components
    .filter((component) => {
      if (seen.has(component.id)) return false;
      seen.add(component.id);
      return true;
    })
    .slice(0, 9);

  const required: GenerationComponent[] = [
    {
      id: "dashboard",
      kind: "dashboard",
      label: "Dashboard",
      icon: "🏠",
      description: "Your priorities and study workload at a glance.",
    },
    {
      id: "courses",
      kind: "courses",
      label: "Courses",
      icon: "📚",
      description: "Courses, instructors, schedules, and key details.",
    },
  ];

  for (const component of required.reverse()) {
    if (!components.some((item) => item.kind === component.kind)) {
      components.unshift(component);
    }
  }

  return { ...plan, components: components.slice(0, 9) };
}

function mockWorkspacePlan(
  prompt: string,
  preferences = "",
): WorkspaceGenerationPlan {
  const source = `${prompt}\n${preferences}`.toLowerCase();
  const components: GenerationComponent[] = [
    {
      id: "dashboard",
      kind: "dashboard",
      label: "Dashboard",
      icon: "🏠",
      description: "Your semester, priorities, and next deadlines.",
    },
    {
      id: "courses",
      kind: "courses",
      label: "Courses",
      icon: "📚",
      description: "Course details, schedules, and instructors.",
    },
    {
      id: "assignments",
      kind: "assignments",
      label: "Assignments",
      icon: "📝",
      description: "Coursework, deadlines, weights, and status.",
    },
    {
      id: "planner",
      kind: "planner",
      label: "Planner",
      icon: "🗓️",
      description: "A calendar view of the work ahead.",
    },
  ];

  const optional: Array<{
    words: string[];
    component: GenerationComponent;
  }> = [
    {
      words: ["read", "reading"],
      component: {
        id: "readings",
        kind: "readings",
        label: "Reading List",
        icon: "📖",
        description: "Assigned texts and reading progress.",
      },
    },
    {
      words: ["exam", "final", "midterm"],
      component: {
        id: "exams",
        kind: "exams",
        label: "Exam Prep",
        icon: "🧪",
        description: "Exam dates, topics, and revision tasks.",
      },
    },
    {
      words: ["note"],
      component: {
        id: "notes",
        kind: "notes",
        label: "Notes",
        icon: "🗒️",
        description: "A structured home for course notes.",
      },
    },
    {
      words: ["habit", "routine"],
      component: {
        id: "habits",
        kind: "habits",
        label: "Study Habits",
        icon: "🔥",
        description: "Daily study routines and consistency.",
      },
    },
    {
      words: ["grade", "gpa"],
      component: {
        id: "grades",
        kind: "grades",
        label: "Grade Tracker",
        icon: "💯",
        description: "Scores, weights, and grade targets.",
      },
    },
    {
      words: ["project", "thesis", "capstone"],
      component: {
        id: "projects",
        kind: "projects",
        label: "Projects",
        icon: "🧩",
        description: "Milestones and next actions for larger work.",
      },
    },
  ];

  for (const item of optional) {
    if (item.words.some((word) => source.includes(word))) {
      components.push(item.component);
    }
  }

  if (components.length === 4) {
    components.push(optional[0].component);
  }

  const short = prompt.trim().replace(/\s+/g, " ").slice(0, 120);
  return {
    workspaceName: "Study HQ",
    summary: short
      ? `A tailored workspace built around ${short}.`
      : "A tailored workspace for courses, deadlines, and study planning.",
    components: components.slice(0, 8),
  };
}

// ===========================================================================
// Onboarding questions (asked between the prompt and generation)
// ===========================================================================

/**
 * Ask the model for a few tailored multiple-choice questions about the student.
 * Always resolves (falls back to a static set) so onboarding never dead-ends.
 */
export async function planQuestions(
  prompt: string,
  model: string = DEFAULT_MODEL,
  locale: Locale = DEFAULT_LOCALE,
  sourceText = "",
): Promise<GenQuestion[]> {
  return (await planQuestionsDetailed(prompt, model, locale, sourceText)).questions;
}

/**
 * Like {@link planQuestions}, but also says whether the model wrote the
 * questions (`fromModel`) or the static fallback was used — callers bill only
 * for questions the student actually got from the model.
 */
export async function planQuestionsDetailed(
  prompt: string,
  model: string = DEFAULT_MODEL,
  locale: Locale = DEFAULT_LOCALE,
  sourceText = "",
): Promise<{ questions: GenQuestion[]; fromModel: boolean }> {
  const fallback = () => ({
    questions: defaultQuestions(getDictionary(locale).onboarding),
    fromModel: false,
  });
  if (!isAiConfigured(model)) return fallback();
  try {
    const raw = await callOpenRouter(
      model,
      buildQuestionsSystemPrompt(locale),
      [
        `Student description:\n\n"""${prompt}"""`,
        sourceTextBlock(sourceText.slice(0, QUESTIONS_SOURCE_CHARS)),
        "Return ONLY the JSON object of questions.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      { timeoutMs: SMALL_CALL_TIMEOUT_MS, effort: "low", smallStep: true, maxTokens: SMALL_CALL_MAX_TOKENS },
    ).catch((err: unknown) => {
      // A reply cut off at the token limit still holds its first questions.
      if (err instanceof AiTruncatedError && err.partial) return err.partial;
      throw err;
    });
    // Trimmed and repaired rather than all-or-nothing: one long label must
    // not throw away questions the student is about to answer. A reply cut
    // off mid-object is not JSON: the raw text goes to the tolerant parser,
    // which salvages its complete questions.
    const questions = normalizeGenQuestions(extractJson(raw) ?? raw);
    if (questions.length === 0) {
      reportError(new InvalidOutputError("questions reply has no usable question"), {
        source: "planQuestions",
        status: "unusable reply; using default questions",
      });
      return fallback();
    }
    return { questions, fromModel: true };
  } catch (err) {
    reportError(err, { source: "planQuestions", status: "failed; using default questions" });
    return fallback();
  }
}

function buildQuestionsSystemPrompt(locale: Locale): string {
  return [
    "You are StudyOS's onboarding assistant. Given a student's one-line description, write 3–4 short multiple-choice questions whose answers will help design their ideal study workspace.",
    "Ask about things you genuinely can't infer from the description — e.g. study level, course load, what they want to track, planning style, or exam timeline. Don't ask what they already told you.",
    "Tailor every question to THIS student. Reference their actual field, courses, or year where it reads naturally (a pre-med student gets lab-vs-lecture questions; a law student gets case/reading questions) — questions must never feel generic or randomly chosen.",
    "Only ask a question if its answer would CHANGE what gets built (e.g. group projects → a Projects board; weekly readings → a Reading List). Skip anything that wouldn't affect the workspace.",
    "",
    "RULES:",
    "- 3 to 4 questions. Each question has 2–5 options.",
    `- A question is one short sentence, at most ${QUESTION_LIMITS.questionChars - 40} characters.`,
    `- Option labels are 1–4 words, at most ${QUESTION_LIMITS.labelChars - 15} characters. Give every option exactly one relevant emoji.`,
    '- Use type "multi" only when picking several answers makes sense; otherwise "single".',
    "- Invent short unique string ids for each question and option.",
    "- Output ONLY a JSON object, no prose and no markdown fences, of exactly this shape:",
    '{"questions":[{"id":"level","question":"What\'s your study level?","type":"single","options":[{"id":"ug","label":"Undergrad","emoji":"🎓"}]}]}',
    languageDirective(locale),
  ].join("\n");
}

// ===========================================================================
// Real generation (OpenRouter)
// ===========================================================================

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Anthropic budget for the generation calls. On Anthropic `max_tokens` covers
 * adaptive thinking AND the visible answer (unlike the 10000 below, which GLM
 * spends on the answer alone), so leave room for a full workspace after thinking.
 */
const ANTHROPIC_GENERATION_MAX_TOKENS = 16000;
/**
 * Budget for the plan and questions calls (thinking included). Their JSON is
 * well under 1k tokens; at low effort thinking is a few hundred more.
 */
const SMALL_CALL_MAX_TOKENS = 6000;

/**
 * Thinking effort per step. Choosing components and writing questions are
 * small, well-specified jobs: "low". For the build see BUILD_THINKING.
 */
type StepEffort = "low" | "medium" | "high";

/**
 * How the full build thinks. Measured live on claude-haiku-5-5 (Nov 2026):
 * at the default (medium) effort it thought ~2.9k tokens, ~13 s before the
 * first character of the answer (whole build 27–33 s); at low effort with
 * this prompt it thought more (~4.3k, ~20 s). Without thinking the first
 * character arrives in under 1.5 s and the build takes 8–12 s, with the same
 * structure and no validation failures; the facts it could get wrong
 * (dates, weights, duplicates) are checked deterministically afterwards.
 * The decisions are made by the plan step and spelled out in the prompt.
 */
const BUILD_THINKING: { effort?: StepEffort; noThinking?: boolean } = { noThinking: true };

interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Claude thinking effort (`output_config.effort`). */
  effort?: StepEffort;
  /** A small step (plan, questions): low reasoning effort on OpenRouter too. */
  smallStep?: boolean;
  /** Claude: answer without thinking. */
  noThinking?: boolean;
  /** Output budget on Claude (thinking included). */
  maxTokens?: number;
  /** Streamed answer text, as it arrives (Claude only). */
  onContent?: (delta: string) => void;
}

/**
 * Call the model for one generation step and return the assistant's raw text
 * reply. Throws on transport or API errors. Bare Claude ids go through the
 * shared Anthropic path; everything else hits OpenRouter directly below.
 */
async function callOpenRouter(
  model: string,
  systemPrompt: string,
  userContent: string,
  options: CallOptions = {},
): Promise<string> {
  // Every call is cancellable and time-boxed: a hung upstream must end in an
  // honest error, not a request that outlives the route.
  const signals = [
    AbortSignal.timeout(Math.max(1, options.timeoutMs ?? GENERATION_CALL_TIMEOUT_MS)),
  ];
  if (options.signal) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  if (providerForModel(model) === "anthropic") {
    // Streaming (rather than chatCompletion) because it carries the abort
    // signal; with no reasoning callback the request is otherwise identical.
    return streamChatCompletion(
      model,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      options.maxTokens ?? ANTHROPIC_GENERATION_MAX_TOKENS,
      { signal, effort: options.effort, noThinking: options.noThinking, onContent: options.onContent },
    );
  }
  const res = await fetch(OPENROUTER_URL, {
    signal,
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      // Optional attribution headers OpenRouter uses for its dashboards.
      "HTTP-Referer": "https://studyos.app",
      "X-Title": "StudyOS",
    },
    body: JSON.stringify({
      model,
      // Output budget. GLM returns its reasoning in a separate field, so this
      // is purely the visible answer (a full StudyOS workspace fits here).
      max_tokens: 10000,
      // The build thinks hard (the biggest quality lever on GLM); the small
      // plan and questions steps ask for low effort.
      reasoning: { effort: options.smallStep ? "low" : "high" },
      // Lower temperature = focused and deliberate rather than scattershot
      // (directly reduces "random"-feeling questions and filler content).
      temperature: 0.5,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter request failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  recordUsage(data?.usage, model);
  const choice = data?.choices?.[0];
  const content: unknown = choice?.message?.content;
  // A reply cut off at max_tokens is incomplete JSON: say so (and let the
  // caller retry or fail honestly) instead of parsing half a workspace.
  if (choice?.finish_reason === "length") {
    throw new AiTruncatedError(
      "OpenRouter response was truncated (finish_reason: length)",
      10000,
      typeof content === "string" ? content : "",
    );
  }
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("OpenRouter returned no text content");
  }
  return content;
}

async function openRouterGenerate(
  prompt: string,
  model: string,
  preferences: string,
  plan: WorkspaceGenerationPlan | undefined,
  locale: Locale,
  sourceText: string,
  clock: StudentClock,
  facts: SyllabusFacts,
  evidence: InputEvidence,
  options: GenerateWorkspaceOptions,
  attempt = 1,
): Promise<Workspace> {
  const prefBlock = preferences ? `${preferences}\n\n` : "";
  const sourceBlock = sourceTextBlock(sourceText);
  const factsBlock = syllabusFactsBlock(facts);
  // Said plainly where it applies: models guess dates and weights otherwise.
  const missingBlock = [
    evidence.hasDates
      ? ""
      : "NO DATES GIVEN: the student's input names no specific date. Leave every due date and exam date null — even for something like \"exams in February\" (say \"February\" in a description instead). Put no month or season in any title, and never write that something is near, soon or coming up.",
    evidence.hasWeights
      ? ""
      : "NO WEIGHTS GIVEN: leave every weight % cell null; do not guess how the work is weighted.",
  ]
    .filter(Boolean)
    .map((line) => `${line}\n`)
    .join("");
  const planBlock = plan
    ? [
        "The workspace architect selected this exact component plan:",
        JSON.stringify(plan),
        "Build every planned component and do not add unrelated trackers.",
        "",
      ].join("\n")
    : "";
  const timeoutMs =
    options.deadline !== undefined
      ? Math.min(GENERATION_CALL_TIMEOUT_MS, options.deadline - Date.now())
      : GENERATION_CALL_TIMEOUT_MS;
  // Real progress for the build screen: what the reply contains so far.
  const { onProgress } = options;
  let reported = 0;
  const scanner = onProgress
    ? createWorkspaceStreamScanner((event) => onProgress({ ...event, chars: scanner!.chars, attempt }))
    : undefined;
  const onContent = scanner
    ? (delta: string) => {
        scanner.push(delta);
        if (scanner.chars - reported >= 1_500) {
          reported = scanner.chars;
          onProgress!({ type: "text", chars: scanner.chars, attempt });
        }
      }
    : undefined;

  // The clock goes last: it changes every minute, and keeping it after the
  // long stable system prompt keeps that prefix cacheable.
  const raw = await callOpenRouter(
    model,
    buildSystemPrompt(locale),
    `Design a study workspace for this student:\n\n"""${prompt}"""\n\n${prefBlock}${sourceBlock}${factsBlock}${planBlock}${missingBlock}${clockPromptBlock(clock, "generate")}\n\nHonor the preferences, the provided course material, and the component plan above. Return ONLY the JSON workspace object — no prose, no markdown fences.`,
    { signal: options.signal, timeoutMs, ...BUILD_THINKING, onContent },
  );

  return parseGeneratedWorkspace(raw);
}

/**
 * The workspace in the model's reply. A reply that is valid apart from a
 * few pieces (an unknown block type, an over-long card, a bad cell) is
 * repaired piece by piece with the same tolerant loader stored workspaces
 * use, instead of throwing the whole reply away and paying for a second
 * call. Only a reply with no workspace in it (not JSON, no pages) is
 * rejected.
 */
export function parseGeneratedWorkspace(raw: string): Workspace {
  const value = extractJson(raw);
  const strict = safeParseWorkspace(value);
  if (strict.success) return strict.data;
  const repaired = repairWorkspace(value);
  if (!repaired || repaired.workspace.pages.length === 0) {
    throw new InvalidOutputError(`invalid workspace JSON: ${strict.error.message.slice(0, 300)}`);
  }
  reportError(new Error(`generated workspace repaired: ${repaired.issues.slice(0, 8).join("; ")}`), {
    source: "generateWorkspace",
    status: "repaired",
  });
  return repaired.workspace;
}

/**
 * The example workspace shown to the model: the sample, without what the
 * model should not imitate — a title heading at the top of every page, and a
 * flashcard deck written without any course material behind it.
 */
const PROMPT_EXAMPLE: Workspace = (() => {
  const example = structuredClone(sampleWorkspace);
  example.pages = example.pages
    .filter((page) => !page.blocks.some((block) => block.type === "flashcards"))
    .map((page) => {
      const first = page.blocks[0];
      const repeatsTitle =
        first?.type === "heading" && first.text.trim().toLowerCase() === page.title.trim().toLowerCase();
      return repeatsTitle ? { ...page, blocks: page.blocks.slice(1) } : page;
    });
  return example;
})();

function buildSystemPrompt(locale: Locale): string {
  return [
    "You are StudyOS, an expert at designing beautiful, practical Notion-style study workspaces for students.",
    "Given a short description of a student, you output one complete workspace as a single JSON object.",
    "",
    "OUTPUT RULES:",
    "- Output ONLY the JSON object. No explanation, no markdown code fences.",
    "- The JSON MUST match this shape exactly:",
    "",
    WORKSPACE_SHAPE,
    "",
    "MODELING RULES:",
    '- Every id is a unique short string you invent (e.g. "db-courses", "as-1", "c-name").',
    "- A row's `cells` is keyed by property id. For select/status cells the value is the chosen option's id (NOT its label); for multi_select/relation it is an array of ids; dates are ISO strings like \"2026-09-14\"; checkboxes are booleans; numbers are numbers.",
    "- Every database's first property is a text property holding the row's name (e.g. \"Assignment\", \"Course\").",
    "- Pages display databases via `database_view` blocks referencing a database id + one of its view ids. Define each database once in `databases`; reference its views from pages. Never duplicate data.",
    "- Always include a home page (set `homePageId` to it) that acts as a dashboard: a short welcome callout, then `database_view` blocks for the key trackers. The app adds a \"This week\" list (graded work due in the next 7 days, not done) right under the callout by itself, so do not build your own upcoming or due-soon view, and do not title any other section \"This week\".",
    "- The component plan is authoritative. Build every selected component and avoid unrelated trackers. A component may be represented by a page, database, dashboard section, or a combination.",
    "- Tailor everything to the student's field, explicit courses, answers, and the component plan.",
    "- Give databases useful views: a table, plus a board grouped by a status property and/or a calendar on a date property where it makes sense. Views may carry filters and sorts (see `filters` / `sorts` in the shape), e.g. an exams page showing the graded-work table filtered to Type = Exam.",
    "",
    "TRUTHFULNESS (the student will rely on this workspace):",
    "- Courses, instructors, rooms, weights, topics and dates come only from what the student wrote or their material. Use \"TBD\" for an unknown instructor, room or link.",
    "- Never invent a due date or an exam date. A row gets a date only when the student or their material gives it (resolve relative dates like \"next Friday\" from the current date given with the request); otherwise its date stays null and the student fills it in. Invented deadlines would show up in their calendar and daily plan as real ones.",
    "- Starter rows: one row for every item the student or their material names. Where they named none, add at most two clearly generic example rows per course (e.g. \"Problem Set 1\"), without a date.",
    "- Every row in a database with a status property has a status: work their material says is done, handed in or graded gets the done option; everything else the first (not started) option. Never mark a row in progress (or a topic practised) unless the student said so about that item.",
    "",
    "GRADED WORK AND GRADES:",
    "- All graded work — homework, problem sets, quizzes, labs, papers, projects, midterms AND exams — lives in ONE graded-work database, with a select property for the type (Homework, Quiz, Exam, …), a number property for the weight (percent of the final grade, e.g. \"Weight %\") and a date property for the due date. Never put exams, projects or grades in a separate database; a planned exams or projects component is a page that shows a view of this database.",
    "- Every graded item from the student's material gets exactly one row with its real weight and date; never drop or change a stated weight, and never add a second row for the same item.",
    "- A weight shared by a GROUP of items (\"Problem sets 20%\", \"Weekly homework 30%, lowest dropped\", \"Quizzes 10%\") is a grading category, never a row: put it in the graded-work database's `grading.categories` as {id, course: <the course option id>, name, weight, dropLowest?, expectedCount?}, and give the group's single items (\"Problem Set 4\", \"Quiz 2\") rows WITHOUT a weight. A weight for ONE item (\"Midterm 25%\") goes on that item's row.",
    "- That database also has a number property for the score the student received (e.g. \"Score\"; a percentage, or points when there is also an \"Out of\" number property). Leave it null for work not graded yet; never invent scores.",
    "- Grades are shown with a `grades` block (a live calculator: current grade per course, what is needed on the rest for a target, what-if) on the dashboard or on a grades page — never a separate grade or \"Grade Tracker\" table. Point its `databaseId` at the graded-work database and its `columns` at that database's property ids. Pick `scale` from where the student studies: \"us_letter\" or \"us_gpa\" (USA), \"uk_degree\" (UK), \"de_grade\" (Germany), otherwise \"percent\".",
    "",
    "STUDY MATERIAL:",
    "- Add a small starter `flashcards` deck (5–8 cards) or a short `quiz` (3–5 questions) only when the student's description or material contains real course content to base it on: listed topics, definitions, readings, lecture notes. Build every card and question from that content, put it on the page of its course, and title it after the topic. Never present invented facts as the student's course material; with no such content, add no deck and no quiz.",
    "",
    "WRITING:",
    "- Dates in text (callouts, paragraphs, to-dos, cards, questions) are written the natural way in the student's language — \"December 3\", \"3. Dezember\", \"3 de diciembre\", \"12月3日\" — never as 2026-12-03. Date cells stay ISO.",
    "- A page's title is already shown above its blocks: never start a page with a heading that repeats the title.",
    "- Keep text short: a callout is one or two sentences; a paragraph at most three.",
    "- Every page and database gets one fitting emoji icon (🧪 for a lab notebook, ⚖️ for case briefs, 📐 for a math course); two pages never share an icon.",
    "- Valid `color` values: zinc, red, rose, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink.",
    "",
    "Here is a complete, high-quality example for a CS student who pasted their syllabus. Match this structure and quality, but adapt all content to the new student. Its dates are placeholders from an old term — never copy them; derive every date from the student's own material and the current date given with the request:",
    "",
    JSON.stringify(PROMPT_EXAMPLE),
    languageDirective(locale),
  ].join("\n");
}

export const WORKSPACE_SHAPE = `Workspace = {
  id: string; name: string; icon?: string; homePageId?: string;
  databases: Database[]; pages: Page[];
}
Database = {
  id: string; name: string; icon?: string; description?: string;
  properties: { id: string; name: string;
    type: "text"|"number"|"checkbox"|"date"|"select"|"multi_select"|"status"|"url"|"relation";
    options?: { id: string; label: string; color?: string }[]; relationDatabaseId?: string }[];
  rows: { id: string; cells: { [propertyId: string]: string|number|boolean|string[]|null } }[];
  views: { id: string; name: string; type: "table"|"board"|"calendar"|"list"|"gallery";
    groupByPropertyId?: string; datePropertyId?: string; visiblePropertyIds?: string[];
    sorts?: { propertyId: string; direction: "asc"|"desc" }[];
    filters?: { propertyId: string; operator: string; value?: string|number|boolean|string[] }[]; filterMatch?: "all"|"any" }[];  // e.g. a select filter {"propertyId":"a-type","operator":"is","value":"ty-exam"}
  grading?: { categories: { id: string; course: string; name: string; weight: number; dropLowest?: number; expectedCount?: number }[] };  // graded-work database only: weights shared by many items ("Problem sets 20%"); course = the course option id ("*" when there is no course column); items count in a category by their type/title; never a row for a category
}
Page = { id: string; title: string; icon?: string; blocks: Block[] }
Block = one of:
  { id; type:"heading"; level:1|2|3; text }
  { id; type:"paragraph"; text }
  { id; type:"todo"; text; checked:boolean }
  { id; type:"bulleted_list_item"; text }
  { id; type:"numbered_list_item"; text }
  { id; type:"quote"; text }
  { id; type:"callout"; text; emoji? }
  { id; type:"divider" }
  { id; type:"database_view"; databaseId; viewId }
  { id; type:"flashcards"; title?; cards: { id; front; back }[] }  // spaced-repetition deck; omit scheduling fields on new cards
  { id; type:"quiz"; title?; questions: { id; kind:"mcq"|"true_false"|"short"; prompt; choices?: string[]; answerIndex?: number; answerBool?: boolean; answerText?: string; explanation?; topic? }[] }  // practice quiz/exam; mcq: 2-6 choices + 0-based answerIndex; true_false: answerBool; short: model answerText; Markdown + $math$ allowed; never write stats or attempts (keep existing ones)
  { id; type:"grades"; title?; databaseId; columns?: { course?; score?; maxScore?; weight?; due? }; scale?: "percent"|"us_letter"|"us_gpa"|"uk_degree"|"de_grade"; defaultTarget?: number; targets?: { [courseKey]: number } }  // live grade calculator over the graded-work database; columns are property ids of that database (course: select/relation/text, score/maxScore/weight: number, due: date), omitted ones are detected; targets are percentages keyed by course option id; the agent can add or reconfigure one with {"op":"set_grades_block","pageId","block","afterBlockId"?,"categories"?,"assign"?} (categories: weights many items share, kept in the graded-work database's grading.categories)`;

/**
 * Pull the JSON object out of the model's reply, tolerating fences or stray
 * prose — without ever throwing.
 *
 * Order matters: parse the whole trimmed reply FIRST. The requested output is
 * pure JSON, and a direct parse is the only branch that correctly preserves
 * ``` fences and `{ }` braces living INSIDE string values (e.g. a mermaid
 * diagram). Stripping an "inner" fence or slicing on a raw brace corrupts such
 * a reply — that is exactly why agent turns that added a mermaid/code block
 * failed with a raw `SyntaxError`. We only fall back to fence-unwrapping and
 * balanced-object extraction when the reply is genuinely wrapped in prose or a
 * code fence. On total failure we return `null` so callers' `safeParse(...)`
 * treats it as invalid input instead of a raw SyntaxError crashing the request.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1) Pure JSON (the requested format) — preserves ``` and `{ }` inside strings.
  const direct = tryParseJson(trimmed);
  if (direct.ok) return direct.value;

  // 2) The whole reply wrapped in a ```json … ``` fence.
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i);
  if (fenced) {
    const inner = tryParseJson(fenced[1].trim());
    if (inner.ok) return inner.value;
  }

  // 3) JSON embedded in prose: take the first BALANCED top-level object,
  //    scanning past string literals so a `}` inside a string can't end it early.
  const candidate = firstBalancedJsonObject(trimmed);
  if (candidate) {
    const obj = tryParseJson(candidate);
    if (obj.ok) return obj.value;
  }

  return null;
}

function tryParseJson(
  s: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
}

/**
 * The first balanced `{ … }` object in `text`, ignoring braces that appear
 * inside JSON string literals (so a `}` inside a mermaid/code string does not
 * prematurely close the object). Returns null if no balanced object exists.
 */
function firstBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ===========================================================================
// Mock generator (no API key required)
// ===========================================================================

const ACCENTS = [
  "blue",
  "violet",
  "indigo",
  "amber",
  "rose",
  "emerald",
  "sky",
  "pink",
];

const SCHEDULES = [
  "Mon / Wed · 10:00",
  "Tue / Thu · 13:00",
  "Mon / Wed · 14:00",
  "Fri · 11:00",
  "Tue / Thu · 09:00",
  "Wed · 15:00",
];

const FIELDS: { keys: string[]; label: string; courses: string[] }[] = [
  {
    keys: ["computer science", "comp sci", "cs", "software", "programming", "coding"],
    label: "CS",
    courses: [
      "Intro to Computer Science",
      "Data Structures",
      "Discrete Mathematics",
      "Calculus II",
      "Academic Writing",
    ],
  },
  {
    keys: ["pre-med", "premed", "medicine", "medical", "nursing", "anatomy"],
    label: "Pre-Med",
    courses: [
      "Human Anatomy",
      "Biochemistry",
      "Physiology",
      "Organic Chemistry",
      "Medical Ethics",
    ],
  },
  {
    keys: ["law", "legal", "llb", "ll.b"],
    label: "Law",
    courses: [
      "Constitutional Law",
      "Contracts",
      "Torts",
      "Criminal Law",
      "Legal Writing",
    ],
  },
  {
    keys: ["business", "mba", "finance", "accounting", "marketing", "economics", "commerce"],
    label: "Business",
    courses: [
      "Microeconomics",
      "Financial Accounting",
      "Marketing Principles",
      "Business Statistics",
      "Operations Management",
    ],
  },
  {
    keys: ["psychology", "psych"],
    label: "Psychology",
    courses: [
      "Intro to Psychology",
      "Cognitive Psychology",
      "Statistics for Psychology",
      "Research Methods",
      "Developmental Psychology",
    ],
  },
  {
    keys: ["high school", "highschool", "gcse", "a-level", "a level", "secondary"],
    label: "High School",
    courses: [
      "Mathematics",
      "English Literature",
      "Biology",
      "World History",
      "Physics",
    ],
  },
];

async function mockGenerate(
  prompt: string,
  plan: WorkspaceGenerationPlan | undefined,
  preferences: string,
  clock: StudentClock,
): Promise<Workspace> {
  const isoPlusDays = (days: number) => addDaysIso(clock.date, days);
  // Mock-only: a brief pause so the "Generating…" state is visible.
  // The real Claude call has its own latency, so this line just goes away.
  await new Promise((resolve) => setTimeout(resolve, 700));

  const selectedPlan = plan ?? mockWorkspacePlan(prompt, preferences);
  const has = (kind: GenerationComponent["kind"]) =>
    selectedPlan.components.some((component) => component.kind === kind);
  const lower = prompt.toLowerCase();
  const field = FIELDS.find((f) => f.keys.some((k) => includesWord(lower, k)));
  const courseNames = extractCourses(prompt, field);

  let counter = 0;
  const uid = (p: string) => `${p}-${++counter}`;

  const courses = courseNames.map((name, i) => ({
    name,
    code: courseCode(name, i),
    accent: ACCENTS[i % ACCENTS.length],
    optId: uid("co"),
    readOptId: uid("rc"),
    rowId: uid("course"),
  }));

  // ----- Courses database -----
  const coursesDb: Database = {
    id: "db-courses",
    name: "Courses",
    icon: "📚",
    description: "Every class you're taking this term.",
    properties: [
      { id: "c-name", name: "Course", type: "text" },
      { id: "c-code", name: "Code", type: "text" },
      { id: "c-instructor", name: "Instructor", type: "text" },
      { id: "c-credits", name: "Credits", type: "number" },
      { id: "c-schedule", name: "Schedule", type: "text" },
    ],
    views: [{ id: "v-courses-table", name: "All courses", type: "table" }],
    rows: courses.map((c, i) => ({
      id: c.rowId,
      cells: {
        "c-name": c.name,
        "c-code": c.code,
        "c-instructor": "TBD",
        "c-credits": 3 + (i % 2),
        "c-schedule": SCHEDULES[i % SCHEDULES.length],
      },
    })),
  };

  // ----- Assignments database -----
  const statusOptions: SelectOption[] = [
    { id: "st-todo", label: "Not started", color: "zinc" },
    { id: "st-doing", label: "In progress", color: "amber" },
    { id: "st-done", label: "Done", color: "green" },
  ];
  const typeOptions: SelectOption[] = [
    { id: "ty-hw", label: "Homework", color: "sky" },
    { id: "ty-quiz", label: "Quiz", color: "violet" },
    { id: "ty-exam", label: "Exam", color: "rose" },
    { id: "ty-project", label: "Project", color: "emerald" },
  ];
  const courseOptions: SelectOption[] = courses.map((c) => ({
    id: c.optId,
    label: c.code,
    color: c.accent,
  }));

  const titles = [
    "Problem Set",
    "Quiz",
    "Reading Response",
    "Project Milestone",
    "Lab Report",
    "Essay Draft",
    "Midterm",
    "Final Project",
  ];

  const assignmentRows: DatabaseRow[] = [];
  let dueOffset = 2;
  courses.forEach((c, ci) => {
    for (let k = 0; k < 2; k++) {
      const idx = ci * 2 + k;
      assignmentRows.push({
        id: uid("as"),
        cells: {
          "a-name": `${titles[idx % titles.length]} — ${c.code}`,
          "a-course": c.optId,
          "a-type": typeOptions[idx % typeOptions.length].id,
          "a-status": statusOptions[idx % statusOptions.length].id,
          "a-due": isoPlusDays(dueOffset),
          "a-weight": 5 + (idx % 5) * 5,
        },
      });
      dueOffset += 3;
    }
  });
  if (has("exams")) {
    courses.slice(0, 4).forEach((course, index) => {
      assignmentRows.push({
        id: uid("exam"),
        cells: {
          "a-name": `${index % 2 === 0 ? "Midterm" : "Final"} — ${course.code}`,
          "a-course": course.optId,
          "a-type": "ty-exam",
          "a-status": "st-todo",
          "a-due": isoPlusDays(14 + index * 7),
          "a-weight": 25 + (index % 2) * 15,
        },
      });
    });
  }
  if (has("projects")) {
    courses.slice(0, 3).forEach((course, index) => {
      assignmentRows.push({
        id: uid("project"),
        cells: {
          "a-name": `Project milestone ${index + 1} — ${course.code}`,
          "a-course": course.optId,
          "a-type": "ty-project",
          "a-status": index === 0 ? "st-doing" : "st-todo",
          "a-due": isoPlusDays(10 + index * 9),
          "a-weight": 20,
        },
      });
    });
  }

  const assignmentsDb: Database = {
    id: "db-assignments",
    name: "Assignments",
    icon: "📝",
    description: "Homework, quizzes, projects and exams.",
    properties: [
      { id: "a-name", name: "Assignment", type: "text" },
      { id: "a-course", name: "Course", type: "select", options: courseOptions },
      { id: "a-type", name: "Type", type: "select", options: typeOptions },
      { id: "a-status", name: "Status", type: "status", options: statusOptions },
      { id: "a-due", name: "Due", type: "date" },
      { id: "a-weight", name: "Weight %", type: "number" },
      { id: "a-score", name: "Score", type: "number" },
    ],
    views: [
      { id: "v-assign-table", name: "All", type: "table" },
      {
        id: "v-assign-board",
        name: "By status",
        type: "board",
        groupByPropertyId: "a-status",
      },
      {
        id: "v-assign-cal",
        name: "Calendar",
        type: "calendar",
        datePropertyId: "a-due",
      },
    ],
    rows: assignmentRows,
  };

  // ----- Reading list database -----
  const readingCourseOptions: SelectOption[] = courses.map((c) => ({
    id: c.readOptId,
    label: c.code,
    color: c.accent,
  }));
  const readingsDb: Database = {
    id: "db-readings",
    name: "Reading List",
    icon: "📖",
    description: "What to read, organised by course.",
    properties: [
      { id: "r-title", name: "Title", type: "text" },
      { id: "r-course", name: "Course", type: "select", options: readingCourseOptions },
      { id: "r-done", name: "Read", type: "checkbox" },
      { id: "r-link", name: "Link", type: "url" },
    ],
    views: [{ id: "v-readings-table", name: "Reading list", type: "table" }],
    rows: courses.map((c, i) => ({
      id: uid("rd"),
      cells: {
        "r-title": `${c.name}: core reading`,
        "r-course": c.readOptId,
        "r-done": i % 3 === 0,
        "r-link": null,
      },
    })),
  };

  const habitsDb: Database = {
    id: "db-habits",
    name: "Study Habits",
    icon: "🔥",
    description: "A lightweight weekly consistency tracker.",
    properties: [
      { id: "h-name", name: "Habit", type: "text" },
      { id: "h-date", name: "Date", type: "date" },
      { id: "h-done", name: "Done", type: "checkbox" },
      { id: "h-minutes", name: "Minutes", type: "number" },
    ],
    views: [
      { id: "v-habits-table", name: "All habits", type: "table" },
      {
        id: "v-habits-calendar",
        name: "Calendar",
        type: "calendar",
        datePropertyId: "h-date",
      },
    ],
    rows: [
      {
        id: uid("habit"),
        cells: {
          "h-name": "Review today's notes",
          "h-date": isoPlusDays(0),
          "h-done": false,
          "h-minutes": 25,
        },
      },
      {
        id: uid("habit"),
        cells: {
          "h-name": "Practice recall",
          "h-date": isoPlusDays(1),
          "h-done": false,
          "h-minutes": 20,
        },
      },
    ],
  };

  // ----- Pages -----
  const summary = prompt.trim().replace(/\s+/g, " ").slice(0, 140);
  const dashboardBlocks: Block[] = [
    {
      id: "b-welcome",
      type: "callout",
      emoji: "✨",
      text: `Generated from your description: “${summary}”. Everything here is a starting point you can edit.`,
    },
  ];
  if (has("assignments")) {
    dashboardBlocks.push(
      {
        id: "b-h1",
        type: "heading",
        level: 2,
        text: "📌 Assignments by status",
      },
      {
        id: "b-board",
        type: "database_view",
        databaseId: "db-assignments",
        viewId: "v-assign-board",
      },
    );
  }
  dashboardBlocks.push(
    { id: "b-h2", type: "heading", level: 2, text: "📚 My courses" },
    {
      id: "b-courses",
      type: "database_view",
      databaseId: "db-courses",
      viewId: "v-courses-table",
    },
  );

  const pages: Page[] = [
    {
      id: "page-home",
      title: "Dashboard",
      icon: "🏠",
      blocks: dashboardBlocks,
    },
    {
      id: "page-courses",
      title: "Courses",
      icon: "📚",
      blocks: [
        { id: "pc-h", type: "heading", level: 1, text: "Courses" },
        {
          id: "pc-t",
          type: "database_view",
          databaseId: "db-courses",
          viewId: "v-courses-table",
        },
      ] satisfies Block[],
    },
  ];

  if (has("assignments")) {
    pages.push({
      id: "page-assignments",
      title: "Assignments",
      icon: "📝",
      blocks: [
        { id: "pa-h", type: "heading", level: 1, text: "Assignments" },
        {
          id: "pa-p",
          type: "paragraph",
          text: "Everything you owe, with due dates and weights.",
        },
        {
          id: "pa-t",
          type: "database_view",
          databaseId: "db-assignments",
          viewId: "v-assign-table",
        },
      ],
    });
  }

  if (has("planner")) {
    pages.push({
      id: "page-planner",
      title: "Planner",
      icon: "🗓️",
      blocks: [
        { id: "pp-h", type: "heading", level: 1, text: "Planner" },
        {
          id: "pp-p",
          type: "paragraph",
          text: "Your deadlines laid out on a calendar.",
        },
        {
          id: "pp-c",
          type: "database_view",
          databaseId: "db-assignments",
          viewId: "v-assign-cal",
        },
      ],
    });
  }

  if (has("readings")) {
    pages.push({
      id: "page-readings",
      title: "Reading List",
      icon: "📖",
      blocks: [
        { id: "pr-h", type: "heading", level: 1, text: "Reading List" },
        {
          id: "pr-t",
          type: "database_view",
          databaseId: "db-readings",
          viewId: "v-readings-table",
        },
      ],
    });
  }

  if (has("exams")) {
    pages.push({
      id: "page-exams",
      title: "Exam Prep",
      icon: "🧪",
      blocks: [
        { id: "pe-h", type: "heading", level: 1, text: "Exam Prep" },
        {
          id: "pe-callout",
          type: "callout",
          emoji: "🎯",
          text: "Confirm the dates, then break each exam into revision topics and practice sessions.",
        },
        {
          id: "pe-board",
          type: "database_view",
          databaseId: "db-assignments",
          viewId: "v-assign-board",
        },
      ],
    });
  }

  if (has("notes")) {
    pages.push({
      id: "page-notes",
      title: "Notes",
      icon: "🗒️",
      blocks: [
        { id: "pn-h", type: "heading", level: 1, text: "Course Notes" },
        {
          id: "pn-callout",
          type: "callout",
          emoji: "💡",
          text: "Add a heading for each lecture, then capture key ideas and questions underneath.",
        },
        { id: "pn-course", type: "heading", level: 2, text: courses[0]?.name ?? "Course" },
        { id: "pn-text", type: "paragraph", text: "Start writing here…" },
      ],
    });
  }

  if (has("habits")) {
    pages.push({
      id: "page-habits",
      title: "Study Habits",
      icon: "🔥",
      blocks: [
        { id: "ph-h", type: "heading", level: 1, text: "Study Habits" },
        {
          id: "ph-table",
          type: "database_view",
          databaseId: "db-habits",
          viewId: "v-habits-table",
        },
      ],
    });
  }

  if (has("grades")) {
    pages.push({
      id: "page-grades",
      title: "Grade Tracker",
      icon: "💯",
      blocks: [
        { id: "pg-h", type: "heading", level: 1, text: "Grade Tracker" },
        {
          id: "pg-callout",
          type: "callout",
          emoji: "✎",
          text: "Check the weights against your syllabus, then type each score as it comes back.",
        },
        {
          id: "pg-grades",
          type: "grades",
          title: "Grades",
          databaseId: "db-assignments",
          columns: { course: "a-course", score: "a-score", weight: "a-weight", due: "a-due" },
        },
      ],
    });
  }

  const databases = [coursesDb];
  // Grades are scores on the assignments themselves: one list, never a copy.
  if (has("assignments") || has("planner") || has("exams") || has("projects") || has("grades")) {
    databases.push(assignmentsDb);
  }
  if (has("readings")) databases.push(readingsDb);
  if (has("habits")) databases.push(habitsDb);

  return {
    id: "ws-generated",
    name:
      selectedPlan.workspaceName ||
      `${field ? field.label + " " : ""}Study HQ`,
    icon: "🎓",
    homePageId: "page-home",
    databases,
    pages,
  };
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

/** Match a keyword on word boundaries so "cs" doesn't fire inside "physics". */
function includesWord(haystack: string, needle: string): boolean {
  if (needle.includes(" ")) return haystack.includes(needle);
  return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(
    haystack,
  );
}

function extractCourses(
  prompt: string,
  field?: { courses: string[] },
): string[] {
  const lower = prompt.toLowerCase();
  const triggers = [
    "taking",
    "studying",
    "enrolled in",
    "courses",
    "classes",
    "subjects",
    "modules",
  ];

  // 1) An explicit list after a trigger word, e.g. "taking Anatomy, Biochem and Physiology".
  for (const t of triggers) {
    const idx = lower.indexOf(t);
    if (idx === -1) continue;
    let seg = prompt.slice(idx + t.length).split(/[.\n]/)[0];
    seg = seg.replace(/^[:\s]*(like|such as|including|are|is|:)?\s*/i, "");
    const parts = seg
      .split(/,| and | & |\/|;/i)
      .map(cleanCourse)
      .filter((p) => p.length >= 2 && p.split(" ").length <= 5);
    if (parts.length >= 2) return dedupe(parts).slice(0, 6);
  }

  // 1b) A colon-introduced list, e.g. "Pre-med sophomore: Anatomy, Biochem, Physiology".
  const colon = prompt.indexOf(":");
  if (colon !== -1) {
    const seg = prompt.slice(colon + 1).split(/[.\n]/)[0];
    const parts = seg
      .split(/,| and | & |\/|;/i)
      .map(cleanCourse)
      .filter((p) => p.length >= 2 && p.split(" ").length <= 5);
    if (parts.length >= 2) return dedupe(parts).slice(0, 6);
  }

  // 2) An explicit count, e.g. "5 courses".
  const base = field?.courses ?? [
    "Mathematics",
    "Academic Writing",
    "Science",
    "History",
    "Elective",
  ];
  const num = lower.match(/(\d+)\s*(courses|classes|subjects|modules)/);
  if (num) {
    const count = Math.min(8, Math.max(1, parseInt(num[1], 10)));
    const out = [...base];
    while (out.length < count) out.push(`Elective ${out.length - base.length + 1}`);
    return out.slice(0, count);
  }

  // 3) Field default (or generic).
  return base.slice(0, 5);
}

function cleanCourse(s: string): string {
  let c = s
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\b(this (semester|term|year)|currently|right now)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (c && c === c.toLowerCase()) c = c.replace(/\b\w/g, (m) => m.toUpperCase());
  return c;
}

function courseCode(name: string, i: number): string {
  const words = name.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  const letters = words.map((w) => w[0]).join("").slice(0, 3).toUpperCase();
  return `${letters || "CRS"} ${101 + i * 100}`;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
