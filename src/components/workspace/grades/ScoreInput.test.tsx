import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PendingFieldsContext, type PendingField } from "../editor/pendingFields";
import { ScoreInput } from "./ScoreInput";

/** A stand-in for the sync engine's field registry. */
function registry() {
  const fields = new Set<PendingField>();
  return {
    fields,
    value: { register: (f: PendingField) => (fields.add(f), () => void fields.delete(f)), rev: 0 },
    pending: () => [...fields].some((f) => f.hasPending()),
    commitAll: () => fields.forEach((f) => f.commit()),
  };
}

function Harness({ reg, accept = () => true }: { reg: ReturnType<typeof registry>; accept?: (t: string) => boolean }) {
  const [score, setScore] = useState("40");
  const onCommit = vi.fn((text: string) => {
    if (!accept(text)) return false;
    setScore(text.trim());
    return true;
  });
  return (
    <PendingFieldsContext.Provider value={reg.value}>
      <ScoreInput value={score} onCommit={onCommit} label="Score" />
      <output aria-label="stored">{score}</output>
    </PendingFieldsContext.Provider>
  );
}

describe("ScoreInput (F12: registered with the sync engine)", () => {
  it("holds typing until Enter or leaving the box, and counts it as pending work", async () => {
    const user = userEvent.setup();
    const reg = registry();
    render(<Harness reg={reg} />);
    const box = screen.getByRole("textbox", { name: "Score" });
    await user.clear(box);
    await user.type(box, "42");
    expect(screen.getByLabelText("stored")).toHaveTextContent("40");
    expect(reg.pending()).toBe(true); // the leave prompt and a tab switch see it

    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("stored")).toHaveTextContent("42");
    expect(reg.pending()).toBe(false);
  });

  it("is written when the engine asks (tab hidden, undo, a merge) without leaving the box", async () => {
    const user = userEvent.setup();
    const reg = registry();
    render(<Harness reg={reg} />);
    const box = screen.getByRole("textbox", { name: "Score" });
    await user.clear(box);
    await user.type(box, "47");
    act(() => reg.commitAll());
    expect(screen.getByLabelText("stored")).toHaveTextContent("47");
    expect(box).toHaveValue("47");
  });

  it("Escape and unreadable text put the stored value back", async () => {
    const user = userEvent.setup();
    const reg = registry();
    render(<Harness reg={reg} accept={(t) => /^\d+$/.test(t.trim())} />);
    const box = screen.getByRole("textbox", { name: "Score" });
    await user.clear(box);
    await user.type(box, "99{Escape}");
    expect(box).toHaveValue("40");
    expect(reg.pending()).toBe(false);

    await user.clear(box);
    await user.type(box, "4x/{Enter}");
    expect(box).toHaveValue("40");
    expect(screen.getByLabelText("stored")).toHaveTextContent("40");
    expect(reg.pending()).toBe(false);
  });
});
