// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { recordUsage, withUsageMeter } from "@/lib/ai/usage-meter";
import { pageSchema } from "@/lib/workspace/schema";
import { buildKitPage } from "./kit";
import { planRun } from "./limits";
import { KitCancelledError, KitFailedError, runStudyKit, shuffleChoices, type KitComplete } from "./pipeline";
import type { KitEvent } from "./types";

// Twelve pages, each with two distinct, quotable facts about a different subject.
const NAMES = ["hexokinase", "aldolase", "enolase", "citrate", "fumarase", "lipase", "amylase", "pepsin", "trypsin", "catalase", "urease", "kinase"];
const PAGES = NAMES.map(
  (name, i) =>
    `Topic ${i + 1}. The enzyme ${name} catalyses reaction ${i + 1} in the pathway of chapter ${i + 1}. Molecule ${name}ol binds receptor ${name}in only when the pH is above ${i + 1}.`,
);
const MATERIAL = { id: "mat-1", title: "Biochem lecture", pages: PAGES };
// Plan as if each page were a dense 2,000-character page: three sections of
// four pages, so the test exercises balancing across sections.
const PLAN = planRun(
  PAGES.map(() => 2000),
  undefined,
  { target: 8000 },
);

function pagesIn(user: string): number[] {
  return [...user.matchAll(/\[\[page (\d+)\]\]/g)].map((m) => Number(m[1]));
}

/** A fake model: verifiable cards and questions for every page it is shown, plus one fabricated item. */
function fakeModel(options: { usage?: number } = {}): KitComplete {
  return async (_system, user) => {
    recordUsage({ prompt_tokens: options.usage ?? 1000, completion_tokens: 500 });
    const pages = pagesIn(user);
    return JSON.stringify({
      notes: [{ heading: `Pages ${pages[0]}-${pages.at(-1)}`, page: pages[0], points: ["Enzymes catalyse reactions."] }],
      cards: [
        ...pages.flatMap((n) => {
          const name = NAMES[n - 1];
          return [
            { front: `Which reaction does ${name} catalyse?`, back: `Reaction ${n}`, page: n, quote: `The enzyme ${name} catalyses reaction ${n} in the pathway` },
            { front: `When does ${name}ol bind its receptor?`, back: `When the pH is above ${n}`, page: n, quote: `Molecule ${name}ol binds receptor ${name}in only when the pH is above ${n}` },
          ];
        }),
        // Invented: not in the material.
        { front: "What is the Michaelis constant?", back: "Km", page: pages[0], quote: "The Michaelis constant is the substrate concentration at half Vmax" },
        // Near miss: one word changed.
        { front: `Does ${NAMES[pages[0] - 1]} inhibit anything?`, back: "No", page: pages[0], quote: `The enzyme ${NAMES[pages[0] - 1]} inhibits reaction ${pages[0]} in the pathway` },
      ],
      questions: pages.map((n) => ({
        kind: "mcq",
        prompt: `Above which pH does ${NAMES[n - 1]}ol bind receptor ${NAMES[n - 1]}in?`,
        choices: [`${n}`, `${n + 20}`, `${n + 40}`, `${n + 60}`],
        answerIndex: 0,
        explanation: "Stated on the slide.",
        topic: "Binding",
        page: n,
        quote: `Molecule ${NAMES[n - 1]}ol binds receptor ${NAMES[n - 1]}in only when the pH is above ${n}`,
      })),
    });
  };
}

const base = {
  material: MATERIAL,
  plan: PLAN,
  outputs: { notes: true, flashcards: true, quiz: true },
  amount: "standard" as const,
  language: null,
  nonce: "test",
};

describe("runStudyKit", () => {
  it("keeps only verified items, each citing the page its quote is on", async () => {
    const { result } = await withUsageMeter(() => runStudyKit({ ...base, complete: fakeModel() }));
    expect(PLAN.sections).toHaveLength(3);
    expect(result.cards.length).toBeGreaterThan(0);
    for (const item of [...result.cards, ...result.questions]) {
      const source = item.source!;
      expect(source.materialId).toBe("mat-1");
      expect(PAGES[source.page! - 1].replace(/\s+/g, " ")).toContain(source.quote);
    }
    expect(result.cards.some((c) => c.front.includes("Michaelis"))).toBe(false);
    expect(result.cards.some((c) => c.front.includes("inhibit"))).toBe(false);
    expect(result.stats.unverified).toBe(6); // 2 per section
  });

  it("balances the kit across the whole document instead of its first pages", async () => {
    const { result } = await withUsageMeter(() => runStudyKit({ ...base, amount: "few", complete: fakeModel() }));
    const sectionOf = (page: number) => PLAN.sections.findIndex((s) => page >= s.from && page <= s.to);
    const perSection = [0, 1, 2].map((s) => result.cards.filter((c) => sectionOf(c.source.page!) === s).length);
    expect(perSection.every((n) => n >= 3)).toBe(true);
    expect(Math.max(...perSection) - Math.min(...perSection)).toBeLessThanOrEqual(1);
    // Document order.
    const pages = result.cards.map((c) => c.source.page!);
    expect([...pages].sort((a, b) => a - b)).toEqual(pages);
  });

  it("retries an unreadable reply once, without billing the failed attempt", async () => {
    let calls = 0;
    const good = fakeModel({ usage: 1000 });
    const complete: KitComplete = async (system, user, options) => {
      calls += 1;
      if (calls === 1) {
        recordUsage({ prompt_tokens: 99_999, completion_tokens: 0 });
        return "Sorry, I can't produce JSON right now.";
      }
      return good(system, user, options);
    };
    const { result, usage } = await withUsageMeter(() =>
      runStudyKit({ ...base, plan: planRun([PAGES[0].length]), material: { ...MATERIAL, pages: [PAGES[0]] }, complete }),
    );
    expect(calls).toBe(2);
    expect(result.cards.length).toBeGreaterThan(0);
    expect(usage.promptTokens).toBe(1000);
  });

  it("skips a section that keeps failing, reports its pages, and keeps the rest", async () => {
    const good = fakeModel();
    const events: KitEvent[] = [];
    const complete: KitComplete = async (system, user, options) => {
      if (pagesIn(user).includes(5)) throw new Error("OpenRouter request failed (503): overloaded");
      return good(system, user, options);
    };
    const { result } = await withUsageMeter(() =>
      runStudyKit({ ...base, complete, onEvent: (e) => events.push(e) }),
    );
    expect(result.stats.failedSections).toBe(1);
    expect(result.stats.failedRanges).toEqual([{ from: 5, to: 8 }]);
    expect(events.filter((e) => e.type === "section" && e.status === "retrying")).toHaveLength(1);
    expect(events.some((e) => e.type === "section" && e.status === "failed")).toBe(true);
  });

  it("fails honestly, billing nothing, when no section produced anything usable", async () => {
    const complete: KitComplete = async () => {
      recordUsage({ prompt_tokens: 5000, completion_tokens: 5000 });
      return JSON.stringify({
        cards: [{ front: "Q?", back: "A", page: 1, quote: "Completely invented sentence that is not on any page" }],
      });
    };
    const metered = await withUsageMeter(async () => {
      try {
        await runStudyKit({ ...base, outputs: { notes: false, flashcards: true, quiz: false }, complete });
        return null;
      } catch (error) {
        return error;
      }
    });
    expect(metered.result).toBeInstanceOf(KitFailedError);
    expect(metered.usage).toMatchObject({ promptTokens: 0, completionTokens: 0 });
  });

  it("does not retry a refusal-like client error (4xx)", async () => {
    const complete = vi.fn<KitComplete>(async () => {
      throw new Error("OpenRouter request failed (400): bad request");
    });
    await expect(
      withUsageMeter(() => runStudyKit({ ...base, plan: planRun([PAGES[0].length]), material: { ...MATERIAL, pages: [PAGES[0]] }, complete })),
    ).rejects.toBeInstanceOf(KitFailedError);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("cancel aborts in-flight calls, starts no new ones, and reports only consumed tokens", async () => {
    const controller = new AbortController();
    let started = 0;
    const complete: KitComplete = async (_system, _user, { signal }) => {
      started += 1;
      const aborted = new Promise((resolve) => signal.addEventListener("abort", resolve));
      if (started === 2) setTimeout(() => controller.abort(), 0);
      await aborted;
      recordUsage({ prompt_tokens: 300, completion_tokens: 0 });
      throw new Error("aborted");
    };
    const metered = await withUsageMeter(async () => {
      try {
        await runStudyKit({ ...base, complete, signal: controller.signal, concurrency: 2 });
        return null;
      } catch (error) {
        return error;
      }
    });
    expect(metered.result).toBeInstanceOf(KitCancelledError);
    expect(started).toBe(2); // The third section never started.
    expect(metered.usage.promptTokens).toBe(600);
  });

  it("shuffles multiple-choice positions without losing the right answer", async () => {
    const shuffled = shuffleChoices(["right", "b", "c", "d"], 0, () => 0.99);
    expect(shuffled.choices[shuffled.answerIndex]).toBe("right");
    const { result } = await withUsageMeter(() => runStudyKit({ ...base, complete: fakeModel() }));
    for (const q of result.questions) {
      // The fake model's right answer is the pH number itself.
      expect(q.choices![q.answerIndex!]).toBe(String(q.source!.page));
    }
    expect(new Set(result.questions.map((q) => q.answerIndex)).size).toBeGreaterThan(1);
  });

  it("builds a page whose blocks are valid workspace blocks", async () => {
    const { result } = await withUsageMeter(() => runStudyKit({ ...base, complete: fakeModel() }));
    let n = 0;
    const page = buildKitPage(
      result,
      {
        pageTitle: "{title} · study kit",
        summary: "{cards} cards, {questions} questions from {title}, {range}",
        summaryNotesOnly: "Notes from {title}",
        pagesRange: "pages {from}–{to}",
        notesHeading: "Notes",
        flashcardsHeading: "Flashcards",
        quizHeading: "Quiz",
      },
      () => `id-${(n += 1)}`,
    );
    expect(pageSchema.safeParse(page).success).toBe(true);
    expect(page.blocks.map((b) => b.type)).toEqual(
      expect.arrayContaining(["callout", "heading", "bulleted_list_item", "flashcards", "quiz"]),
    );
    expect(page.title).toBe("Biochem lecture · study kit");
  });
});
