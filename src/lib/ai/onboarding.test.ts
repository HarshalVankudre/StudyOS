import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import {
  answeredByDescription,
  clipText,
  defaultQuestions,
  normalizeGenQuestions,
  oneEmoji,
  QUESTION_LIMITS,
} from "./onboarding";

describe("clipText", () => {
  it("keeps short text and trims long text at a word, with an ellipsis", () => {
    expect(clipText("  Short   text ", 20)).toBe("Short text");
    const clipped = clipText("Which of your four courses has the most weekly reading assignments?", 40);
    expect(clipped.length).toBeLessThanOrEqual(40);
    expect(clipped).toBe("Which of your four courses has the most…");
  });
});

describe("oneEmoji", () => {
  it("keeps one emoji, including joined ones, and rejects letters", () => {
    expect(oneEmoji("🧪")).toBe("🧪");
    expect(oneEmoji("👩‍⚕️ nurse")).toBe("👩‍⚕️");
    expect(oneEmoji("🧪📚")).toBe("🧪");
    expect(oneEmoji("A")).toBe("");
    expect(oneEmoji(undefined)).toBe("");
  });
});

describe("normalizeGenQuestions", () => {
  it("repairs a reply instead of rejecting it", () => {
    const longQuestion = `How do you usually plan ${"your study week ".repeat(20)}?`;
    const questions = normalizeGenQuestions({
      questions: [
        {
          // No id, an unknown type, a very long question, string options,
          // a duplicate and an empty option.
          question: longQuestion,
          type: "dropdown",
          options: ["Calendar", "Weekly list", "calendar", "", { label: "Board", emoji: "📋📋" }],
        },
        {
          id: "Load!",
          question: "Course load?",
          type: "multi",
          options: [
            { id: "a", label: "Three courses and a lab section that meets on most Fridays", emoji: "🌿" },
            { id: "a", label: "Five", emoji: "x" },
          ],
        },
        { question: "Only one option", options: ["Yes"] },
        "not a question",
      ],
    });
    expect(questions).toHaveLength(2);
    const [first, second] = questions;
    expect(first.id).toBe("q1");
    expect(first.type).toBe("single");
    expect(first.question.length).toBeLessThanOrEqual(QUESTION_LIMITS.questionChars);
    expect(first.options.map((o) => o.label)).toEqual(["Calendar", "Weekly list", "Board"]);
    expect(first.options[2].emoji).toBe("📋");
    expect(second.id).toBe("load");
    expect(second.type).toBe("multi");
    expect(second.options[0].label.length).toBeLessThanOrEqual(QUESTION_LIMITS.labelChars);
    expect(second.options.map((o) => o.id)).toEqual(["a", "a-2"]);
    expect(second.options[1]).not.toHaveProperty("emoji");
  });

  it("keeps at most four questions of six options", () => {
    const options = Array.from({ length: 9 }, (_, i) => ({ label: `Option ${i}` }));
    const questions = normalizeGenQuestions({
      questions: Array.from({ length: 7 }, (_, i) => ({ question: `Q${i}?`, options })),
    });
    expect(questions).toHaveLength(QUESTION_LIMITS.questions);
    expect(questions.every((q) => q.options.length === QUESTION_LIMITS.options)).toBe(true);
  });

  it("returns nothing for output that has no usable question", () => {
    expect(normalizeGenQuestions(null)).toEqual([]);
    expect(normalizeGenQuestions({ questions: [] })).toEqual([]);
    expect(normalizeGenQuestions({ text: "Sorry" })).toEqual([]);
  });
});

describe("normalizeGenQuestions: other reply shapes", () => {
  it("accepts text/choices keys, multiSelect flags and wrapped lists", () => {
    const questions = normalizeGenQuestions({
      data: {
        questions: [
          { text: "Which course needs most practice?", multiSelect: true, choices: [{ text: "Micro" }, { name: "Art" }] },
          { title: "How do you plan?", type: "multiple-choice", answers: ["🗓️ Calendar", "📋 Board"] },
        ],
      },
    });
    expect(questions.map((q) => q.question)).toEqual(["Which course needs most practice?", "How do you plan?"]);
    expect(questions[0].type).toBe("multi");
    expect(questions[0].options.map((o) => o.label)).toEqual(["Micro", "Art"]);
    // An emoji written into the label moves to the icon.
    expect(questions[1].options).toEqual([
      { id: "calendar", label: "Calendar", emoji: "🗓️" },
      { id: "board", label: "Board", emoji: "📋" },
    ]);
  });

  it("accepts a single bare question and an unnamed list key", () => {
    expect(normalizeGenQuestions({ question: "Level?", options: ["A", "B"] })).toHaveLength(1);
    expect(normalizeGenQuestions({ qs: [{ question: "Level?", options: ["A", "B"] }] })).toHaveLength(1);
  });

  it("salvages complete questions from a reply that was cut off or wrapped in prose", () => {
    const cut =
      'Here you go:\n```json\n{"questions":[{"id":"a","question":"Lab or lecture?","type":"single","options":[{"label":"Lab"},{"label":"Lecture"}]},' +
      '{"id":"b","question":"Exam soon?","options":[{"label":"Yes"},{"label":"No"}]},{"id":"c","question":"Trunc';
    const questions = normalizeGenQuestions(cut);
    expect(questions.map((q) => q.id)).toEqual(["a", "b"]);
  });

  it("parses a reply that is a complete JSON string", () => {
    expect(normalizeGenQuestions('{"questions":[{"question":"Q?","options":["x","y"]}]}')).toHaveLength(1);
    expect(normalizeGenQuestions("Sorry, I can't help with that.")).toEqual([]);
  });
});

describe("answeredByDescription", () => {
  const qa = [
    {
      // QA run 2, description 1
      text: "I'm a 2nd-year chemistry student taking Organic Chemistry I (CHEM 210) and Linear Algebra (MATH 221) this semester. I want to track deadlines and grades and study for my finals.",
      answered: ["level", "load", "track"],
    },
    {
      // QA run 2, description 2: the fallback asked how many courses after two were named
      text: "I'm taking Intro Microeconomics and Renaissance Art History this semester.",
      answered: ["load"],
    },
    {
      // QA run 2, description 3 (Arabic dual "two courses", second year, faculty)
      text: "أدرس هذا الفصل مقررين: الكيمياء الحيوية والإحصاء الحيوي في السنة الثانية من كلية الصيدلة.",
      answered: ["level", "load"],
    },
  ];
  for (const { text, answered } of qa) {
    it(`reads ${answered.join(", ")} from "${text.slice(0, 40)}…"`, () => {
      expect([...answeredByDescription(text)].sort()).toEqual([...answered].sort());
    });
  }

  it("reads course counts and levels in other languages", () => {
    expect(answeredByDescription("Ich belege drei Kurse im 3. Semester").has("load")).toBe(true);
    expect(answeredByDescription("Ich belege drei Kurse im 3. Semester").has("level")).toBe(true);
    expect(answeredByDescription("Je suis en deuxième année, quatre matières").has("load")).toBe(true);
    expect(answeredByDescription("Je suis en deuxième année à l'université").has("level")).toBe(true);
    expect(answeredByDescription("Sono al primo anno di università").has("level")).toBe(true);
    expect(answeredByDescription("大二学生，这学期有四门课").has("load")).toBe(true);
    expect(answeredByDescription("大二学生，这学期有四门课").has("level")).toBe(true);
    expect(answeredByDescription("大学2年生で、5科目を履修しています").has("load")).toBe(true);
    expect(answeredByDescription("Estoy cursando Cálculo y Física").has("load")).toBe(true);
    expect(answeredByDescription("أدرس ثلاثة مقررات").has("load")).toBe(true);
  });

  it("stays conservative when the description does not say", () => {
    expect([...answeredByDescription("I study biology")]).toEqual([]);
    expect([...answeredByDescription("I'm studying computer science and economics")]).toEqual([]);
    expect(answeredByDescription("Help me with my CHEM 210 lab").has("load")).toBe(false);
    expect(answeredByDescription("I want to track deadlines").has("track")).toBe(false);
    expect(answeredByDescription("").size).toBe(0);
  });

  it("detects a planning style", () => {
    expect(answeredByDescription("I like a Kanban board for my tasks").has("style")).toBe(true);
    expect(answeredByDescription("Ich plane alles im Kalender").has("style")).toBe(true);
  });
});

describe("defaultQuestions", () => {
  it("asks everything when there is no description", () => {
    expect(defaultQuestions(en.onboarding).map((q) => q.id)).toEqual(["level", "load", "track", "style"]);
  });

  it("leaves out what the description already answers", () => {
    const ids = defaultQuestions(
      en.onboarding,
      "I'm taking Intro Microeconomics and Renaissance Art History this semester.",
    ).map((q) => q.id);
    expect(ids).toEqual(["level", "track", "style"]);
  });

  it("always keeps at least one question", () => {
    const ids = defaultQuestions(
      en.onboarding,
      "2nd-year student, 4 courses, I want to track homework and exams on a calendar",
    ).map((q) => q.id);
    expect(ids).toEqual(["track"]);
  });
});
