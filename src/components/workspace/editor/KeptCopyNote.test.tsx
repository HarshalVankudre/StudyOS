import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";

const state = vi.hoisted(() => ({ doc: null as Workspace | null }));
vi.mock("../WorkspaceContext", () => ({
  useWorkspace: () => ({
    update: (fn: (d: Workspace) => void) => {
      const d = structuredClone(state.doc!);
      fn(d);
      state.doc = d;
    },
  }),
}));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { useI18n: () => ({ dict: en }) };
});

import { en } from "@/lib/i18n/dictionaries/en";
import { KeptCopyNote } from "./KeptCopyNote";

const S = en.safety;

function doc(): Workspace {
  return {
    id: "w1",
    name: "W",
    pages: [
      {
        id: "p1",
        title: "Home",
        blocks: [
          { id: "b1", type: "paragraph", text: "mine" },
          { id: "k", type: "paragraph", text: "theirs", keptFrom: "b1" },
        ],
      },
    ],
    databases: [],
  };
}
const blocks = () => state.doc!.pages[0].blocks.map((b) => [b.id, (b as { text?: string }).text, (b as { keptFrom?: string }).keptFrom]);

describe("KeptCopyNote (browser QA: say it where it happened)", () => {
  it("says what the marked block is, in place", () => {
    state.doc = doc();
    render(<KeptCopyNote pageId="p1" blockId="k" keptFrom="b1" />);
    expect(screen.getByRole("note")).toHaveTextContent(S.keptCopyNote);
  });

  it("Use this version: its text replaces the other and the copy goes", async () => {
    state.doc = doc();
    render(<KeptCopyNote pageId="p1" blockId="k" keptFrom="b1" />);
    await userEvent.click(screen.getByRole("button", { name: S.keptCopyUse }));
    expect(blocks()).toEqual([["b1", "theirs", undefined]]);
  });

  it("Keep both: two ordinary blocks", async () => {
    state.doc = doc();
    render(<KeptCopyNote pageId="p1" blockId="k" keptFrom="b1" />);
    await userEvent.click(screen.getByRole("button", { name: S.keptCopyKeepBoth }));
    expect(blocks()).toEqual([
      ["b1", "mine", undefined],
      ["k", "theirs", undefined],
    ]);
  });

  it("Discard: the copy goes", async () => {
    state.doc = doc();
    render(<KeptCopyNote pageId="p1" blockId="k" keptFrom="b1" />);
    await userEvent.click(screen.getByRole("button", { name: S.keptCopyDiscard }));
    expect(blocks()).toEqual([["b1", "mine", undefined]]);
  });
});
