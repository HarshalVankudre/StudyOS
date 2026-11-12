import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreparedQuestion, QuizAnswer } from "@/lib/study/quiz";
import { PendingFieldsContext, type PendingField } from "../editor/pendingFields";
import { clearExamProgress, examKey, loadExamProgress, useExamProgress } from "./examProgress";

const questions = [{ id: "q1" }, { id: "q2" }] as unknown as PreparedQuestion[];
const key = examKey("w1", "p1", "quiz1");

function installStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
    },
  });
  return data;
}

let fields: Set<PendingField>;
const wrapper = ({ children }: { children: ReactNode }) => (
  <PendingFieldsContext.Provider
    value={{ register: (f) => (fields.add(f), () => void fields.delete(f)), rev: 0 }}
  >
    {children}
  </PendingFieldsContext.Provider>
);

beforeEach(() => {
  installStorage();
  fields = new Set();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("an exam in progress (browser QA)", () => {
  it("is kept on this device with every answer, and counts as unsaved work", () => {
    const deadline = Date.now() + 20 * 60_000;
    const answers = new Map<string, QuizAnswer>([["q1", { kind: "choice", index: 1 } as unknown as QuizAnswer]]);
    const { rerender, unmount } = renderHook(
      ({ a }) => useExamProgress(key, true, questions, a, deadline),
      { wrapper, initialProps: { a: answers as ReadonlyMap<string, QuizAnswer> } },
    );
    expect(loadExamProgress(key)).toMatchObject({ questions, answers: [["q1", { index: 1 }]], deadline });
    expect([...fields].some((f) => f.hasPending())).toBe(true); // the leave prompt asks

    const more = new Map(answers).set("q2", { kind: "choice", index: 0 } as unknown as QuizAnswer);
    rerender({ a: more });
    expect(loadExamProgress(key)?.answers).toHaveLength(2);

    // Submitted (or left on purpose): no longer pending, and forgotten.
    rerender({ a: more });
    unmount();
    clearExamProgress(key);
    expect(fields.size).toBe(0);
    expect(loadExamProgress(key)).toBeNull();
  });

  it("is resumed with the same deadline after a reload, and not after a week", () => {
    const deadline = Date.now() + 5 * 60_000;
    renderHook(() => useExamProgress(key, true, questions, new Map(), deadline), { wrapper });
    // The page reloads 3 minutes later: the clock kept running.
    vi.setSystemTime(Date.now() + 3 * 60_000);
    expect(loadExamProgress(key)?.deadline).toBe(deadline);
    vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60_000);
    expect(loadExamProgress(key)).toBeNull();
  });
});
