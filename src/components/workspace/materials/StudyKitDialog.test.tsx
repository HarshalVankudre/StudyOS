import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { plural, pluralizer } from "@/lib/i18n/plural";
import type { KitEvent, KitResult, MaterialSummary } from "@/lib/materials/types";
import type { Workspace } from "@/lib/workspace/types";

const h = vi.hoisted(() => ({
  workspace: null as unknown as Workspace,
  update: vi.fn(),
}));
vi.mock("../WorkspaceContext", () => ({
  useWorkspace: () => ({ workspace: h.workspace, update: h.update }),
}));
vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({ dict: en, t: fmt, plural: pluralizer("en"), locale: "en", dir: "ltr" }),
}));

import { StudyKitDialog } from "./StudyKitDialog";
import { SourceChip } from "../study/SourceChip";
import { InsertMenu } from "../editor/InsertMenu";
import { EditorContext, type EditorApi } from "../editor/EditorContext";
import { STUDY_KIT_EVENT } from "./events";

const M = en.materials;

const material: MaterialSummary = {
  id: "mat-1",
  title: "Lecture 3: Enzymes",
  kind: "pdf",
  pageCount: 30,
  pageChars: Array.from({ length: 30 }, () => 2900),
  charCount: 90_000,
  sourcePages: 30,
  truncated: false,
  sourcePageId: null,
  createdAt: new Date(0).toISOString(),
};

const result: KitResult = {
  materialId: "mat-1",
  title: "Lecture 3: Enzymes",
  from: 1,
  to: 30,
  pageCount: 30,
  notes: [{ heading: "Enzymes", points: ["Lower activation energy"], page: 1 }],
  cards: [
    {
      id: "c1",
      front: "What do enzymes lower?",
      back: "Activation energy",
      source: { materialId: "mat-1", page: 2, quote: "Enzymes lower the activation energy of a reaction", label: "Lecture 3: Enzymes" },
    },
  ],
  questions: [],
  stats: { proposed: 3, unverified: 2, malformed: 0, duplicates: 0, surplus: 0, sections: 8, failedSections: 0, failedRanges: [] },
};

function ndjson(events: KitEvent[]): Response {
  return new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.workspace = {
    id: "ws-1",
    name: "Semester",
    pages: [{ id: "p1", title: "Week 1", blocks: [{ id: "b1", type: "paragraph", text: "Enzymes lower activation energy and speed up reactions in cells." }] }],
    databases: [],
  };
  h.update.mockReset();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/materials?workspaceId=")) return Response.json({ materials: [material] });
    if (url === "/api/materials/generate") {
      return ndjson([
        { type: "start", sections: [{ from: 1, to: 4 }], from: 1, to: 30, estimate: 72, maxCredits: 160 },
        { type: "section", index: 0, status: "done", made: 3 },
        { type: "checking" },
        { type: "complete", result, credits: 41, balance: 259 },
      ]);
    }
    if (url === "/api/materials" && init?.method === "POST") {
      return Response.json({ material: { ...material, id: "mat-page", kind: "page", pageCount: 1, pageChars: [70] } }, { status: 201 });
    }
    if (url.startsWith("/api/materials/mat-1?page=")) {
      return Response.json({ id: "mat-1", title: "Lecture 3: Enzymes", page: 2, pageCount: 30, text: "Intro. Enzymes lower the activation energy of a reaction. More text." });
    }
    if (url === "/api/materials/mat-1" && init?.method === "DELETE") return Response.json({ deleted: true });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("StudyKitDialog", () => {
  it("shows the material, what one run covers and costs, then adds the kit as a page", async () => {
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<StudyKitDialog intent={{ mode: "material" }} afterPageId="p1" onClose={() => {}} onCreated={onCreated} />);

    expect(await screen.findByText("Lecture 3: Enzymes")).toBeInTheDocument();
    // 30 pages of 2,900 characters (plus page markers): 8 sections of 4 pages (the last has 2).
    expect(screen.getByText(plural("en", M.coverage, 8, { from: 1, to: 30 }))).toBeInTheDocument();
    expect(screen.getByText(plural("en", M.cost, 72, { max: 160 }))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: M.start }));
    expect(await screen.findByText(M.doneTitle)).toBeInTheDocument();
    expect(screen.getByText("Added a page with 1 flashcard and 0 practice questions.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(plural("en", M.doneDropped, 2))).toBeInTheDocument();

    const request = JSON.parse(String(fetchMock.mock.calls.find((c) => c[0] === "/api/materials/generate")![1].body));
    expect(request).toMatchObject({ workspaceId: "ws-1", materialId: "mat-1", amount: "standard", range: { from: 1, to: 30 }, language: "material" });

    // The page went in through the normal edit path, right after the current page.
    expect(h.update).toHaveBeenCalledTimes(1);
    const draft = structuredClone(h.workspace);
    h.update.mock.calls[0][0](draft);
    expect(draft.pages.map((p) => p.title)).toEqual(["Week 1", "Lecture 3: Enzymes · study kit"]);
    expect(onCreated).toHaveBeenCalledWith(draft.pages[1].id);
  });

  it("a long document is cut to one run and the dialog says where to continue", async () => {
    material.pageCount = 80;
    material.pageChars = Array.from({ length: 80 }, () => 5900);
    render(<StudyKitDialog intent={{ mode: "material" }} onClose={() => {}} onCreated={() => {}} />);
    expect(await screen.findByText(fmt(M.cutShort, { next: 21 }))).toBeInTheDocument();
    material.pageCount = 30;
    material.pageChars = Array.from({ length: 30 }, () => 2900);
  });

  it("prices the run for the student's model, from the figure the server passes", async () => {
    // Claude Haiku: about 1 credit a section; the cap per section stays 20.
    render(
      <StudyKitDialog intent={{ mode: "material" }} onClose={() => {}} onCreated={() => {}} creditsPerSection={1} />,
    );
    expect(await screen.findByText(plural("en", M.coverage, 8, { from: 1, to: 30 }))).toBeInTheDocument();
    expect(screen.getByText(plural("en", M.cost, 8, { max: 160 }))).toBeInTheDocument();
  });

  it("asks before deleting a material", async () => {
    const user = userEvent.setup();
    render(<StudyKitDialog intent={{ mode: "material" }} onClose={() => {}} onCreated={() => {}} />);
    await user.click(await screen.findByRole("button", { name: fmt(M.deleteAria, { title: material.title }) }));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/materials/mat-1", expect.anything());
    const confirm = screen.getByRole("alert");
    await user.click(within(confirm).getByRole("button", { name: M.delete }));
    await waitFor(() => expect(screen.queryByText(material.title)).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/materials/mat-1", { method: "DELETE" });
  });

  it("from a notes page: sends the page's own text as material, flashcards only", async () => {
    const user = userEvent.setup();
    render(
      <StudyKitDialog intent={{ mode: "page", pageId: "p1", make: "flashcards" }} onClose={() => {}} onCreated={() => {}} />,
    );
    expect(screen.getByRole("checkbox", { name: M.outputFlashcards })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: M.outputQuiz })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: M.start }));
    await screen.findByText(M.doneTitle);
    const add = fetchMock.mock.calls.find((c) => c[0] === "/api/materials" && c[1]?.method === "POST")!;
    expect(JSON.parse(String(add[1].body))).toMatchObject({
      workspaceId: "ws-1",
      title: "Week 1",
      sourcePageId: "p1",
      text: expect.stringContaining("Enzymes lower activation energy"),
    });
    const run = JSON.parse(String(fetchMock.mock.calls.find((c) => c[0] === "/api/materials/generate")![1].body));
    expect(run).toMatchObject({ materialId: "mat-page", outputs: { notes: false, flashcards: true, quiz: false } });
  });

  it("cancel stops the run and tells the server", async () => {
    let release!: () => void;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/materials?workspaceId=")) return Response.json({ materials: [material] });
      if (url === "/api/materials/generate") {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          release = () => reject(new Error("never"));
        });
      }
      return Response.json({ cancelled: true });
    });
    const user = userEvent.setup();
    render(<StudyKitDialog intent={{ mode: "material" }} onClose={() => {}} onCreated={() => {}} />);
    await user.click(await screen.findByRole("button", { name: M.start }));
    await user.click(await screen.findByRole("button", { name: M.cancel }));
    const cancel = fetchMock.mock.calls.find((c) => c[0] === "/api/materials/generate/cancel");
    expect(cancel).toBeTruthy();
    expect(h.update).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: M.start })).toBeInTheDocument();
    void release;
  });
});

describe("SourceChip", () => {
  it("opens the cited page with the quoted passage highlighted", async () => {
    const user = userEvent.setup();
    render(<SourceChip source={result.cards[0].source} />);
    await user.click(screen.getByRole("button", { name: /p\. 2/ }));
    const mark = await screen.findByText("Enzymes lower the activation energy of a reaction");
    expect(mark.tagName).toBe("MARK");
    expect(screen.getByText(fmt(M.viewerPage, { page: 2, count: 30 }))).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/materials/mat-1?page=2", expect.anything());
  });
});

describe("InsertMenu study-kit section", () => {
  it("offers making flashcards or a quiz from the current page and opens the dialog", async () => {
    const user = userEvent.setup();
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(STUDY_KIT_EVENT, listener);
    const onClose = vi.fn();
    render(
      <EditorContext.Provider value={{ pageId: "p1" } as EditorApi}>
        <InsertMenu anchor={null} items={[]} onPick={() => {}} onClose={onClose} />
      </EditorContext.Provider>,
    );
    await user.click(screen.getByRole("button", { name: M.menuQuizFromPage }));
    expect(seen).toEqual([{ mode: "page", pageId: "p1", make: "quiz" }]);
    expect(onClose).toHaveBeenCalled();
    act(() => window.removeEventListener(STUDY_KIT_EVENT, listener));
  });
});
