/**
 * The grades block in the shared workspace plumbing: schema, tolerant repair,
 * editor duplication, the agent's op, and post-generation clean-up.
 */
import { describe, expect, it } from "vitest";
import type { GradesBlock, Workspace } from "@/lib/workspace/types";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import { repairWorkspace } from "@/lib/workspace/repair";
import { sampleWorkspace } from "@/lib/workspace/sample";
import { applyAgentOps, agentOpsSchema } from "@/lib/ai/agent-ops";
import { duplicateBlock, buildInsertItems } from "@/components/workspace/editor/blockOps";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { ensureGradeTracking } from "./ensure";
import { buildGradeReport } from "./workspace";

const LABELS = { score: "Score", heading: "🎯 Grades", title: "Grades" };

function wsWith(block: unknown): unknown {
  return {
    id: "w",
    name: "W",
    pages: [{ id: "p", title: "P", blocks: [block] }],
    databases: [],
  };
}

describe("schema", () => {
  it("accepts a minimal and a fully configured grades block", () => {
    expect(safeParseWorkspace(wsWith({ id: "g", type: "grades" })).success).toBe(true);
    expect(
      safeParseWorkspace(
        wsWith({
          id: "g",
          type: "grades",
          title: "Grades",
          databaseId: "db",
          columns: { course: "c", score: "s", maxScore: null, weight: "w", due: "d" },
          scale: "de_grade",
          bands: [{ min: 50, label: "4,0", points: 4 }],
          targets: { "co-1": 85 },
          defaultTarget: 70,
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects an unknown scale", () => {
    expect(safeParseWorkspace(wsWith({ id: "g", type: "grades", scale: "ib" })).success).toBe(false);
  });
});

describe("repair", () => {
  it("keeps a damaged grades block, dropping only the broken settings", () => {
    const result = repairWorkspace(
      wsWith({
        id: "g",
        type: "grades",
        title: "x".repeat(300),
        databaseId: "db",
        scale: "nonsense",
        columns: { score: "s", weight: 5 },
        bands: [{ min: 50, label: "ok" }, { min: "high", label: "bad" }],
        targets: { a: 80, b: "ninety", c: Number.NaN },
      }),
    );
    expect(result).not.toBeNull();
    const block = result!.workspace.pages[0].blocks[0] as GradesBlock;
    expect(block.type).toBe("grades");
    expect(block.databaseId).toBe("db");
    expect(block.title).toHaveLength(200);
    expect(block.scale).toBeUndefined();
    expect(block.columns).toEqual({ score: "s" });
    expect(block.bands).toEqual([{ min: 50, label: "ok" }]);
    expect(block.targets).toEqual({ a: 80 });
  });
});

describe("editor", () => {
  it("duplicates a grades block with its settings and a new id", () => {
    const block: GradesBlock = { id: "g", type: "grades", databaseId: "db", targets: { a: 80 } };
    const copy = duplicateBlock(block, "g2") as GradesBlock;
    expect(copy).toEqual({ ...block, id: "g2" });
    copy.targets!.a = 1;
    expect(block.targets!.a).toBe(80);
  });

  it("offers a grade tracker in the insert menu", () => {
    const items = buildInsertItems(en, fmt, []);
    const item = items.find((i) => i.action.kind === "grades");
    expect(item?.label).toBe(en.grades.insertLabel);
    expect(item?.keywords).toContain("gpa");
  });
});

describe("agent op set_grades_block", () => {
  const base = (): Workspace => structuredClone(sampleWorkspace);

  it("adds a grades block after a given block", () => {
    const ops = agentOpsSchema.parse([
      {
        op: "set_grades_block",
        pageId: "page-home",
        afterBlockId: "b-welcome",
        block: { id: "b-g", type: "grades", databaseId: "db-assignments", scale: "us_letter", defaultTarget: 90 },
      },
    ]);
    const next = applyAgentOps(base(), ops);
    expect(next.pages[0].blocks[1]).toMatchObject({ id: "b-g", type: "grades", scale: "us_letter" });
    expect(safeParseWorkspace(next).success).toBe(true);
  });

  it("reconfigures an existing grades block in place", () => {
    const first = applyAgentOps(
      base(),
      agentOpsSchema.parse([
        { op: "set_grades_block", pageId: "page-home", block: { id: "b-g", type: "grades", databaseId: "db-assignments" } },
      ]),
    );
    const at = first.pages[0].blocks.findIndex((b) => b.id === "b-g");
    const second = applyAgentOps(
      first,
      agentOpsSchema.parse([
        {
          op: "set_grades_block",
          pageId: "page-home",
          block: { id: "b-g", type: "grades", databaseId: "db-assignments", scale: "uk_degree" },
        },
      ]),
    );
    expect(second.pages[0].blocks[at]).toMatchObject({ id: "b-g", scale: "uk_degree" });
    expect(second.pages[0].blocks.filter((b) => b.id === "b-g")).toHaveLength(1);
  });

  it("explains a wrong database, a wrong page or a non-grades block", () => {
    expect(() =>
      applyAgentOps(
        base(),
        agentOpsSchema.parse([{ op: "set_grades_block", pageId: "page-home", block: { id: "x", type: "grades", databaseId: "nope" } }]),
      ),
    ).toThrow(/unknown database "nope"/);
    expect(() =>
      applyAgentOps(
        base(),
        agentOpsSchema.parse([{ op: "set_grades_block", pageId: "nope", block: { id: "x", type: "grades" } }]),
      ),
    ).toThrow(/unknown page/);
    expect(() =>
      applyAgentOps(
        base(),
        agentOpsSchema.parse([{ op: "set_grades_block", pageId: "page-home", block: { id: "b-welcome", type: "grades" } }]),
      ),
    ).toThrow(/not a grades block/);
  });

  it("rejects a block of another type", () => {
    expect(
      agentOpsSchema.safeParse([
        { op: "set_grades_block", pageId: "page-home", block: { id: "x", type: "paragraph", text: "" } },
      ]).success,
    ).toBe(false);
  });
});

describe("ensureGradeTracking (after generation)", () => {
  function withoutGrades(): Workspace {
    const ws = structuredClone(sampleWorkspace);
    const db = ws.databases.find((d) => d.id === "db-assignments")!;
    db.properties = db.properties.filter((p) => p.id !== "a-score");
    for (const row of db.rows) delete row.cells["a-score"];
    for (const page of ws.pages) page.blocks = page.blocks.filter((b) => b.type !== "grades");
    return ws;
  }

  it("adds a score column after the weight and a grades block on the home page", () => {
    const ws = withoutGrades();
    const next = ensureGradeTracking(ws, LABELS);
    const db = next.databases.find((d) => d.id === "db-assignments")!;
    const names = db.properties.map((p) => p.name);
    expect(names.indexOf("Score")).toBe(names.indexOf("Weight %") + 1);
    const home = next.pages.find((p) => p.id === "page-home")!;
    const block = home.blocks.at(-1) as GradesBlock;
    expect(home.blocks.at(-2)).toMatchObject({ type: "heading", text: "🎯 Grades" });
    expect(block).toMatchObject({
      type: "grades",
      title: "Grades",
      databaseId: "db-assignments",
      columns: { course: "a-course", weight: "a-weight", due: "a-due" },
    });
    expect(db.properties.find((p) => p.id === block.columns?.score)?.name).toBe("Score");
    expect(safeParseWorkspace(next).success).toBe(true);
    expect(buildGradeReport(next, block)?.courses.length).toBeGreaterThan(0);
    // The input is untouched.
    expect(ws.pages.find((p) => p.id === "page-home")!.blocks.some((b) => b.type === "grades")).toBe(false);
  });

  it("prefers a grades page, right under its heading", () => {
    const ws = withoutGrades();
    ws.pages.push({
      id: "page-grades",
      title: "Grade Tracker",
      blocks: [
        { id: "h", type: "heading", level: 1, text: "Grade Tracker" },
        { id: "p", type: "paragraph", text: "Track it." },
      ],
    });
    const next = ensureGradeTracking(ws, LABELS);
    const page = next.pages.find((p) => p.id === "page-grades")!;
    expect(page.blocks.map((b) => b.type)).toEqual(["heading", "grades", "paragraph"]);
  });

  it("repairs a model-written block with a wrong database and wrong column ids", () => {
    const ws = withoutGrades();
    ws.pages[0].blocks.push({
      id: "g",
      type: "grades",
      databaseId: "db-made-up",
      columns: { score: "nope", weight: "a-weight", course: "a-name" },
    });
    const next = ensureGradeTracking(ws, LABELS);
    const blocks = next.pages.flatMap((p) => p.blocks).filter((b) => b.type === "grades") as GradesBlock[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0].databaseId).toBe("db-assignments");
    // a-name is the title: never a course; the made-up score id is replaced.
    expect(blocks[0].columns?.course).toBeUndefined();
    expect(blocks[0].columns?.weight).toBe("a-weight");
    expect(next.databases[1].properties.some((p) => p.id === blocks[0].columns?.score)).toBe(true);
  });

  it("leaves a workspace without graded work alone", () => {
    const ws: Workspace = {
      id: "w",
      name: "W",
      pages: [{ id: "p", title: "Home", blocks: [] }],
      databases: [
        {
          id: "db-habits",
          name: "Habits",
          properties: [
            { id: "h", name: "Habit", type: "text" },
            { id: "m", name: "Minutes", type: "number" },
          ],
          rows: [],
          views: [],
        },
      ],
    };
    expect(ensureGradeTracking(ws, LABELS)).toBe(ws);
  });

  it("is idempotent", () => {
    const once = ensureGradeTracking(withoutGrades(), LABELS);
    expect(ensureGradeTracking(once, LABELS)).toEqual(once);
  });

  it("the sample workspace already tracks grades", () => {
    expect(ensureGradeTracking(sampleWorkspace, LABELS)).toEqual(sampleWorkspace);
  });
});
