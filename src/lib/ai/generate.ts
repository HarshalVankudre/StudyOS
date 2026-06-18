/**
 * StudyOS — Workspace generator.
 *
 * This is THE BOUNDARY between the app and the AI. Everything upstream just
 * calls `generateWorkspace(prompt)` and gets back a Workspace to render/save.
 *
 * Right now it uses a local, rule-based MOCK so the whole experience works with
 * no API key. When you add an OpenRouter API key, we replace `mockGenerate`
 * with a real model call here — and nothing else in the app has to change.
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
import { sampleWorkspace } from "@/lib/workspace/sample";
import { modelForPlan } from "./plans";
import { recordUsage } from "./usage-meter";
import { defaultQuestions, type GenQuestion } from "./onboarding";
import {
  GENERATION_COMPONENT_KINDS,
  type GenerationComponent,
  type WorkspaceGenerationPlan,
} from "./generation-progress";
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
  if (locale === DEFAULT_LOCALE) return "";
  const language = englishName(locale);
  return [
    "",
    "LANGUAGE:",
    `- Write ALL user-facing text in ${language}: workspace name, page titles, database names and descriptions, property names, select/status option labels, row text content, headings, callouts, replies, questions, and choice labels.`,
    "- Do NOT translate or change JSON keys, ids, or the literal enum values for `type`, `kind`, and `color`. Keep all dates in ISO format (YYYY-MM-DD).",
  ].join("\n");
}

export async function generateWorkspace(
  prompt: string,
  model: string = DEFAULT_MODEL,
  preferences = "",
  plan?: WorkspaceGenerationPlan,
  locale: Locale = DEFAULT_LOCALE,
): Promise<Workspace> {
  // Use the real model when an API key is configured; otherwise the local mock.
  // If the real call fails for any reason (bad key, rate limit, malformed
  // output), fall back to the mock so the user always gets a usable workspace.
  if (process.env.OPENROUTER_API_KEY) {
    try {
      return await openRouterGenerate(prompt, model, preferences, plan, locale);
    } catch (err) {
      console.error("[StudyOS] OpenRouter generation failed; using mock:", err);
      return mockGenerate(prompt, plan, preferences);
    }
  }
  return mockGenerate(prompt, plan, preferences);
}

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
): Promise<WorkspaceGenerationPlan> {
  if (!process.env.OPENROUTER_API_KEY) {
    return mockWorkspacePlan(prompt, preferences);
  }

  try {
    const raw = await callOpenRouter(
      model,
      buildWorkspacePlanSystemPrompt(locale),
      [
        `Student description:\n"""${prompt}"""`,
        preferences,
        "Return only the JSON workspace plan.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    const parsed = generationPlanSchema.safeParse(extractJson(raw));
    if (!parsed.success) throw parsed.error;
    return normalizeWorkspacePlan(parsed.data);
  } catch (err) {
    console.error("[StudyOS] workspace planning failed; using fallback:", err);
    return mockWorkspacePlan(prompt, preferences);
  }
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
    "- Personalize every component to the student's actual subject — labels, icons and descriptions should fit their field (e.g. 'Lab Notebook' 🧪 for chemistry, 'Case Briefs' ⚖️ for law, 'Problem Sets' ✏️ for math), never generic placeholders.",
    "- Map their answers directly to components: whatever they say they want to track or struggle with should each surface as a relevant page or tracker.",
    "- Use 4–8 components total. Keep labels short and student-friendly.",
    "- Every component id must be a unique lowercase kebab-case string.",
    `- kind must be one of: ${GENERATION_COMPONENT_KINDS.join(", ")}.`,
    "- Output only JSON with this exact shape:",
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

const genQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        type: z.enum(["single", "multi"]),
        options: z
          .array(
            z.object({
              id: z.string(),
              label: z.string(),
              emoji: z.string().optional(),
            }),
          )
          .min(2),
      }),
    )
    .min(1),
});

/**
 * Ask the model for a few tailored multiple-choice questions about the student.
 * Always resolves (falls back to a static set) so onboarding never dead-ends.
 */
export async function planQuestions(
  prompt: string,
  model: string = DEFAULT_MODEL,
  locale: Locale = DEFAULT_LOCALE,
): Promise<GenQuestion[]> {
  const fallback = () => defaultQuestions(getDictionary(locale).onboarding);
  if (!process.env.OPENROUTER_API_KEY) return fallback();
  try {
    const raw = await callOpenRouter(
      model,
      buildQuestionsSystemPrompt(locale),
      `Student description:\n\n"""${prompt}"""\n\nReturn ONLY the JSON object of questions.`,
    );
    const parsed = genQuestionsSchema.safeParse(extractJson(raw));
    if (!parsed.success || parsed.data.questions.length === 0) {
      return fallback();
    }
    // Keep it digestible: at most 4 questions, 6 options each.
    return parsed.data.questions.slice(0, 4).map((q) => ({
      ...q,
      options: q.options.slice(0, 6),
    }));
  } catch (err) {
    console.error("[StudyOS] question planning failed; using defaults:", err);
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
    "- Option labels are 1–4 words. Give every option a single relevant emoji.",
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
 * Call OpenRouter's (OpenAI-compatible) chat completions endpoint and return
 * the assistant's raw text reply. Throws on transport or API errors.
 */
async function callOpenRouter(
  model: string,
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
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
      // Think hard before answering. This is the single biggest lever on
      // quality — it's what turns generic, templated output into genuinely
      // tailored questions, component choices, and content for THIS student.
      reasoning: { effort: "high" },
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
  recordUsage(data?.usage);
  const content: unknown = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenRouter returned no text content");
  }
  return content;
}

async function openRouterGenerate(
  prompt: string,
  model: string,
  preferences = "",
  plan?: WorkspaceGenerationPlan,
  locale: Locale = DEFAULT_LOCALE,
): Promise<Workspace> {
  const prefBlock = preferences ? `${preferences}\n\n` : "";
  const planBlock = plan
    ? [
        "The workspace architect selected this exact component plan:",
        JSON.stringify(plan),
        "Build every planned component and do not add unrelated trackers.",
        "",
      ].join("\n")
    : "";
  const raw = await callOpenRouter(
    model,
    buildSystemPrompt(locale),
    `Design a study workspace for this student:\n\n"""${prompt}"""\n\n${prefBlock}${planBlock}Honor the preferences and component plan above. Return ONLY the JSON workspace object — no prose, no markdown fences.`,
  );

  const parsed = safeParseWorkspace(extractJson(raw));
  if (!parsed.success) {
    throw new Error(`invalid workspace JSON: ${parsed.error.message}`);
  }
  return parsed.data;
}

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
    "- Pages display databases via `database_view` blocks referencing a database id + one of its view ids. Define each database once in `databases`; reference its views from pages. Never duplicate data.",
    "- Always include a home page (set `homePageId` to it) that acts as a dashboard: a welcome callout, then `database_view` blocks for the key trackers.",
    "- Tailor everything to the student's field, explicit courses, answers, and supplied component plan. Generate realistic starter data for every selected component: courses, schedules, assignments, exams, readings, grades, projects, habits, or notes as applicable.",
    "- Do not claim invented facts are confirmed. Use TBD for unknown instructors, rooms, links, or exact dates; use sensible near-future starter dates only where a useful editable example is needed.",
    "- The component plan is authoritative. Build every selected component and avoid unrelated trackers. A component may be represented by a page, database, dashboard section, or a combination.",
    "- Give databases useful views: a table, plus a board grouped by a status property and/or a calendar on a date property where it makes sense.",
    "- Use emoji icons for the workspace, pages, and databases.",
    "- Valid `color` values: zinc, red, rose, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink.",
    "",
    "Here is a complete, high-quality example for a CS student. Match this structure and quality, but adapt all content to the new student:",
    "",
    JSON.stringify(sampleWorkspace),
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
    groupByPropertyId?: string; datePropertyId?: string; visiblePropertyIds?: string[] }[];
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
  { id; type:"database_view"; databaseId; viewId }`;

/** Pull the JSON object out of the model's reply, tolerating fences or stray prose. */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

// ===========================================================================
// AI editing of an existing workspace
// ===========================================================================

/** Apply a natural-language instruction to an existing workspace via OpenRouter. */
export async function editWorkspace(
  current: Workspace,
  instruction: string,
  model: string = DEFAULT_MODEL,
  locale: Locale = DEFAULT_LOCALE,
): Promise<Workspace> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "AI editing needs an OpenRouter API key (add OPENROUTER_API_KEY to .env.local).",
    );
  }

  const raw = await callOpenRouter(
    model,
    buildEditSystemPrompt(locale),
    `Current workspace JSON:\n\n${JSON.stringify(current)}\n\nApply this change: "${instruction}"\n\nReturn the COMPLETE updated workspace as JSON only — no prose, no fences.`,
  );

  const parsed = safeParseWorkspace(extractJson(raw));
  if (!parsed.success) {
    throw new Error(`invalid workspace JSON: ${parsed.error.message}`);
  }
  return parsed.data;
}

function buildEditSystemPrompt(locale: Locale): string {
  return [
    "You edit an existing StudyOS study workspace. Given the current workspace as JSON and an instruction, you return the COMPLETE updated workspace as a single JSON object.",
    "",
    "OUTPUT RULES:",
    "- Output ONLY the full updated JSON object. No explanation, no markdown fences.",
    "- Keep this exact shape:",
    "",
    WORKSPACE_SHAPE,
    "",
    "EDITING RULES:",
    "- Preserve everything the instruction does NOT touch — keep existing ids, pages, databases, rows, properties and values intact.",
    "- Only add, change, or remove what the instruction asks for.",
    "- Invent new unique string ids for anything new. Keep `cells` keyed by property id; select/status values are option ids; multi_select/relation are arrays of ids; dates are ISO strings; checkboxes are booleans; numbers are numbers.",
    "- If you add a database, also add a `database_view` block on a relevant page so it's visible. If you add a page, give it an emoji icon and useful blocks.",
    "- Valid `color` values: zinc, red, rose, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink.",
    "- Keep `homePageId` pointing to an existing page.",
    languageDirective(locale),
  ].join("\n");
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
  plan?: WorkspaceGenerationPlan,
  preferences = "",
): Promise<Workspace> {
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

  const gradesDb: Database = {
    id: "db-grades",
    name: "Grade Tracker",
    icon: "💯",
    description: "Editable scores and weights for each course.",
    properties: [
      { id: "g-item", name: "Assessment", type: "text" },
      { id: "g-course", name: "Course", type: "select", options: courseOptions },
      { id: "g-score", name: "Score", type: "number" },
      { id: "g-out-of", name: "Out of", type: "number" },
      { id: "g-weight", name: "Weight %", type: "number" },
    ],
    views: [{ id: "v-grades-table", name: "All grades", type: "table" }],
    rows: courses.slice(0, 4).map((course, index) => ({
      id: uid("grade"),
      cells: {
        "g-item": `Assessment ${index + 1}`,
        "g-course": course.optId,
        "g-score": null,
        "g-out-of": 100,
        "g-weight": 10 + index * 5,
      },
    })),
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
          text: "Replace the starter assessments with your syllabus weights and actual results.",
        },
        {
          id: "pg-table",
          type: "database_view",
          databaseId: "db-grades",
          viewId: "v-grades-table",
        },
      ],
    });
  }

  const databases = [coursesDb];
  if (has("assignments") || has("planner") || has("exams") || has("projects")) {
    databases.push(assignmentsDb);
  }
  if (has("readings")) databases.push(readingsDb);
  if (has("habits")) databases.push(habitsDb);
  if (has("grades")) databases.push(gradesDb);

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

function isoPlusDays(n: number): string {
  const t = new Date();
  const d = new Date(
    Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + n),
  );
  return d.toISOString().slice(0, 10);
}
