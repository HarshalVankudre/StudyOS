import { describe, expect, it } from "vitest";
import type { QuizBlock, QuizQuestion, Workspace } from "@/lib/workspace/types";
import { MAX_QUIZ_ATTEMPTS } from "@/lib/workspace/schema";
import {
  applyRunResults,
  collectQuizItems,
  convertQuestion,
  countMissedQuestions,
  duplicateQuiz,
  isCorrect,
  isPlayableQuestion,
  moveChoice,
  newQuestion,
  percent,
  prepareRun,
  pushAttempt,
  questionIssue,
  quizItems,
  reconcileAgentQuiz,
  removeChoice,
  scoreRun,
  selectWeakQuestions,
  shuffled,
  weakness,
  type QuizAnswer,
  type QuizItem,
  recordAnswer,
  runResultsReplay,
  runResultsReplayer,
} from "./quiz";

/** Deterministic PRNG (mulberry32) so shuffles are reproducible. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mcq = (id: string, o: Partial<QuizQuestion> = {}): QuizQuestion => ({
  id,
  kind: "mcq",
  prompt: `Q ${id}`,
  choices: ["a", "b", "c", "d"],
  answerIndex: 2,
  ...o,
});
const tf = (id: string, answerBool?: boolean): QuizQuestion => ({ id, kind: "true_false", prompt: `TF ${id}`, answerBool });
const short = (id: string, answerText = "model"): QuizQuestion => ({ id, kind: "short", prompt: `S ${id}`, answerText });

const item = (question: QuizQuestion, blockId = "b1", pageId = "p1"): QuizItem => ({
  pageId,
  blockId,
  questionId: question.id,
  question,
});

describe("playability", () => {
  it("accepts complete questions of every kind", () => {
    expect(isPlayableQuestion(mcq("1"))).toBe(true);
    expect(isPlayableQuestion(tf("2", false))).toBe(true);
    expect(isPlayableQuestion(short("3"))).toBe(true);
  });

  it("names what a half-written question still needs", () => {
    expect(questionIssue(mcq("1", { prompt: "  " }))).toBe("prompt");
    expect(questionIssue(mcq("1", { choices: ["only one", " "] }))).toBe("choices");
    expect(questionIssue(mcq("1", { answerIndex: undefined }))).toBe("answer");
    expect(questionIssue(mcq("1", { answerIndex: 9 }))).toBe("answer");
    // The correct choice is blank: not playable.
    expect(questionIssue(mcq("1", { choices: ["a", "b", " "], answerIndex: 2 }))).toBe("answer");
    expect(questionIssue(tf("2"))).toBe("answer");
    expect(questionIssue(short("3", ""))).toBe("answer");
    expect(questionIssue(newQuestion("mcq"))).toBe("prompt");
  });

  it("converting a question keeps its prompt and history but drops answers that no longer apply", () => {
    const q = mcq("1", { explanation: "why", stats: { attempts: 2, correct: 1 } });
    const asTf = convertQuestion(q, "true_false");
    expect(asTf).toEqual({ id: "1", kind: "true_false", prompt: "Q 1", explanation: "why", stats: { attempts: 2, correct: 1 } });
    expect(convertQuestion(q, "mcq")).toBe(q);
  });

  it("editing choices keeps the answer on the same choice", () => {
    const q = mcq("1", { answerIndex: 2 });
    removeChoice(q, 0);
    expect(q.choices).toEqual(["b", "c", "d"]);
    expect(q.answerIndex).toBe(1);
    moveChoice(q, 1, -1);
    expect(q.choices).toEqual(["c", "b", "d"]);
    expect(q.answerIndex).toBe(0);
    moveChoice(q, 1, -1); // moves "b" above the answer
    expect(q.choices![q.answerIndex!]).toBe("c");
    removeChoice(q, q.answerIndex!);
    expect(q.answerIndex).toBeUndefined();
  });
});

describe("shuffling", () => {
  it("is a permutation", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i);
    const out = shuffled(xs, seeded(1));
    expect(out).not.toEqual(xs);
    expect([...out].sort((a, b) => a - b)).toEqual(xs);
  });

  it("never changes which choice is correct, whatever the order", () => {
    const questions = Array.from({ length: 30 }, (_, i) =>
      mcq(String(i), { choices: ["w", "x", "RIGHT", "y", "z"].map((c) => `${c}${i}`), answerIndex: 2 }),
    );
    for (let seed = 0; seed < 25; seed += 1) {
      const run = prepareRun(questions.map((q) => item(q)), { rng: seeded(seed) });
      for (const p of run) {
        const shown = p.choices!;
        expect(shown.map((c) => c.text).sort()).toEqual([...p.question.choices!].sort());
        // Picking the displayed choice whose text is RIGHT is graded correct.
        const right = shown.find((c) => c.text.startsWith("RIGHT"))!;
        expect(isCorrect(p.question, { kind: "mcq", choice: right.index })).toBe(true);
        for (const c of shown.filter((c) => c !== right)) {
          expect(isCorrect(p.question, { kind: "mcq", choice: c.index })).toBe(false);
        }
        expect(shown.every((c) => p.question.choices![c.index] === c.text)).toBe(true);
      }
    }
  });

  it("actually varies question and choice order between runs", () => {
    const items = Array.from({ length: 8 }, (_, i) => item(mcq(String(i))));
    const a = prepareRun(items, { rng: seeded(1) });
    const b = prepareRun(items, { rng: seeded(2) });
    expect(a.map((q) => q.key)).not.toEqual(b.map((q) => q.key));
    expect(a.some((q) => q.choices!.map((c) => c.index).join() !== "0,1,2,3")).toBe(true);
  });

  it("skips incomplete questions and blank choices, and can keep the authored order", () => {
    const run = prepareRun(
      [item(mcq("1", { choices: ["a", " ", "c"], answerIndex: 2 })), item(tf("2")), item(short("3"))],
      { shuffleQuestions: false, shuffleChoices: false },
    );
    expect(run.map((q) => q.questionId)).toEqual(["1", "3"]);
    expect(run[0].choices).toEqual([
      { text: "a", index: 0 },
      { text: "c", index: 2 },
    ]);
  });
});

describe("scoring", () => {
  const run = prepareRun(
    [item(mcq("m")), item(tf("t", true)), item(short("s")), item(short("u")), item(mcq("x"))],
    { shuffleQuestions: false },
  );
  const key = (id: string) => run.find((q) => q.questionId === id)!.key;

  it("grades each kind; short answers count only once self-marked", () => {
    const answers = new Map<string, QuizAnswer>([
      [key("m"), { kind: "mcq", choice: 2 }],
      [key("t"), { kind: "true_false", value: false }],
      [key("s"), { kind: "short", text: "my words", correct: true }],
      [key("u"), { kind: "short", text: "not marked yet" }],
    ]);
    const s = scoreRun(run, answers);
    expect(s.score).toBe(2);
    expect(s.total).toBe(5);
    expect(s.correct).toEqual([key("m"), key("s")]);
    expect(s.missed).toEqual([key("t"), key("x")]);
    expect(s.unmarked).toEqual([key("u")]);
    expect(s.unanswered).toEqual([key("x")]);
    expect(percent(s.score, s.total)).toBe(40);
    expect(percent(0, 0)).toBe(0);
  });

  it("an answer of the wrong kind is not correct", () => {
    expect(isCorrect(mcq("1"), { kind: "true_false", value: true })).toBeNull();
  });
});

describe("saving results", () => {
  function ws(block: QuizBlock): Workspace {
    return { id: "w", name: "W", pages: [{ id: "p1", title: "P", blocks: [block] }], databases: [] };
  }

  it("updates per-question stats and appends a capped attempt history", () => {
    const block: QuizBlock = { id: "b1", type: "quiz", questions: [mcq("1"), tf("2", true)] };
    const d = ws(block);
    applyRunResults(
      d,
      [
        { pageId: "p1", blockId: "b1", questionId: "1", correct: true },
        { pageId: "p1", blockId: "b1", questionId: "2", correct: false },
        { pageId: "p1", blockId: "b1", questionId: "gone", correct: true },
      ],
      { pageId: "p1", blockId: "b1", attempt: { at: "2026-11-12T10:00:00.000Z", mode: "exam", score: 1, total: 2 } },
    );
    const b = d.pages[0].blocks[0] as QuizBlock;
    const moment = "2026-11-12T10:00:00.000Z";
    expect(b.questions[0].stats).toEqual({ attempts: 1, correct: 1, lastAnsweredAt: moment, recent: [moment] });
    expect(b.questions[1].stats).toEqual({ attempts: 1, correct: 0, lastAnsweredAt: moment, recent: [moment] });
    expect(b.attempts).toEqual([{ at: "2026-11-12T10:00:00.000Z", mode: "exam", score: 1, total: 2 }]);

    const later = (i: number) => new Date(Date.UTC(2026, 10, 13, 9, i)).toISOString();
    for (let i = 0; i < MAX_QUIZ_ATTEMPTS + 5; i += 1) {
      pushAttempt(b, { at: later(i), mode: "practice", score: i, total: 50 });
    }
    expect(b.attempts).toHaveLength(MAX_QUIZ_ATTEMPTS);
    expect(b.attempts!.at(-1)!.at).toBe(later(MAX_QUIZ_ATTEMPTS + 4));
    // An attempt made earlier on a device that syncs later takes its place in time.
    pushAttempt(b, { at: later(MAX_QUIZ_ATTEMPTS + 2).replace(":00.000Z", ":30.000Z"), mode: "practice", score: 0, total: 50 });
    expect(b.attempts!.at(-1)!.at).toBe(later(MAX_QUIZ_ATTEMPTS + 4));
  });

  it("is idempotent per run: replaying a saved run changes nothing, and the attempt is updated in place", () => {
    const block: QuizBlock = { id: "b1", type: "quiz", questions: [mcq("1"), tf("2", true)] };
    const d = ws(block);
    const at = "2026-11-12T10:00:00.000Z";
    const first = [{ pageId: "p1", blockId: "b1", questionId: "1", correct: true }];
    const attempt = (score: number) => ({ pageId: "p1", blockId: "b1", attempt: { at, mode: "exam" as const, score, total: 2 } });
    applyRunResults(d, first, attempt(1), at);
    applyRunResults(d, first, attempt(1), at); // a save whose reply was lost
    const b = d.pages[0].blocks[0] as QuizBlock;
    expect(b.questions[0].stats).toEqual({ attempts: 1, correct: 1, lastAnsweredAt: at, recent: [at] });
    expect(b.attempts).toHaveLength(1);

    // A written answer marked later in the same run: its stats, the same attempt.
    applyRunResults(d, [{ pageId: "p1", blockId: "b1", questionId: "2", correct: true }], attempt(2), at);
    expect(b.questions[1].stats).toEqual({ attempts: 1, correct: 1, lastAnsweredAt: at, recent: [at] });
    expect(b.questions[0].stats?.attempts).toBe(1);
    expect(b.attempts).toEqual([{ at, mode: "exam", score: 2, total: 2 }]);
  });

  it("builds on a newer document: answers from elsewhere are kept, moved questions are found by id", () => {
    const at = "2026-11-12T10:00:00.000Z";
    const run = [{ pageId: "p1", blockId: "b1", questionId: "1", correct: false }];
    // Meanwhile another tab answered question 1 and moved it below a new one.
    const newer = ws({
      id: "b1",
      type: "quiz",
      questions: [tf("new", true), mcq("1", { stats: { attempts: 3, correct: 3, lastAnsweredAt: "2026-11-11T08:00:00.000Z" } })],
    });
    applyRunResults(newer, run, undefined, at);
    const q1 = (newer.pages[0].blocks[0] as QuizBlock).questions[1];
    expect(q1.stats).toEqual({ attempts: 4, correct: 3, lastAnsweredAt: at, recent: [at] });
    // A quiz deleted meanwhile is skipped without error.
    const empty: Workspace = { id: "w", name: "W", pages: [{ id: "p1", title: "P", blocks: [] }], databases: [] };
    expect(() => applyRunResults(empty, run, { pageId: "p1", blockId: "b1", attempt: { at, mode: "practice", score: 0, total: 1 } }, at)).not.toThrow();
  });

  it("a duplicate starts fresh: new question ids, no stats, no attempts", () => {
    const block: QuizBlock = {
      id: "b1",
      type: "quiz",
      title: "Bio",
      questions: [mcq("1", { stats: { attempts: 3, correct: 1 } })],
      attempts: [{ at: "x", mode: "practice", score: 1, total: 1 }],
    };
    let n = 0;
    const copy = duplicateQuiz(block, "b2", () => `new${(n += 1)}`);
    expect(copy).toEqual({ id: "b2", type: "quiz", title: "Bio", questions: [{ ...mcq("1"), id: "new1" }] });
    expect(block.questions[0].stats).toBeDefined();
  });
});

describe("weak questions", () => {
  it("weights questions the student keeps missing above ones they know", () => {
    const known = weakness(mcq("k", { stats: { attempts: 6, correct: 6 } }));
    const unseen = weakness(mcq("u"));
    const once = weakness(mcq("o", { stats: { attempts: 2, correct: 1 } }));
    const often = weakness(mcq("f", { stats: { attempts: 5, correct: 1 } }));
    expect(known).toBeLessThan(unseen);
    expect(unseen).toBeLessThan(once);
    expect(once).toBeLessThan(often);
    expect(known).toBeGreaterThan(0);
  });

  it("draws mostly the weak questions, across quizzes, never incomplete ones", () => {
    const weak = Array.from({ length: 5 }, (_, i) => item(mcq(`w${i}`, { stats: { attempts: 4, correct: 0 } }), "quizA"));
    const strong = Array.from({ length: 20 }, (_, i) =>
      item(mcq(`s${i}`, { stats: { attempts: 8, correct: 8 } }), "quizB"),
    );
    const broken = item(mcq("broken", { answerIndex: undefined, stats: { attempts: 9, correct: 0 } }));
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 200; seed += 1) {
      const picked = selectWeakQuestions([...strong, broken, ...weak], 5, seeded(seed));
      expect(picked).toHaveLength(5);
      expect(picked.some((p) => p.questionId === "broken")).toBe(false);
      for (const p of picked) counts.set(p.questionId, (counts.get(p.questionId) ?? 0) + 1);
    }
    const weakPicks = weak.reduce((n, w) => n + (counts.get(w.questionId) ?? 0), 0);
    expect(weakPicks / (200 * 5)).toBeGreaterThan(0.6);
    // ...but known questions still come up now and then.
    expect(strong.some((s) => (counts.get(s.questionId) ?? 0) > 0)).toBe(true);
  });

  it("orders the round weakest first and handles small pools", () => {
    const items = [
      item(mcq("a", { stats: { attempts: 3, correct: 3 } })),
      item(mcq("b", { stats: { attempts: 3, correct: 0 } })),
    ];
    expect(selectWeakQuestions(items, 10, seeded(3)).map((i) => i.questionId)).toEqual(["b", "a"]);
    expect(selectWeakQuestions([], 10)).toEqual([]);
    expect(countMissedQuestions(items)).toBe(1);
  });

  it("collects every quiz question in a workspace", () => {
    const w: Workspace = {
      id: "w",
      name: "W",
      databases: [],
      pages: [
        { id: "p1", title: "A", blocks: [{ id: "q1", type: "quiz", title: "One", questions: [mcq("1")] }] },
        {
          id: "p2",
          title: "B",
          blocks: [
            { id: "d", type: "flashcards", cards: [] },
            { id: "q2", type: "quiz", questions: [tf("2", true), short("3")] },
          ],
        },
      ],
    };
    expect(collectQuizItems(w).map((i) => `${i.pageId}/${i.blockId}/${i.questionId}`)).toEqual([
      "p1/q1/1",
      "p2/q2/2",
      "p2/q2/3",
    ]);
    expect(quizItems("p1", w.pages[0].blocks[0] as QuizBlock)[0].quizTitle).toBe("One");
  });
});

describe("agent edits", () => {
  const prev: QuizBlock = {
    id: "b1",
    type: "quiz",
    questions: [
      mcq("1", { stats: { attempts: 4, correct: 1 } }),
      { id: "half", kind: "mcq", prompt: "student is still writing", choices: ["", ""] },
    ],
    attempts: [{ at: "x", mode: "exam", score: 3, total: 4 }],
  };

  it("keeps the student's stats and attempts when the agent leaves them out", () => {
    const next: QuizBlock = {
      id: "b1",
      type: "quiz",
      questions: [mcq("1", { prompt: "Reworded" }), prev.questions[1], tf("new", true)],
    };
    expect(reconcileAgentQuiz(next, prev)).toBeNull();
    expect(next.questions[0].stats).toEqual({ attempts: 4, correct: 1 });
    expect(next.attempts).toEqual(prev.attempts);
  });

  it("rejects a question the agent wrote incomplete, but tolerates the student's untouched draft", () => {
    const bad: QuizBlock = { id: "b1", type: "quiz", questions: [mcq("n", { answerIndex: 7 })] };
    expect(reconcileAgentQuiz(bad, prev)).toMatch(/question "n".*answerIndex/);
    expect(reconcileAgentQuiz({ id: "b9", type: "quiz", questions: [tf("t")] }, undefined)).toMatch(/answerBool/);
    expect(reconcileAgentQuiz({ ...prev, questions: [prev.questions[1]] }, prev)).toBeNull();
  });
});

// Third sync review: the old rule ("an answer at or before the last recorded
// one is not counted") dropped an answer given earlier on a device that
// synced later.
describe("answers recorded in any order (third review, finding 8)", () => {
  const morning = "2026-11-12T07:40:00.000Z";
  const evening = "2026-11-12T19:10:00.000Z";
  it("an earlier answer arriving after a later one is still counted, once", () => {
    const q = tf("1", true);
    recordAnswer(q, true, evening); // the laptop saved first
    recordAnswer(q, false, morning); // the phone's answer from the morning arrives
    expect(q.stats).toEqual({ attempts: 2, correct: 1, lastAnsweredAt: evening, recent: [morning, evening] });
    recordAnswer(q, false, morning); // the same edit run again
    recordAnswer(q, true, evening);
    expect(q.stats).toMatchObject({ attempts: 2, correct: 1 });
  });

  it("gives the same stats whichever device saves first", () => {
    const a = tf("1", true);
    const b = tf("1", true);
    recordAnswer(a, false, morning);
    recordAnswer(a, true, evening);
    recordAnswer(b, true, evening);
    recordAnswer(b, false, morning);
    expect(a.stats).toEqual(b.stats);
  });

  it("stats from before answers were logged: the last answer is not counted twice", () => {
    const q = tf("1", true);
    q.stats = { attempts: 3, correct: 2, lastAnsweredAt: evening };
    recordAnswer(q, true, evening);
    expect(q.stats).toEqual({ attempts: 3, correct: 2, lastAnsweredAt: evening });
  });

  it("a run described as data is the same edit when replayed from a draft", () => {
    const block: QuizBlock = { id: "b1", type: "quiz", questions: [tf("1", true)] };
    const d: Workspace = { id: "w", name: "W", pages: [{ id: "p1", title: "P", blocks: [block] }], databases: [] };
    const results = [{ pageId: "p1", blockId: "b1", questionId: "1", correct: true }];
    const replay = runResultsReplay(results, undefined, morning);
    const again = runResultsReplayer(JSON.parse(JSON.stringify(replay.args)));
    expect(again).not.toBeNull();
    again!(d);
    again!(d);
    expect((d.pages[0].blocks[0] as QuizBlock).questions[0].stats).toMatchObject({ attempts: 1, correct: 1 });
    expect(runResultsReplayer({ results: "nope", at: morning })).toBeNull();
    expect(runResultsReplayer({ results: [], at: "not a date" })).toBeNull();
  });
});
