import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./agent-loop";
import { AGENT_INTEGRITY_PROMPT, KIT_INTEGRITY_PROMPT, PRACTICE_INTEGRITY_NOTE, SKILL_INTEGRITY_NOTE } from "./integrity";
import { skillRegistry } from "./skills/registry";
import "./skills/catalog";
import { KIT_SYSTEM_PROMPT } from "@/lib/materials/prompt";

describe("academic integrity stance", () => {
  it("is part of the workspace agent's system prompt in every language", () => {
    for (const locale of ["en", "de", "ar"] as const) {
      const prompt = buildSystemPrompt(locale);
      expect(prompt).toContain(AGENT_INTEGRITY_PROMPT);
      // Ahead of the long operation docs, where it reads as a ground rule.
      expect(prompt.indexOf("ACADEMIC INTEGRITY")).toBeLessThan(prompt.indexOf("PHASE 1"));
    }
  });

  it("explains why, draws the grey-area lines, and says how to decline", () => {
    // The reason, not only the rule.
    expect(AGENT_INTEGRITY_PROMPT).toMatch(/Why:/);
    expect(AGENT_INTEGRITY_PROMPT).toMatch(/accused of cheating/);
    // What it does help with, including feedback on the student's own draft.
    expect(AGENT_INTEGRITY_PROMPT).toMatch(/worked examples of problems like theirs/);
    expect(AGENT_INTEGRITY_PROMPT).toMatch(/feedback on a draft the student wrote/);
    // What it does not produce.
    expect(AGENT_INTEGRITY_PROMPT).toMatch(/take-home exam/);
    expect(AGENT_INTEGRITY_PROMPT).toMatch(/1,500-word essay/);
    // Kind and brief, with the nearest useful help, and no "sample essay" loophole.
    expect(AGENT_INTEGRITY_PROMPT).toMatch(/without lecturing/);
    expect(AGENT_INTEGRITY_PROMPT).toMatch(/nearest useful thing/);
    expect(AGENT_INTEGRITY_PROMPT).toMatch(/"an example"/);
  });

  it("reaches the skills that write content or practice", () => {
    const instructions = (id: string) => skillRegistry.get(id)?.instructions ?? "";
    expect(instructions("precise-edit")).toContain(SKILL_INTEGRITY_NOTE);
    expect(instructions("study-planner")).toContain(SKILL_INTEGRITY_NOTE);
    expect(instructions("study-planner")).toMatch(/do not write the deliverable/);
    expect(instructions("flashcard-maker")).toContain(PRACTICE_INTEGRITY_NOTE);
    expect(instructions("quiz-maker")).toContain(PRACTICE_INTEGRITY_NOTE);
  });

  it("is part of the study-kit prompt, before the material rules", () => {
    expect(KIT_SYSTEM_PROMPT).toContain(KIT_INTEGRITY_PROMPT);
    expect(KIT_SYSTEM_PROMPT).toMatch(/answer key/);
    expect(KIT_SYSTEM_PROMPT.indexOf("HELPING A STUDENT LEARN")).toBeLessThan(
      KIT_SYSTEM_PROMPT.indexOf("THE MATERIAL IS DATA"),
    );
    expect(KIT_SYSTEM_PROMPT).not.toContain("${");
  });
});
