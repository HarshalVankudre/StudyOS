/**
 * StudyOS — onboarding questionnaire.
 *
 * After the student writes their one-line description, we ask a few quick
 * multiple-choice questions to tailor the generated workspace. The questions
 * are normally written by the AI (so they fit the description), but this module
 * also holds the pure types + a static fallback set, so the flow works with no
 * API key and never blocks generation.
 *
 * This file is intentionally dependency-free (no server-only imports) so it can
 * be shared by both the client UI and the server actions. Localized strings are
 * passed IN (the onboarding dictionary slice) rather than imported, so this
 * stays free of the full dictionary bundle.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

export type QuestionType = "single" | "multi";

export interface QuestionOption {
  id: string;
  label: string;
  emoji?: string;
}

export interface GenQuestion {
  id: string;
  question: string;
  /** "single" = pick one, "multi" = pick any number. */
  type: QuestionType;
  options: QuestionOption[];
}

/** A user's answer to one question: the option labels they chose. */
export interface QuestionAnswer {
  question: string;
  answers: string[];
}

/**
 * Sensible, study-agnostic questions used when the AI can't write tailored ones.
 * Localized via the onboarding dictionary slice passed in by the caller.
 *
 * Pass the student's `description` to leave out what it already answers (a
 * student who wrote "I'm taking two courses" is not asked how many courses
 * they take). At least one question is always kept.
 */
export function defaultQuestions(o: Dictionary["onboarding"], description = ""): GenQuestion[] {
  const all = allDefaultQuestions(o);
  if (!description.trim()) return all;
  const answered = answeredByDescription(description);
  const kept = all.filter((q) => !answered.has(q.id as DefaultQuestionId));
  return kept.length > 0 ? kept : all.filter((q) => q.id === "track");
}

export type DefaultQuestionId = "level" | "load" | "track" | "style";

// ---------------------------------------------------------------------------
// What a description already answers (simple, multilingual heuristics)
// ---------------------------------------------------------------------------

/**
 * A case-insensitive pattern for whole words. `\b` only knows ASCII letters,
 * so "università" or "matières" would never match with it; these boundaries
 * are Unicode-aware. Scripts without spaces (Chinese, Japanese) go in `bare`.
 */
function wordsRe(words: string[], bare: string[] = []): RegExp {
  const parts = [`(?<![\\p{L}\\p{N}])(?:${words.join("|")})(?![\\p{L}\\p{N}])`];
  if (bare.length) parts.push(`(?:${bare.join("|")})`);
  return new RegExp(parts.join("|"), "iu");
}

/** Words for "course(s)" in the ten app languages. */
const COURSE_WORDS = [
  "courses?", "classes", "modules?", "subjects?",
  "cursos", "asignaturas", "materias", "clases",
  "kurse", "fächer", "module", "vorlesungen", "lehrveranstaltungen",
  "cours", "matières", "ue",
  "corsi", "materie", "insegnamenti",
  "disciplinas", "matérias", "cadeiras",
  "vakken", "cursussen",
  "مقررات", "مقرر", "مواد", "مساقات",
];
const COURSE_WORDS_BARE = ["门课程?", "门", "科目", "授業", "講義", "コマ", "つの(?:授業|科目|講義)"];

/** Numbers two and up (one course is rare, and "un cours" is just "a course"). */
const NUMBER_WORDS = [
  "\\d{1,2}", "two", "three", "four", "five", "six", "seven", "eight", "a couple of",
  "dos", "tres", "cuatro", "cinco", "seis", "siete",
  "zwei", "drei", "vier", "fünf", "sechs", "sieben",
  "deux", "trois", "quatre", "cinq", "sept",
  "due", "tre", "quattro", "cinque", "sei", "sette",
  "dois", "duas", "três", "quatro",
  "twee", "drie", "vijf", "zes", "zeven",
  "اثنين", "اثنان", "ثلاث", "ثلاثة", "أربع", "أربعة", "خمس", "خمسة", "ست", "ستة", "سبع", "سبعة",
];

/** "4 courses", "zwei Kurse", "ثلاثة مقررات", "两门课", "3科目". */
// Built lazily from plain string pieces. The earlier form (two template
// literals concatenated at module load) came out of `next build` as an invalid
// pattern, missing the closing group and lookahead after the course words, and
// failed page-data collection, although the same source passed the unit tests.
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}])";
let countRe: RegExp | null = null;
function countPattern(): RegExp {
  if (countRe) return countRe;
  const spelled = [
    NOT_WORD_BEFORE,
    "(?:",
    NUMBER_WORDS.join("|"),
    ")\\s*(?:",
    COURSE_WORDS.join("|"),
    ")",
    NOT_WORD_AFTER,
  ].join("");
  const bare = ["(?:\\d{1,2}|[二两三四五六七八])\\s*(?:", COURSE_WORDS_BARE.join("|"), ")"].join("");
  countRe = new RegExp([spelled, bare].join("|"), "iu");
  return countRe;
}
/** Arabic dual forms already mean "two courses". */
const ARABIC_DUAL_RE = /(?:مقررين|مقرّرين|مادتين|مساقين)/u;
/** Course codes such as "CHEM 210", "MATH221", "CS-101". */
const COURSE_CODE_RE = /(?<![\p{L}\p{N}])[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?(?![\p{L}\p{N}])/gu;

/**
 * "I'm taking X and Y", "ich belege X und Y", "je prends X et Y": a verb of
 * enrolment followed by a list. Verbs that usually name a major ("studying")
 * are left out on purpose.
 */
const TAKING_RE = new RegExp(
  "(?<![\\p{L}])(?:taking|i take|enrolled in|signed up for|registered for|" +
    "estoy cursando|curso|tomo|" +
    "belege|ich habe|" +
    "je prends|je suis inscrit(?:e)? en|" +
    "seguo|frequento|" +
    "estou cursando|faço|" +
    "ik volg|volg|" +
    "选了|在上|修了|履修して(?:いる|います)|取っている|" +
    "آخذ|مسجل في)" +
    "\\s*(?:this (?:semester|term|year)[,:]?\\s*)?([^.!?\\n]{3,240})",
  "iu",
);
const LIST_SPLIT_RE =
  /\s*(?:,|、|，|;|&|(?<![\p{L}])(?:and|y|und|et|e|en)(?![\p{L}])|和|与|及|と|\sو)\s*/iu;
/** Where a course list stops: a time phrase or a following clause. */
const LIST_END_RE =
  /(?<![\p{L}])(?:this|next|in the|for my|because|to|so|but|este|dieses|diesen|ce|questo|neste|dit)(?![\p{L}])|这学期|今学期|هذا الفصل|في السنة/iu;

function namesSeveralCourses(description: string): boolean {
  const codes = new Set((description.match(COURSE_CODE_RE) ?? []).map((c) => c.replace(/[ -]/g, "")));
  if (codes.size >= 2) return true;
  const taking = description.match(TAKING_RE);
  if (!taking) return false;
  const tail = taking[1].split(LIST_END_RE)[0].replace(/^[:\s]+/, "");
  const parts = tail
    .split(LIST_SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p.split(/\s+/).length <= 7);
  return parts.length >= 2;
}

const LEVEL_RE = wordsRe(
  [
    // English
    "(?:\\d+(?:st|nd|rd|th)|first|second|third|fourth|final|last)[- ]year",
    "year [1-7]", "freshman", "sophomore", "junior", "senior", "undergrad(?:uate)?", "bachelor'?s?",
    "college", "university", "uni", "grad(?:uate)? school", "graduate student", "master'?s",
    "ph\\.?d", "postgrad(?:uate)?", "doctoral", "high school", "secondary school", "a-levels?",
    "self[- ]stud(?:y|ying)", "self[- ]taught", "bootcamp", "med school", "law school",
    // Spanish / Portuguese / Italian
    "(?:primer|segundo|tercer|cuarto|último) año", "universidad", "carrera", "máster", "bachillerato", "doctorado",
    "(?:primeiro|segundo|terceiro|quarto|último) ano", "faculdade", "universidade", "graduação", "mestrado", "ensino médio", "doutorado",
    "(?:primo|secondo|terzo|quarto|ultimo) anno", "università", "laurea", "triennale", "magistrale", "liceo", "dottorato",
    // German / French / Dutch
    "\\d+\\.\\s?semester", "studium", "universität", "hochschule", "bachelor", "master", "abitur", "gymnasium", "oberstufe",
    "(?:première|deuxième|troisième|dernière) année", "licence", "l[1-3]", "lycée", "université", "fac", "doctorat", "prépa",
    "eerstejaars", "tweedejaars", "derdejaars", "universiteit", "hogeschool", "havo", "vwo", "middelbare school",
    // Arabic
    "السنة (?:الأولى|الثانية|الثالثة|الرابعة|الخامسة|السادسة|الأخيرة)", "جامعة", "الجامعة", "كلية", "ماجستير", "دكتوراه",
    "الثانوية", "ثانوي", "بكالوريوس",
  ],
  ["大[一二三四]", "本科", "研究生", "硕士", "博士", "高[中一二三]", "大学", "年生", "大学院", "修士", "学部", "高校"],
);

const STYLE_RE = wordsRe(
  ["calendar", "kanban", "board", "to-?do lists?", "checklists?", "calendario", "tablero", "kalender", "calendrier",
    "tableau", "bacheca", "quadro", "تقويم", "لوحة مهام"],
  ["日历", "看板", "カレンダー", "ボード"],
);

const TRACK_CATEGORIES: RegExp[] = [
  wordsRe(
    ["assignments?", "homework", "problem sets?", "deadlines?", "essays?", "tareas", "deberes", "hausaufgaben",
      "abgaben", "devoirs", "compiti", "tarefas", "huiswerk", "واجبات", "مواعيد التسليم"],
    ["作业", "課題", "宿題"],
  ),
  wordsRe(
    ["exams?", "finals?", "midterms?", "tests?", "quizzes", "exámenes", "prüfungen?", "klausuren?", "examens?",
      "partiels", "esami", "provas", "tentamens?", "اختبارات?", "امتحانات?"],
    ["考试", "試験", "テスト"],
  ),
  wordsRe(["readings?", "lecturas", "lektüre", "letture", "leituras", "قراءات"], ["阅读", "読書"]),
  wordsRe(["notes", "apuntes", "notizen", "mitschriften", "appunti", "anotações", "aantekeningen", "ملاحظات"], ["笔记", "ノート"]),
  wordsRe(["habits?", "routines?", "streaks?", "hábitos", "gewohnheiten", "habitudes", "abitudini", "عادات"], ["习惯", "習慣"]),
  wordsRe(["grades?", "gpa", "marks", "calificaciones", "noten", "voti", "cijfers", "درجات"], ["成绩", "成績"]),
];

/**
 * Which of the default questions a free-text description already answers.
 * Heuristic and deliberately conservative: a question is only dropped when
 * the description clearly states the answer.
 */
export function answeredByDescription(description: string): Set<DefaultQuestionId> {
  const text = description.replace(/\s+/g, " ").trim();
  const answered = new Set<DefaultQuestionId>();
  if (!text) return answered;
  if (LEVEL_RE.test(text)) answered.add("level");
  if (countPattern().test(text) || ARABIC_DUAL_RE.test(text) || namesSeveralCourses(text)) answered.add("load");
  if (STYLE_RE.test(text)) answered.add("style");
  if (TRACK_CATEGORIES.filter((re) => re.test(text)).length >= 2) answered.add("track");
  return answered;
}

function allDefaultQuestions(o: Dictionary["onboarding"]): GenQuestion[] {
  return [
    {
      id: "level",
      question: o.level.question,
      type: "single",
      options: [
        { id: "hs", label: o.level.options.hs, emoji: "🎒" },
        { id: "ug", label: o.level.options.ug, emoji: "🎓" },
        { id: "grad", label: o.level.options.grad, emoji: "📚" },
        { id: "self", label: o.level.options.self, emoji: "💡" },
      ],
    },
    {
      id: "load",
      question: o.load.question,
      type: "single",
      options: [
        { id: "1-2", label: "1–2", emoji: "🍃" },
        { id: "3-4", label: "3–4", emoji: "🌿" },
        { id: "5-6", label: "5–6", emoji: "🌳" },
        { id: "7+", label: "7+", emoji: "🌲" },
      ],
    },
    {
      id: "track",
      question: o.track.question,
      type: "multi",
      options: [
        { id: "assign", label: o.track.options.assign, emoji: "📝" },
        { id: "exams", label: o.track.options.exams, emoji: "🧪" },
        { id: "read", label: o.track.options.read, emoji: "📖" },
        { id: "notes", label: o.track.options.notes, emoji: "🗒️" },
        { id: "habits", label: o.track.options.habits, emoji: "🔥" },
        { id: "grades", label: o.track.options.grades, emoji: "💯" },
      ],
    },
    {
      id: "style",
      question: o.style.question,
      type: "single",
      options: [
        { id: "cal", label: o.style.options.cal, emoji: "🗓️" },
        { id: "board", label: o.style.options.board, emoji: "📋" },
        { id: "list", label: o.style.options.list, emoji: "✅" },
      ],
    },
  ];
}

/**
 * Limits for model-written questions. They are stated in the prompt, and
 * {@link normalizeGenQuestions} enforces them by trimming, so one long label
 * never throws away the whole reply. The question and label caps also keep
 * the answers inside what POST /api/generate accepts.
 */
export const QUESTION_LIMITS = {
  questions: 4,
  options: 6,
  questionChars: 140,
  labelChars: 40,
} as const;

/**
 * Shorten `text` to at most `max` characters, at a word boundary when one is
 * close, with an ellipsis. Whitespace is collapsed first.
 */
export function clipText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, Math.max(1, max - 1));
  // Cut at a word boundary: the end of `cut` itself when a space follows it.
  const space = clean[cut.length] === " " ? cut.length : cut.lastIndexOf(" ");
  return `${(space >= max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** First visible character cluster (one emoji), or "" when it is not a short symbol. */
export function oneEmoji(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  let first = text;
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    first = segmenter.segment(text)[Symbol.iterator]().next().value?.segment ?? text;
  } catch {
    first = Array.from(text)[0] ?? "";
  }
  // Letters and digits are not an icon ("A", "1"); keep pictographs and symbols.
  if (!first || /[\p{L}\p{N}]/u.test(first) || first.length > 16) return "";
  return first;
}

function slugId(value: unknown, fallback: string): string {
  const raw = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

function uniqueIn(id: string, taken: Set<string>): string {
  let candidate = id;
  let n = 2;
  while (taken.has(candidate)) candidate = `${id}-${n++}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Turn the model's questions reply into usable questions, repairing what can
 * be repaired: long text is trimmed, missing ids are made up, an unknown
 * type becomes "single", options may be plain strings, duplicates and empty
 * options are dropped. Common alternative shapes are accepted (`text` or
 * `title` for the question, `choices` for the options, `multiSelect: true`,
 * a wrapped or bare question list) and a reply that is still raw text — not
 * valid JSON, or cut off — is salvaged one complete question at a time.
 * Only a question left with fewer than two options is dropped. Returns []
 * when nothing usable is left.
 */
export function normalizeGenQuestions(raw: unknown): GenQuestion[] {
  const list = questionList(raw);
  const questionIds = new Set<string>();
  const out: GenQuestion[] = [];
  for (const [index, item] of list.entries()) {
    if (out.length >= QUESTION_LIMITS.questions) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const q = item as Record<string, unknown>;
    const rawText = firstString(q, QUESTION_TEXT_KEYS);
    const text = rawText ? clipText(rawText, QUESTION_LIMITS.questionChars) : "";
    if (!text) continue;
    const optionIds = new Set<string>();
    const labels = new Set<string>();
    const options: QuestionOption[] = [];
    for (const [optionIndex, rawOption] of optionList(q).entries()) {
      if (options.length >= QUESTION_LIMITS.options) break;
      const option =
        typeof rawOption === "string" || typeof rawOption === "number"
          ? { label: String(rawOption) }
          : rawOption && typeof rawOption === "object"
            ? (rawOption as Record<string, unknown>)
            : null;
      if (!option) continue;
      const rawLabel = firstString(option, OPTION_LABEL_KEYS);
      if (!rawLabel) continue;
      // "🎓 Undergrad": an icon written into the label moves to the emoji.
      const leading = oneEmoji(rawLabel);
      const label = clipText(leading ? rawLabel.trim().slice(leading.length) : rawLabel, QUESTION_LIMITS.labelChars);
      if (!label || labels.has(label.toLocaleLowerCase())) continue;
      labels.add(label.toLocaleLowerCase());
      const emoji = oneEmoji(option.emoji ?? option.icon) || leading;
      options.push({
        id: uniqueIn(slugId(option.id ?? label, `o${optionIndex + 1}`), optionIds),
        label,
        ...(emoji ? { emoji } : {}),
      });
    }
    // One option is not a choice; such a question is the only thing dropped.
    if (options.length < 2) continue;
    out.push({
      id: uniqueIn(slugId(q.id, `q${index + 1}`), questionIds),
      question: text,
      type: isMultiQuestion(q) ? "multi" : "single",
      options,
    });
  }
  return out;
}

const QUESTION_TEXT_KEYS = ["question", "text", "title", "prompt", "label", "q"];
const OPTION_KEYS = ["options", "choices", "answers", "answerOptions", "answer_options", "items"];
const OPTION_LABEL_KEYS = ["label", "text", "title", "name", "value", "option"];
const LIST_KEYS = ["questions", "items", "data", "onboarding", "onboardingQuestions", "onboarding_questions", "result"];

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function optionList(q: Record<string, unknown>): unknown[] {
  for (const key of OPTION_KEYS) {
    const value = q[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function isMultiQuestion(q: Record<string, unknown>): boolean {
  if (q.multiSelect === true || q.multiple === true || q.allowMultiple === true || q.multi === true) return true;
  const type = typeof q.type === "string" ? q.type.toLowerCase().replace(/[\s_-]+/g, "") : "";
  return ["multi", "multiple", "multiselect", "multiplechoice", "checkbox", "checkboxes", "many", "pickany"].includes(type);
}

function looksLikeQuestion(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Boolean(firstString(record, QUESTION_TEXT_KEYS)) && optionList(record).length > 0;
}

/**
 * The question array inside a reply, wherever the model put it: the array
 * itself, `{questions: […]}` or a similar key, one level of wrapping
 * (`{data: {questions: […]}}`), or a single bare question. A reply that is
 * still a string (unparseable or cut off mid-way) is salvaged question by
 * question.
 */
function questionList(raw: unknown, depth = 0): unknown[] {
  if (typeof raw === "string") return depth === 0 ? salvageQuestions(raw) : [];
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object" || depth > 2) return [];
  const record = raw as Record<string, unknown>;
  if (looksLikeQuestion(record)) return [record];
  for (const key of LIST_KEYS) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value) && value.some(looksLikeQuestion)) return value;
  }
  for (const value of Object.values(record)) {
    const nested = questionList(value, depth + 1);
    if (nested.length > 0) return nested;
  }
  return [];
}

/**
 * Pull every complete question object out of raw reply text, so a reply cut
 * off after its third question (or wrapped in prose) still gives three.
 */
function salvageQuestions(text: string): unknown[] {
  const whole = parseJson(text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ""));
  if (whole !== undefined) return questionList(whole, 1);
  const found: unknown[] = [];
  let i = text.indexOf("{");
  while (i >= 0 && i < text.length) {
    const end = matchingBrace(text, i);
    if (end > i) {
      const value = parseJson(text.slice(i, end + 1));
      if (looksLikeQuestion(value)) {
        found.push(value);
        i = text.indexOf("{", end + 1);
        continue;
      }
    }
    i = text.indexOf("{", i + 1);
  }
  return found;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Index of the `}` closing the `{` at `start`, skipping string literals; -1 if none. */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Turn the chosen answers into a short preference brief that gets appended to
 * the generation prompt. Returns "" when nothing was selected.
 */
export function formatPreferences(answers: QuestionAnswer[]): string {
  const lines = answers
    .filter((a) => a.answers.length > 0)
    .map((a) => `- ${a.question} ${a.answers.join(", ")}`);
  if (lines.length === 0) return "";
  return `The student answered a few onboarding questions:\n${lines.join("\n")}`;
}
