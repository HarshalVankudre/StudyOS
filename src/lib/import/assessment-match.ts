/**
 * Is this graded item the same one as that row?
 *
 * The syllabus merge (./syllabus-merge) restores weights and dates the model
 * dropped. Its one hard rule: never add a second row for something the model
 * already has under a slightly different title ("Problem Set 4" vs "Problem
 * Set 4 (graded)", "PS4", "Examen parcial" for "Midterm exam"). So matching
 * has three outcomes, not two:
 *
 *   - "same": confident; the caller may copy missing values onto the row;
 *   - "maybe": plausibly the same item; the caller must neither enrich nor add;
 *   - "different": clearly another item ("Problem Set 4" vs "Problem Set 5",
 *     "Midterm 1" vs "Midterm 2", "Final exam" vs "Final project").
 *
 * Names are reduced to a kind (exam, midterm, quiz, homework, project…),
 * their item numbers and their remaining content words, across the ten
 * supported languages. Pure and bounded.
 */

export type MatchStrength = "same" | "maybe" | "different";

export interface AssessmentKey {
  /** Canonical kinds found in the name, e.g. {"homework"}. */
  kinds: Set<string>;
  /** Item numbers, e.g. [4] for "Problem Set 4", [2] for "Midterm II". */
  numbers: number[];
  /** Remaining content words (lowercase, accents removed, kind words canonical). */
  tokens: string[];
  /** Normalized full name, for exact comparison. */
  normalized: string;
}

/**
 * Words that name a kind of graded work, by canonical kind. Matched on whole
 * words (after accents are removed) or, for CJK and Arabic, as substrings.
 * A deliverable kind (project, paper, lab…) wins over "final": "Final
 * project" is a project, "Final exam" an exam.
 */
const KIND_WORDS: Array<[kind: string, words: string[]]> = [
  ["project", [
    "project", "projects", "proyecto", "proyectos", "projekt", "projekte", "projet", "projets",
    "progetto", "progetti", "projeto", "projetos", "capstone", "项目", "プロジェクト", "مشروع",
  ]],
  ["paper", [
    "paper", "papers", "essay", "essays", "report", "reports", "thesis", "dissertation",
    "ensayo", "informe", "informes", "trabajo", "hausarbeit", "bericht", "aufsatz",
    "rapport", "memoire", "relazione", "tesina", "saggio", "relatorio", "monografia",
    "verslag", "werkstuk", "scriptie", "论文", "报告", "レポート", "論文", "تقرير", "بحث", "مقال",
  ]],
  ["lab", [
    "lab", "labs", "laboratory", "laboratorio", "laboratorios", "practicas", "practica",
    "praktikum", "labor", "tp", "laboratoire", "laboratorio", "practicum", "实验", "実験", "実習", "مختبر",
  ]],
  ["presentation", [
    "presentation", "presentations", "talk", "presentacion", "exposicion", "referat",
    "vortrag", "praesentation", "prasentation", "expose", "presentazione", "apresentacao",
    "seminario", "presentatie", "发表", "展示", "発表", "عرض",
  ]],
  ["homework", [
    "homework", "homeworks", "hw", "assignment", "assignments", "problem", "problems", "pset",
    "psets", "ps", "worksheet", "exercise", "exercises", "tarea", "tareas", "entrega", "entregas",
    "ejercicios", "aufgabe", "aufgaben", "ubungsblatt", "ubungsblatter", "uebungsblatt",
    "ubung", "hausaufgabe", "hausaufgaben", "abgabe", "devoir", "devoirs", "fiche", "fiches", "compito",
    "compiti", "esercitazione", "esercizi", "consegna", "tarefa", "tarefas", "lista",
    "exercicios", "opdracht", "opdrachten", "huiswerk", "作业", "习题", "課題", "宿題", "واجب", "تكليف",
  ]],
  ["quiz", [
    "quiz", "quizzes", "quizz", "kurztest", "controle", "interrogation", "verifica",
    "测验", "小测", "小テスト", "كويز",
  ]],
  ["midterm", [
    "midterm", "midterms", "mid", "parcial", "parciales", "zwischenprufung", "zwischenklausur",
    "partiel", "partiels", "intermedia", "intermedio", "esonero", "intermediaria",
    "deeltoets", "tussentoets", "期中", "中間", "نصفي", "منتصف",
  ]],
  ["final", ["final", "finals", "endterm", "abschlussprufung", "期末", "نهائي", "النهائي"]],
  ["exam", [
    "exam", "exams", "examination", "examen", "examenes", "klausur", "klausuren", "prufung",
    "prufungen", "esame", "esami", "exame", "exames", "prova", "provas", "tentamen",
    "test", "tests", "prueba", "pruebas", "control", "teste", "toets", "toetsen",
    "考试", "試験", "テスト", "امتحان", "اختبار", "اختبارات",
  ]],
];

/** Kinds that are graded deliverables rather than sittings. */
const DELIVERABLE_KINDS = new Set(["project", "paper", "lab", "presentation", "homework"]);
/** Sittings: an "exam" is compatible with a midterm or a final. */
const SITTING_KINDS = new Set(["quiz", "midterm", "final", "exam"]);

/** Words that carry no identity ("the", "due", "graded", "course"…). */
const FILLER = new Set([
  "the", "a", "an", "of", "for", "and", "on", "in", "at", "by", "to", "due", "graded",
  "set", "sets", "sheet", "sheets", "no", "nr", "num", "number", "part", "item",
  "de", "del", "la", "el", "los", "las", "y", "en", "para", "der", "die", "das", "und",
  "zum", "zur", "le", "les", "du", "des", "et", "il", "di", "e", "do", "da", "dos", "das",
  "het", "een", "van", "en", "voor", "week", "weekly", "semanal", "semanales", "wochentlich",
  "hebdomadaire", "settimanale", "semanais", "wekelijks", "course", "class", "unit", "module",
]);

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

const CJK_OR_ARABIC = /[぀-ヿ㐀-鿿؀-ۿ]/;

/** Lowercase, accents removed, CJK/Arabic left as they are. */
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // Recompose what is left (Japanese kana marks) so CJK words still match.
    .normalize("NFC")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

/** Course codes ("ECON 201", "CS-101") are course labels, not item numbers. */
const COURSE_CODE = /\b[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?\b/g;

const BRACKETED = /[([{（【][^)\]}）】]{0,80}[)\]}）】]/g;

/**
 * The name's kind, numbers and words. `withNotes: false` (the default)
 * leaves out text in brackets ("(graded)", "[in class]"); with `true` it is
 * read as part of the name ("Group project (final report)").
 */
export function assessmentKey(name: string, withNotes = false): AssessmentKey {
  let text = name.slice(0, 200).replace(COURSE_CODE, " ");
  text = withNotes ? text.replace(/[()[\]{}（）【】]/g, " ") : text.replace(BRACKETED, " ");
  text = fold(text)
    .replace(/[#№]/g, " ")
    // "PS4", "HW3", "Quiz7" -> "ps 4", "hw 3", "quiz 7"; "1st" stays one token.
    .replace(/(\p{L})(\d)/gu, "$1 $2")
    .replace(/(\d)(?!(?:st|nd|rd|th|er|e|o|a)\b)(\p{L})/gu, "$1 $2");

  const kinds = new Set<string>();
  const numbers: number[] = [];
  const tokens: string[] = [];
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  words.forEach((word, index) => {
    if (CJK_OR_ARABIC.test(word)) {
      // CJK and Arabic kind words sit inside longer runs ("期末考试"): take
      // them out as canonical tokens and keep what is left as one token.
      let rest = word.replace(/^ال/, "");
      for (const [kindWord, kind] of CJK_KIND_WORDS) {
        if (!rest.includes(kindWord)) continue;
        kinds.add(kind);
        if (kind !== "exam") tokens.push(`#${kind}`);
        rest = rest.split(kindWord).join(" ");
      }
      for (const part of rest.split(" ")) {
        const clean = part.replace(/^ال/, "");
        if (clean.length >= 1 && !(clean.length === 1 && /[؀-ۿ]/.test(clean))) tokens.push(clean);
      }
      return;
    }
    if (/^\d{1,3}$/.test(word)) {
      numbers.push(Number(word));
      return;
    }
    const ordinal = word.match(/^(\d{1,2})(?:st|nd|rd|th|er|e|o|a)$/);
    if (ordinal) {
      numbers.push(Number(ordinal[1]));
      return;
    }
    // A roman numeral right after a kind word: "Midterm II".
    const previousKind = index > 0 && kindOf(words[index - 1]);
    if (previousKind && word in ROMAN) {
      numbers.push(ROMAN[word]);
      return;
    }
    const kind = kindOf(word);
    if (kind) {
      kinds.add(kind);
      // Kind words count as one canonical token, so "Examen parcial" and
      // "Midterm exam" share "midterm".
      if (kind !== "exam") tokens.push(`#${kind}`);
      return;
    }
    if (FILLER.has(word) || word.length < 2) return;
    tokens.push(word);
  });

  // "Final project": "final" only qualifies the deliverable.
  if ([...kinds].some((k) => DELIVERABLE_KINDS.has(k)) && kinds.has("final")) {
    kinds.delete("final");
    const at = tokens.indexOf("#final");
    if (at >= 0) tokens.splice(at, 1);
  }

  const uniqueTokens = [...new Set(tokens)];
  const uniqueNumbers = [...new Set(numbers)].sort((a, b) => a - b);
  return {
    kinds,
    numbers: uniqueNumbers,
    tokens: uniqueTokens,
    normalized: [...[...uniqueTokens].sort(), ...uniqueNumbers.map(String)].join(" "),
  };
}

const KIND_INDEX = new Map<string, string>();
for (const [kind, words] of KIND_WORDS) {
  for (const word of words) if (!KIND_INDEX.has(word)) KIND_INDEX.set(word, kind);
}

/** CJK / Arabic kind words as [word, kind], longest first so "小テスト" wins over "テスト". */
const CJK_KIND_WORDS: Array<[string, string]> = KIND_WORDS.flatMap(([kind, words]) =>
  words
    .filter((w) => CJK_OR_ARABIC.test(w))
    .map((w): [string, string] => [w.replace(/^ال/, ""), kind]),
).sort((a, b) => b[0].length - a[0].length);

function kindOf(word: string): string | undefined {
  return KIND_INDEX.get(word);
}

/** Deliverables that are often one item: a project's report, a lab's write-up. */
const RELATED_DELIVERABLES: Array<Set<string>> = [
  new Set(["project", "paper", "presentation"]),
  new Set(["lab", "paper"]),
];

function kindsRelated(a: Set<string>, b: Set<string>): boolean {
  return RELATED_DELIVERABLES.some(
    (group) => [...a].some((k) => group.has(k)) && [...b].some((k) => group.has(k)),
  );
}

function kindsCompatible(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return true;
  for (const kind of a) if (b.has(kind)) return true;
  if (kindsRelated(a, b)) return true;
  // A generic "exam" is compatible with any sitting (midterm, final, quiz).
  const sittingA = [...a].every((k) => SITTING_KINDS.has(k));
  const sittingB = [...b].every((k) => SITTING_KINDS.has(k));
  if (sittingA && sittingB && (a.has("exam") || b.has("exam"))) return true;
  return false;
}

function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** Share of the smaller token set found in the larger one (0–1). */
function containment(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  const set = new Set(large);
  return small.filter((t) => set.has(t)).length / small.length;
}

function dice(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const set = new Set(b);
  const shared = a.filter((t) => set.has(t)).length;
  return (2 * shared) / (a.length + b.length);
}

export interface MatchContext {
  /** ISO dates of the two items, when known. */
  dateA?: string | null;
  dateB?: string | null;
}

export interface MatchResult {
  strength: MatchStrength;
  /** Higher is closer; only meaningful to rank several "same" results. */
  score: number;
}

/**
 * Compare a syllabus item with a row title (or two syllabus items).
 * See the module comment for what "same", "maybe" and "different" promise.
 */
export function matchAssessments(a: string, b: string, context: MatchContext = {}): MatchResult {
  // Bracketed text is a note ("(graded)") or part of the name ("(final
  // report)"): compare both readings and keep the closest, so a duplicate is
  // never added because the identifying words sat in brackets.
  const rank: Record<MatchStrength, number> = { different: 0, maybe: 1, same: 2 };
  let best: MatchResult | undefined;
  for (const notesA of [false, true]) {
    for (const notesB of [false, true]) {
      if ((notesA && !/[([{（【]/.test(a)) || (notesB && !/[([{（【]/.test(b))) continue;
      const result = compareKeys(assessmentKey(a, notesA), assessmentKey(b, notesB), context);
      if (
        !best ||
        rank[result.strength] > rank[best.strength] ||
        (result.strength === best.strength && result.score > best.score)
      ) {
        best = result;
      }
    }
  }
  return best!;
}

function compareKeys(ka: AssessmentKey, kb: AssessmentKey, context: MatchContext): MatchResult {
  const sameDate = Boolean(context.dateA && context.dateB && context.dateA === context.dateB);
  const datesFarApart =
    Boolean(context.dateA && context.dateB) &&
    Math.abs(Date.parse(`${context.dateA}T00:00:00Z`) - Date.parse(`${context.dateB}T00:00:00Z`)) >
      14 * 86_400_000;

  if (ka.normalized && ka.normalized === kb.normalized) {
    // Same name; only a far-apart date says otherwise (a repeated "Quiz").
    return datesFarApart ? { strength: "maybe", score: 0 } : { strength: "same", score: 3 };
  }
  if (!kindsCompatible(ka.kinds, kb.kinds)) return { strength: "different", score: 0 };

  const bothNumbered = ka.numbers.length > 0 && kb.numbers.length > 0;
  if (bothNumbered && !sameNumbers(ka.numbers, kb.numbers)) return { strength: "different", score: 0 };
  const numbersAgree = bothNumbered || (ka.numbers.length === 0 && kb.numbers.length === 0);

  const contained = containment(ka.tokens, kb.tokens);
  const overlap = dice(ka.tokens, kb.tokens);
  const sharedKind = [...ka.kinds].some((k) => kb.kinds.has(k));
  const score = overlap + (sameDate ? 1 : 0) + (sharedKind ? 0.5 : 0);

  if (numbersAgree && !datesFarApart) {
    // Every word of the shorter name appears in the longer one:
    // "Problem Set 4" / "Problem Set 4 — Elasticity", "Midterm" / "Midterm exam".
    if (contained === 1 && (sharedKind || ka.kinds.size + kb.kinds.size === 0 || bothNumbered)) {
      return { strength: "same", score };
    }
    // Renamed, but the same kind on the same day: "Examen parcial" for "Midterm".
    if (sameDate && sharedKind) return { strength: "same", score };
  }

  // Close enough that adding a row could duplicate it.
  if (sharedKind && !datesFarApart) return { strength: "maybe", score };
  // "Final report" next to "Group project": possibly one deliverable.
  if (kindsRelated(ka.kinds, kb.kinds) && numbersAgree && !datesFarApart) return { strength: "maybe", score };
  // "Test 2" / "Midterm 2": compatible kinds with the same number.
  if (bothNumbered && (ka.kinds.size > 0 || kb.kinds.size > 0) && !datesFarApart) {
    return { strength: "maybe", score };
  }
  if (overlap >= 0.5) return { strength: "maybe", score };
  if (sameDate && (ka.kinds.size === 0 || kb.kinds.size === 0)) return { strength: "maybe", score };
  return { strength: "different", score };
}
