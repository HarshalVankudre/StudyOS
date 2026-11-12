/**
 * Normalizing and framing course material (a pasted or uploaded syllabus) that
 * grounds workspace generation in the student's REAL courses, dates, and
 * topics — closing the "upload-first" gap every competitor has. Pure and
 * dependency-free so it's testable and usable on client and server.
 */

/**
 * Hard cap on grounding text sent to the model (keeps prompts bounded).
 * 40k characters is roughly 10k tokens: enough for several full syllabi, and
 * still comfortably inside the OpenRouter fallback model's context next to the
 * generation prompt and its example workspace.
 */
export const MAX_SOURCE_TEXT = 40_000;

/** Most text the client may hold/submit; anything past MAX_SOURCE_TEXT is not used. */
export const MAX_SOURCE_INPUT = MAX_SOURCE_TEXT * 3;

/** Largest syllabus file the upload accepts, in bytes (checked client- and server-side). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Control chars except tab (\x09) and newline (\x0A).
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

/**
 * Remove spaces and tabs at the end of every line. Same result as
 * `text.replace(/[ \t]+\n/g, "\n")`, but linear: that regex restarts at every
 * blank of a long run with no newline, so 120,000 spaces took seconds.
 */
export function stripTrailingBlanks(text: string): string {
  const parts: string[] = [];
  let lineStart = 0;
  for (;;) {
    const newline = text.indexOf("\n", lineStart);
    if (newline === -1) {
      parts.push(text.slice(lineStart));
      break;
    }
    let end = newline;
    while (end > lineStart) {
      const code = text.charCodeAt(end - 1);
      if (code !== 0x20 && code !== 0x09) break;
      end -= 1;
    }
    parts.push(text.slice(lineStart, end), "\n");
    lineStart = newline + 1;
  }
  return parts.join("");
}

/**
 * Clean raw text: strip control chars, collapse runs of blank lines and
 * trailing spaces, and cap length (keeping the START, where syllabi put the
 * course identity and schedule). Returns "" for empty/whitespace input.
 * Linear in the input, and only the first MAX_SOURCE_INPUT characters are
 * ever looked at (cleaning only removes characters, so that is plenty to
 * fill MAX_SOURCE_TEXT for any real document).
 */
export function normalizeSourceText(raw: string): string {
  if (!raw) return "";
  const cleaned = stripTrailingBlanks(
    raw
      .slice(0, MAX_SOURCE_INPUT)
      .replace(CONTROL_CHARS, "")
      .replace(/\r\n?/g, "\n"),
  )
    .replace(/\n{3,}/g, "\n\n") // collapse blank-line runs
    // Neutralize triple-quotes so pasted content (a Python """docstring""" in a
    // CS syllabus, or an injection attempt) can't close the grounding fence in
    // sourceTextBlock and leak into top-level prompt instructions.
    .replace(/"{3,}/g, '""')
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
