"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { PreparedQuestion, QuizAnswer } from "@/lib/study/quiz";
import { usePendingFieldRegistry } from "../editor/pendingFields";

/**
 * An exam in progress is the student's work too, though not part of the
 * document until it is submitted. It is kept on this device as it goes
 * (every answer), counts as unsaved work for the leave prompt, and is picked
 * up again when the same exam is opened after a reload or a closed tab: the
 * same questions in the same order, the answers given, and the same deadline
 * (a timed exam keeps running while the tab is closed, as an exam would).
 */
export interface ExamProgress {
  v: 1;
  questions: PreparedQuestion[];
  answers: Array<[string, QuizAnswer]>;
  /** Epoch ms when time is up (null: untimed). */
  deadline: number | null;
  savedAt: number;
}

/** Older progress than this is not offered again. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function examKey(workspaceId: string, pageId: string, blockId: string): string {
  return `studyos:exam:${workspaceId}:${pageId}:${blockId}`;
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadExamProgress(key: string): ExamProgress | null {
  try {
    const raw = storage()?.getItem(key);
    const saved = raw ? (JSON.parse(raw) as ExamProgress) : null;
    if (!saved || saved.v !== 1 || !Array.isArray(saved.questions) || !Array.isArray(saved.answers)) return null;
    if (Date.now() - saved.savedAt > MAX_AGE_MS || saved.questions.length === 0) return null;
    return saved;
  } catch {
    return null;
  }
}

/** Fired on this window when an exam's kept progress is written or forgotten. */
export const EXAM_PROGRESS_EVENT = "studyos:exam-progress";

function announce(key: string): void {
  try {
    window.dispatchEvent(new CustomEvent(EXAM_PROGRESS_EVENT, { detail: { key } }));
  } catch {
    // No window (tests without DOM): nothing listens.
  }
}

export function clearExamProgress(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // ignore
  }
  announce(key);
}

function writeExamProgress(key: string, progress: Omit<ExamProgress, "v" | "savedAt">): void {
  try {
    storage()?.setItem(key, JSON.stringify({ v: 1, ...progress, savedAt: Date.now() }));
  } catch {
    // Storage full or blocked: the leave prompt still protects the exam.
  }
  announce(key);
}

/** How far an exam kept on this device has got. */
export interface ExamInProgress {
  answered: number;
  total: number;
}

function rawProgress(key: string | null): string | null {
  if (!key) return null;
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * An unfinished exam of this quiz kept on this device (a closed tab, a
 * reload), or null: what the quiz block and the study hub show as "Exam in
 * progress" with a way back in. Read after mount (storage is per device, so
 * the server render never claims one) and again whenever the progress is
 * written, forgotten, changed in another tab, or the tab comes back.
 */
export function useExamInProgress(key: string | null): ExamInProgress | null {
  const subscribe = useCallback(
    (changed: () => void) => {
      if (!key) return () => {};
      const onLocal = (ev: Event) => {
        if ((ev as CustomEvent<{ key?: string }>).detail?.key === key) changed();
      };
      const onStorage = (ev: StorageEvent) => {
        if (ev.key === null || ev.key === key) changed();
      };
      const onVisible = () => {
        if (document.visibilityState === "visible") changed();
      };
      window.addEventListener(EXAM_PROGRESS_EVENT, onLocal);
      window.addEventListener("storage", onStorage);
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        window.removeEventListener(EXAM_PROGRESS_EVENT, onLocal);
        window.removeEventListener("storage", onStorage);
        document.removeEventListener("visibilitychange", onVisible);
      };
    },
    [key],
  );
  // The raw stored text is the snapshot (a string compares by value); the
  // server render has none.
  const raw = useSyncExternalStore(subscribe, () => rawProgress(key), () => null);
  return useMemo(() => {
    if (!key || raw === null) return null;
    const saved = loadExamProgress(key);
    return saved ? { answered: saved.answers.length, total: saved.questions.length } : null;
  }, [key, raw]);
}

/**
 * Keep an exam in progress (`active`) on this device and registered with the
 * sync engine as pending work; forget it once it is submitted or left on
 * purpose (`active` false). `key` null: not an exam of one quiz.
 */
export function useExamProgress(
  key: string | null,
  active: boolean,
  questions: PreparedQuestion[],
  answers: ReadonlyMap<string, QuizAnswer>,
  deadline: number | null,
): void {
  const latest = useRef({ questions, answers: [...answers], deadline });
  useEffect(() => {
    latest.current = { questions, answers: [...answers], deadline };
  });

  // Every answer (and the start) is written at once.
  useEffect(() => {
    if (key && active) writeExamProgress(key, { questions, answers: [...answers], deadline });
  }, [key, active, questions, answers, deadline]);

  // Pending work for the engine: counts for the leave prompt, written before
  // the tab is hidden or closed.
  const register = usePendingFieldRegistry()?.register;
  useEffect(() => {
    if (!register || !key || !active) return;
    return register({
      hasPending: () => true,
      commit: () => writeExamProgress(key, latest.current),
    });
  }, [register, key, active]);
}
