/**
 * Normalizing and framing course material (a pasted or uploaded syllabus) that
 * grounds workspace generation in the student's REAL courses, dates, and
 * topics — closing the "upload-first" gap every competitor has. Pure and
 * dependency-free so it's testable and usable on client and server.
 */

/** Hard cap on grounding text sent to the model (keeps prompts bounded). */
export const MAX_SOURCE_TEXT = 20_000;

// Control chars except tab (\x09) and newline (\x0A).
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

/**
 * Clean raw text: strip control chars, collapse runs of blank lines and
 * trailing spaces, and cap length (keeping the START, where syllabi put the
 * course identity and schedule). Returns "" for empty/whitespace input.
 */
export function normalizeSourceText(raw: string): string {
  if (!raw) return "";
  const cleaned = raw
    .replace(CONTROL_CHARS, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n") // trailing spaces
    .replace(/\n{3,}/g, "\n\n") // collapse blank-line runs
    .trim();
  return cleaned.length > MAX_SOURCE_TEXT
    ? cleaned.slice(0, MAX_SOURCE_TEXT)
    : cleaned;
}

/**
 * Wrap grounding text as a delimited prompt block instructing the model to
 * extract real details from it. Returns "" when there's nothing to ground on,
 * so callers can splice it unconditionally.
 */
export function sourceTextBlock(sourceText: string): string {
  const text = normalizeSourceText(sourceText);
  if (!text) return "";
  return [
    "The student provided their own course material (e.g. a syllabus). Ground the workspace in it: use the real course names, instructors, meeting times, assignment titles, exam dates, topics, and weights you find here rather than inventing generic ones. Convert any dates you see to ISO (YYYY-MM-DD).",
    '"""',
    text,
    '"""',
    "",
  ].join("\n");
}
