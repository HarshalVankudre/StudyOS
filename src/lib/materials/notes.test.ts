// @vitest-environment node
import { describe, expect, it } from "vitest";
import { recordUsage, withUsageMeter } from "@/lib/ai/usage-meter";
import { planRun } from "./limits";
import { cleanNotes, isCopiedPassage, MAX_NOTES_PER_SECTION, materialRuns, noteSectionsFor, notePages } from "./notes";
import { runStudyKit, type KitComplete } from "./pipeline";
import { KIT_SYSTEM_PROMPT, pageList, sectionUserPrompt } from "./prompt";

// The QA fixture: an eight-page organic chemistry lecture, about 900
// characters a page, one topic a page (page 8 is a recap).
const TOPICS = [
  "Substitution versus elimination",
  "The SN2 mechanism",
  "The SN1 mechanism",
  "Carbocation rearrangements",
  "Leaving groups and nucleophiles",
  "The E2 mechanism",
  "The E1 mechanism",
  "Summary: choosing the mechanism",
];
const SENTENCE =
  "Polar aprotic solvents such as DMSO, DMF and acetone speed up SN2 reactions because they do not hydrogen-bond to the nucleophile and leave it more reactive.";
const LECTURE = TOPICS.map(
  (topic, i) => `${topic}. ${i === 1 ? SENTENCE : ""} ${`Detail ${i + 1} about ${topic.toLowerCase()} explained at length. `.repeat(14)}`,
);

describe("noteSectionsFor", () => {
  it("asks an eight-page lecture for about one section per page, not two", () => {
    const chars = LECTURE.map((p) => p.length);
    expect(chars.every((c) => c > 700 && c < 1500)).toBe(true);
    // Before: Math.round(chars / 4000) asked for 2 sections.
    expect(noteSectionsFor(chars, 1, 8)).toBe(8);
  });

  it("scales with length for long pages and stays within bounds", () => {
    expect(noteSectionsFor([12_000], 1, 1)).toBe(8);
    expect(noteSectionsFor([900], 1, 1)).toBe(1);
    expect(noteSectionsFor([150], 1, 1)).toBe(1);
    expect(noteSectionsFor([0, 0], 1, 2)).toBe(0);
    // Sixty short slides: bounded.
    expect(noteSectionsFor(Array.from({ length: 60 }, () => 250), 1, 60)).toBe(MAX_NOTES_PER_SECTION);
    // Title and picture slides do not count as topics.
    expect(noteSectionsFor([40, 900, 30, 900], 1, 4)).toBe(2);
  });

  it("lists the pages the notes must cover", () => {
    expect(notePages(["Title", "x".repeat(300), "", "y".repeat(500)], 1, 4)).toEqual([2, 4]);
    expect(pageList([1, 2, 3, 5, 7, 8])).toBe("1–3, 5, 7–8");
  });
});

describe("isCopiedPassage", () => {
  const material = materialRuns(LECTURE.join("\n"));

  it("flags a sentence lifted from the material, even re-punctuated or re-cased", () => {
    expect(isCopiedPassage(SENTENCE, material)).toBe(true);
    expect(isCopiedPassage(SENTENCE.toUpperCase().replace(/,/g, ""), material)).toBe(true);
  });

  it("keeps notes in the note's own words, terms and short phrases", () => {
    expect(isCopiedPassage("Polar aprotic solvent: does not solvate the nucleophile, so SN2 runs faster (DMSO, DMF, acetone).", material)).toBe(false);
    expect(isCopiedPassage("The SN2 mechanism", material)).toBe(false);
    expect(isCopiedPassage("Connects to SN1: the opposite solvent preference, because SN1 needs a stabilised carbocation.", material)).toBe(false);
  });

  it("works for scripts without spaces", () => {
    const zh = materialRuns("亲核取代反应用亲核试剂取代sp3碳上的离去基团，带离去基团的碳称为亲电碳或α碳。");
    expect(isCopiedPassage("亲核取代反应用亲核试剂取代sp3碳上的离去基团，带离去基团的碳称为亲电碳。", zh)).toBe(true);
    expect(isCopiedPassage("取代：亲核试剂换掉离去基团；发生在α碳上，与消除反应竞争。", zh)).toBe(false);
  });
});

describe("cleanNotes", () => {
  it("drops copied bullets, drops emptied sections and orders sections by page", () => {
    const { notes, copied } = cleanNotes(
      [
        { heading: "E2", page: 6, points: ["Concerted: base removes a beta H as the leaving group leaves."] },
        { heading: "SN2", page: 2, points: [SENTENCE, "One step with backside attack, so configuration inverts."] },
        { heading: "Copied", page: 3, points: [SENTENCE] },
      ],
      LECTURE,
      { from: 1, to: 8 },
    );
    expect(copied).toBe(2);
    expect(notes.map((n) => n.heading)).toEqual(["SN2", "E2"]);
    expect(notes[0].points).toEqual(["One step with backside attack, so configuration inverts."]);
  });
});

describe("study-note prompt contract", () => {
  it("asks for study notes covering every page, in own words, with key terms and connections", () => {
    expect(KIT_SYSTEM_PROMPT).toMatch(/WHOLE of the given pages section by section/);
    expect(KIT_SYSTEM_PROMPT).toMatch(/middle pages matter/i);
    expect(KIT_SYSTEM_PROMPT).toMatch(/key terms/);
    expect(KIT_SYSTEM_PROMPT).toMatch(/connects to another topic/);
    expect(KIT_SYSTEM_PROMPT).toMatch(/Never copy a sentence or a passage/);
    // The old wording that produced near-verbatim notes is gone.
    expect(KIT_SYSTEM_PROMPT).not.toMatch(/briefly but completely/);
  });

  it("names the count and the pages to cover in the section prompt", () => {
    const user = sectionUserPrompt({
      title: "chem210-lecture7",
      pages: LECTURE,
      from: 1,
      to: 8,
      index: 0,
      total: 1,
      notes: 8,
      notePages: [1, 2, 3, 4, 5, 6, 7, 8],
      cards: 20,
      questions: 10,
      language: null,
      nonce: "abc",
    });
    expect(user).toContain("- notes: about 8 sections of study notes in your own words, together covering every one of pages 1–8 in order");
  });

  it("asks for no notes when they were not wanted", () => {
    const user = sectionUserPrompt({
      title: "t", pages: LECTURE, from: 1, to: 2, index: 0, total: 1,
      notes: 0, cards: 3, questions: 0, language: null, nonce: "abc",
    });
    expect(user).toContain("- notes: none (empty array)");
  });
});

describe("runStudyKit notes", () => {
  it("asks one section call for notes on every page and keeps only own-words bullets, in page order", async () => {
    const plan = planRun(LECTURE.map((p) => p.length));
    expect(plan.sections).toHaveLength(1);
    let asked = "";
    const complete: KitComplete = async (_system, user) => {
      asked = user;
      recordUsage({ prompt_tokens: 100, completion_tokens: 100 });
      return JSON.stringify({
        notes: [
          { heading: "Recap", page: 8, points: ["Substrate class decides: tertiary never SN2."] },
          ...TOPICS.slice(0, 7).map((topic, i) => ({
            heading: topic,
            page: i + 1,
            points: [i === 1 ? SENTENCE : `${topic}: key idea ${i + 1} in short.`, `Connects to topic ${i + 2}.`],
          })),
        ],
        cards: [],
        questions: [],
      });
    };
    const { result } = await withUsageMeter(() =>
      runStudyKit({
        material: { id: "m", title: "chem210-lecture7", pages: LECTURE },
        plan,
        outputs: { notes: true, flashcards: false, quiz: false },
        amount: "standard",
        language: null,
        complete,
        nonce: "n",
      }),
    );
    expect(asked).toContain("about 8 sections");
    expect(asked).toContain("pages 1–8 in order");
    expect(result.notes.map((n) => n.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.notes[1].points).toEqual(["Connects to topic 3."]);
    expect(result.stats.copiedNotePoints).toBe(1);
  });
});

describe("parseSectionReply notes", () => {
  it("turns key terms and the connection into bullets, safely", async () => {
    const { parseSectionReply } = await import("./parse");
    const parsed = parseSectionReply(
      JSON.stringify({
        notes: [
          {
            heading: "SN1",
            page: 3,
            points: ["Two steps; the slow one makes a carbocation, so rate = k[substrate]."],
            terms: [
              { term: "**carbocation**", meaning: "planar sp2 cation; attacked from either face" },
              { term: "", meaning: "dropped" },
              "not a term",
            ],
            connection: "Contrasts with SN2, which is one concerted step [see](https://evil.example).",
          },
        ],
        cards: [],
        questions: [],
      }),
      { notes: 4, cards: 0, questions: 0 },
    );
    expect(parsed.notes[0].points).toEqual([
      "Two steps; the slow one makes a carbocation, so rate = k[substrate].",
      "**carbocation**: planar sp2 cation; attacked from either face",
      "↔ Contrasts with SN2, which is one concerted step see.",
    ]);
  });
});
