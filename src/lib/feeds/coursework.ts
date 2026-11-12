/**
 * Which calendar events look like coursework (a deadline, exam or other
 * graded work) and which are the rest of a calendar (holidays, breaks,
 * classes, personal plans). The import preview ticks only coursework, and a
 * connected feed only ever adds coursework on its own, so a "Reading week"
 * or a public-holiday calendar never turns into a table full of fake
 * deadlines.
 *
 * Rules, in order:
 *  - A start date of an availability window ("Quiz 4 opens") is not a deadline.
 *  - An event covering more than one day (a break, a field trip) is not.
 *  - A title that names a holiday, a break or a cancellation is not, even
 *    with a course code; neither is an ordinary session (a lecture, office
 *    hours) unless the title also names graded work.
 *  - Anything else counts when the platform marks it as a deadline, when the
 *    title reads like graded work (homework, essay, quiz, exam, …, in the
 *    languages StudyOS speaks), or when it carries a course code.
 *
 * Pure: shared by the browser preview and the sync engine.
 */
import { courseCode } from "./mapping";
import type { FeedEvent } from "./normalize";

const WORK_WORDS = [
  // English
  "homework", "hw", "assignment", "problem set", "problem sheet", "pset", "worksheet", "exercise", "exercises",
  "essay", "paper", "report", "lab", "labs", "quiz", "quizzes", "exam", "exams", "midterm", "final", "finals",
  "test", "project", "presentation", "proposal", "draft", "thesis", "dissertation", "portfolio", "submission",
  "submit", "due", "deadline", "reading response", "reflection", "discussion post", "case study",
  "coursework", "practical", "viva", "capstone", "review sheet",
  // German
  "hausaufgabe", "hausaufgaben", "übung", "übungsblatt", "aufgabe", "aufgaben", "abgabe", "klausur", "prüfung",
  "test", "hausarbeit", "referat", "seminararbeit", "protokoll", "präsentation", "praktikum",
  // Spanish, Portuguese, Italian, French
  "tarea", "tareas", "entrega", "examen", "parcial", "ensayo", "informe", "trabajo", "proyecto", "prueba",
  "práctica", "exposición", "trabalho", "prova", "relatório", "projeto", "compito", "compiti", "esame",
  "consegna", "relazione", "progetto", "verifica", "devoir", "devoirs", "partiel", "rapport", "dissertation",
  "rendu", "projet", "contrôle", "mémoire",
  // Dutch
  "huiswerk", "opdracht", "tentamen", "toets", "verslag", "inleveren", "deadline", "werkstuk", "presentatie",
];

/** Words with no Latin word boundaries (matched as substrings). */
const WORK_SUBSTRINGS = [
  "作业", "考试", "测验", "测试", "期中", "期末", "论文", "报告", "截止", "实验", "提交",
  "課題", "宿題", "試験", "小テスト", "テスト", "レポート", "提出", "締切", "中間", "期末",
  "واجب", "اختبار", "امتحان", "تقرير", "مشروع", "تسليم", "بحث", "مقال", "اختبارات", "واجبات",
];

const BREAK_WORDS = [
  "holiday", "holidays", "bank holiday", "public holiday", "break", "spring break", "fall break", "winter break",
  "reading week", "study week", "recess", "vacation", "no class", "no classes", "no lecture", "no lectures",
  "no school", "university closed", "campus closed", "closed", "day off", "observed", "christmas", "easter",
  "thanksgiving", "new year", "new year's", "labor day", "labour day", "memorial day", "independence day",
  "halloween", "valentine", "birthday", "anniversary", "ferien", "feiertag", "vorlesungsfrei", "festivo",
  "feriado", "vacaciones", "vacances", "férié", "vacanze", "vakantie", "feestdag", "cancelled", "canceled",
];

/** Ordinary sessions: not graded work unless the title also says so ("Pre-lecture quiz"). */
const SESSION_WORDS = ["lecture", "office hours", "office hour", "class meeting", "vorlesung", "sprechstunde", "seminar"];

const BREAK_SUBSTRINGS = ["假期", "放假", "节日", "休み", "休日", "祝日", "祭日", "休講", "عطلة", "إجازة", "عيد"];

function wordPattern(words: string[]): RegExp {
  const escaped = [...new Set(words)]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s_-]+"));
  // Letters and digits around the word end it (Unicode-aware boundaries).
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})(?![\\p{L}])`, "iu");
}

const WORK = wordPattern(WORK_WORDS);
const BREAK = wordPattern(BREAK_WORDS);
const SESSION = wordPattern(SESSION_WORDS);

function hasSubstring(text: string, list: string[]): boolean {
  return list.some((w) => text.includes(w));
}

/** The title reads like graded work ("Homework 11", "Essay 2", "Klausur"). */
export function assignmentLikeTitle(title: string): boolean {
  const text = title.normalize("NFKC");
  return WORK.test(text) || hasSubstring(text, WORK_SUBSTRINGS);
}

/** The title names a break, a holiday or a cancellation. */
export function breakLikeTitle(title: string): boolean {
  const text = title.normalize("NFKC");
  return BREAK.test(text) || hasSubstring(text, BREAK_SUBSTRINGS);
}

/** The title names an ordinary class session (a lecture, office hours). */
export function sessionLikeTitle(title: string): boolean {
  return SESSION.test(title.normalize("NFKC"));
}

/** The event names its course with a code ("CHEM 210-01 FA26", "CS101"). */
export function hasCourseCode(event: Pick<FeedEvent, "course">): boolean {
  return Boolean(event.course && courseCode(event.course));
}

export function looksLikeCoursework(event: FeedEvent): boolean {
  if (event.role === "opening") return false;
  if ((event.days ?? 1) > 1) return false;
  if (breakLikeTitle(event.title)) return false;
  const work = assignmentLikeTitle(event.title);
  if (!work && sessionLikeTitle(event.title)) return false;
  return work || event.role === "deadline" || hasCourseCode(event);
}

/** Smallest calendar the general-calendar warning considers. */
const GENERAL_MIN_EVENTS = 4;
/** Below this share of coursework, a calendar looks general. */
const GENERAL_MAX_SHARE = 0.3;

/**
 * True when a calendar looks like a general one (holidays, a personal
 * calendar) rather than a course feed: a handful of events or more, few of
 * them coursework. Repeating events count once each.
 */
export function looksLikeGeneralCalendar(events: FeedEvent[]): boolean {
  let total = 0;
  let work = 0;
  const series = new Set<string>();
  for (const e of events) {
    if (e.series) {
      if (series.has(e.series)) continue;
      series.add(e.series);
      total += 1;
      continue;
    }
    total += 1;
    if (looksLikeCoursework(e)) work += 1;
  }
  return total >= GENERAL_MIN_EVENTS && work / total < GENERAL_MAX_SHARE;
}
