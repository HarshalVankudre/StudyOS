import { describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/workspace/types";
import { buildSearchEntries, entryHref, searchEntries, type SearchResults } from "./index";
import { plainText, snippetAround } from "./text";

function ws(id: string, name: string, extra: Partial<Workspace> = {}): Workspace {
  return { id, name, icon: "🎓", pages: [], databases: [], ...extra };
}

const calculus: Workspace = ws("w1", "Fall semester", {
  homePageId: "home",
  pages: [
    {
      id: "home",
      title: "Dashboard",
      icon: "🏠",
      blocks: [
        { id: "b1", type: "heading", level: 1, text: "Welcome back" },
        { id: "b2", type: "paragraph", text: "Remember the **integration by parts** formula before Friday." },
        { id: "dv", type: "database_view", databaseId: "db1", viewId: "v1" },
      ],
    },
    {
      id: "calc",
      title: "Calculus notes",
      icon: "🧮",
      blocks: [
        { id: "t1", type: "todo", text: "Review limits", checked: false },
        {
          id: "fc",
          type: "flashcards",
          title: "Derivatives",
          cards: [{ id: "c1", front: "Derivative of $\\sin x$", back: "$\\cos x$" }],
        },
        {
          id: "qz",
          type: "quiz",
          title: "Week 3 quiz",
          questions: [
            { id: "q1", kind: "mcq", prompt: "Which rule differentiates a product?", choices: ["Chain rule", "Product rule"], answerIndex: 1 },
          ],
        },
      ],
    },
  ],
  databases: [
    {
      id: "db1",
      name: "Assignments",
      icon: "📚",
      properties: [
        { id: "name", name: "Name", type: "text" },
        { id: "status", name: "Status", type: "status", options: [{ id: "todo", label: "Not started" }, { id: "done", label: "Done" }] },
        { id: "due", name: "Due", type: "date" },
      ],
      rows: [
        { id: "r1", cells: { name: "Calculus problem set 4", status: "todo", due: "2026-11-20" } },
        { id: "r2", cells: { name: "History essay", status: "done", due: "2026-11-01" } },
      ],
      views: [{ id: "v1", name: "Table", type: "table" }],
    },
  ],
});

const run = (workspaces: Workspace[], q: string): SearchResults =>
  searchEntries(workspaces.flatMap(buildSearchEntries), q);

const hrefsOf = (r: SearchResults) => r.groups.flatMap((g) => g.hits.map((h) => h.href));
const group = (r: SearchResults, kind: string) => r.groups.find((g) => g.kind === kind)?.hits ?? [];

describe("buildSearchEntries + searchEntries", () => {
  it("finds pages, blocks, rows, cards and quiz questions", () => {
    expect(group(run([calculus], "calculus notes"), "page")[0].href).toBe("/app/w1?page=calc");
    expect(group(run([calculus], "integration"), "block")[0]).toMatchObject({
      href: "/app/w1?page=home&block=b2",
      context: "🏠 Dashboard",
    });
    expect(group(run([calculus], "problem set"), "row")[0]).toMatchObject({
      href: "/app/w1?page=home&db=db1&row=r1",
      context: "📚 Assignments",
    });
    expect(group(run([calculus], "sin"), "card")[0].href).toBe("/app/w1?page=calc&block=fc");
    expect(group(run([calculus], "product"), "question")[0].href).toBe("/app/w1?page=calc&block=qz");
  });

  it("searches row cells beyond the title, including option labels", () => {
    const hits = group(run([calculus], "not started"), "row");
    expect(hits.map((h) => h.href)).toEqual(["/app/w1?page=home&db=db1&row=r1"]);
    expect(hits[0].snippet).toContain("Not started");
  });

  it("matches card backs and shows them as context", () => {
    const hit = group(run([calculus], "cos"), "card")[0];
    expect(hit.title).toBe("Derivative of \\sin x");
    expect(hit.snippet).toBe("\\cos x");
  });

  it("is case- and accent-insensitive and needs every word", () => {
    const w = ws("w2", "Économie", { pages: [{ id: "p", title: "Microéconomie", blocks: [] }] });
    expect(group(run([w], "economie"), "workspace")).toHaveLength(1);
    expect(group(run([w], "MICROECONOMIE"), "page")).toHaveLength(1);
    expect(run([w], "economie zebra").groups).toEqual([]);
  });

  it("ranks an exact title above a passing mention", () => {
    const w = ws("w3", "Spring", {
      pages: [
        { id: "a", title: "Notes", blocks: [{ id: "x", type: "paragraph", text: "Some biology to revisit later" }] },
        { id: "b", title: "Biology", blocks: [] },
      ],
    });
    const r = run([w], "biology");
    expect(r.groups[0].kind).toBe("page");
    expect(r.groups[0].hits[0].href).toBe("/app/w3?page=b");
    // Within one group, a title starting with the query beats one containing it.
    const w4 = ws("w4", "S", {
      pages: [
        { id: "late", title: "Intro to chemistry", blocks: [] },
        { id: "early", title: "Chemistry lab", blocks: [] },
      ],
    });
    expect(group(run([w4], "chemistry"), "page").map((h) => h.href)).toEqual([
      "/app/w4?page=early",
      "/app/w4?page=late",
    ]);
  });

  it("caps each group and reports the total", () => {
    const pages = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, title: `Lecture ${i}`, blocks: [] }));
    const r = run([ws("w5", "Big", { pages })], "lecture");
    expect(group(r, "page")).toHaveLength(6);
    expect(r.total).toBe(20);
  });

  it("returns the workspaces as a jump list for an empty query", () => {
    const r = run([calculus, ws("w9", "Spring")], "  ");
    expect(r.groups).toHaveLength(1);
    expect(hrefsOf(r)).toEqual(["/app/w1", "/app/w9"]);
  });

  it("links a row to the home page when no page shows its database", () => {
    const w = structuredClone(calculus);
    w.pages[0].blocks = w.pages[0].blocks.filter((b) => b.type !== "database_view");
    w.homePageId = "calc";
    expect(group(run([w], "history essay"), "row")[0].href).toBe("/app/w1?page=calc&db=db1&row=r2");
  });

  it("encodes ids in links", () => {
    expect(entryHref({ kind: "block", workspaceId: "a b", pageId: "p&1", blockId: "x?" })).toBe(
      "/app/a%20b?page=p%261&block=x%3F",
    );
  });

  it("ignores empty blocks and tolerates quizzes without questions", () => {
    const w = ws("w6", "Empty", {
      pages: [{ id: "p", title: "", blocks: [{ id: "d", type: "divider" }, { id: "q", type: "quiz", questions: [] }] }],
    });
    expect(buildSearchEntries(w).map((e) => e.kind)).toEqual(["workspace"]);
  });
});

describe("text helpers", () => {
  it("reduces Markdown to readable text", () => {
    expect(plainText("## A [link](https://x.y) with **bold** and `code`")).toBe("A link with bold and code");
    expect(plainText("- [ ] item")).toBe("[ ] item");
  });

  it("cuts a snippet around the first hit", () => {
    const long = `${"word ".repeat(60)}needle ${"tail ".repeat(60)}`;
    const s = snippetAround(long, ["needle"], 60);
    expect(s).toContain("needle");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(62);
  });
});
