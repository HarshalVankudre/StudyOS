/**
 * A workspace for the share tests: one shared page holding every kind of
 * block, a second page that must never leak, and a database whose view
 * hides a column and a row. Ids are distinctive so a leak is easy to spot.
 */
import type { Page, Workspace } from "@/lib/workspace/types";

export const WS_ID = "3f1c2a9e-1111-4222-8333-944455556666";
export const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

/** Every id in the fixture that a visitor must never be sent. */
export const PRIVATE_IDS = [
  WS_ID,
  "pg_shared",
  "pg_private",
  "blk_heading",
  "blk_para",
  "blk_num_a",
  "blk_num_b",
  "blk_todo",
  "blk_callout",
  "blk_divider",
  "blk_media",
  "blk_table",
  "blk_cards",
  "blk_quiz",
  "blk_grades",
  "blk_react",
  "crd_one",
  "crd_blank",
  "qst_mcq",
  "qst_tf",
  "qst_short",
  "qst_broken",
  "dbs_tasks",
  "dbs_courses",
  "vw_open",
  "vw_board",
  "row_done",
  "row_open",
  "prop_secret",
  "mat_secret",
  "feed_secret",
];

export function sharedPage(): Page {
  return {
    id: "pg_shared",
    title: "Cell biology",
    icon: "🧬",
    blocks: [
      { id: "blk_heading", type: "heading", level: 1, text: "Overview" },
      {
        id: "blk_para",
        type: "paragraph",
        text: `See [my other page](/app/${WS_ID}?page=pg_private) and ![diagram](/api/asset/asset_inline)`,
      },
      { id: "blk_num_a", type: "numbered_list_item", text: "one" },
      { id: "blk_num_b", type: "numbered_list_item", text: "two" },
      { id: "blk_todo", type: "todo", text: "done thing", checked: true },
      { id: "blk_callout", type: "callout", text: "Remember", emoji: "💡" },
      { id: "blk_divider", type: "divider" },
      { id: "blk_media", type: "media", assetId: "asset_block", mediaKind: "image", mime: "image/png", caption: "Mitosis" },
      { id: "blk_table", type: "database_view", databaseId: "dbs_tasks", viewId: "vw_open" },
      {
        id: "blk_cards",
        type: "flashcards",
        title: "Deck",
        cards: [
          {
            id: "crd_one",
            front: "Q1",
            back: "A1",
            ease: 2.5,
            reps: 3,
            dueAt: "2026-11-20",
            stability: 4,
            reviews: [{ id: "2026-11-01T10:00:00.000Z", grade: "good" }],
            source: { materialId: "mat_secret", page: 2, quote: "a quote" },
          },
          { id: "crd_blank", front: "", back: "blank front" },
        ],
      },
      {
        id: "blk_quiz",
        type: "quiz",
        title: "Check",
        questions: [
          {
            id: "qst_mcq",
            kind: "mcq",
            prompt: "2+2?",
            choices: ["3", "4"],
            answerIndex: 1,
            explanation: "math",
            topic: "Arithmetic",
            stats: { attempts: 3, correct: 1 },
            source: { materialId: "mat_secret" },
          },
          { id: "qst_tf", kind: "true_false", prompt: "Sky is blue", answerBool: true },
          { id: "qst_short", kind: "short", prompt: "Define cell", answerText: "Unit of life" },
          { id: "qst_broken", kind: "mcq", prompt: "broken", choices: ["a"], answerIndex: 3 },
        ],
        attempts: [{ at: "2026-11-01T00:00:00.000Z", mode: "practice", score: 1, total: 3 }],
      },
      { id: "blk_grades", type: "grades", title: "My GPA", databaseId: "dbs_tasks" },
      { id: "blk_react", type: "react_artifact", title: "Sim", source: "function App(){ return 'SECRET_SOURCE' }" },
    ],
  };
}

export function sharedWorkspace(): Workspace {
  return {
    id: WS_ID,
    name: "Fall semester",
    homePageId: "pg_private",
    pages: [
      sharedPage(),
      { id: "pg_private", title: "Diary", blocks: [{ id: "blk_secret", type: "paragraph", text: "SECRET-OTHER-PAGE" }] },
    ],
    databases: [
      {
        id: "dbs_tasks",
        name: "Tasks",
        icon: "✅",
        properties: [
          { id: "prop_title", name: "Title", type: "text" },
          { id: "prop_done", name: "Done", type: "checkbox" },
          {
            id: "prop_status",
            name: "Status",
            type: "select",
            options: [
              { id: "opt_todo", label: "To do" },
              { id: "opt_done", label: "Finished" },
            ],
          },
          { id: "prop_secret", name: "Private note", type: "text" },
          { id: "prop_course", name: "Course", type: "relation", relationDatabaseId: "dbs_courses" },
        ],
        rows: [
          {
            id: "row_done",
            cells: { prop_title: "Read chapter 3", prop_done: true, prop_status: "opt_done", prop_secret: "HIDDEN-ROW" },
            source: { kind: "ical", feed: "feed_secret", key: "uid-1" },
          },
          {
            id: "row_open",
            cells: {
              prop_title: "Lab report",
              prop_done: false,
              prop_status: "opt_todo",
              prop_secret: "HIDDEN-COLUMN",
              prop_course: ["row_course"],
            },
          },
        ],
        views: [
          {
            id: "vw_open",
            name: "Open",
            type: "table",
            visiblePropertyIds: ["prop_title", "prop_status", "prop_course"],
            filters: [{ propertyId: "prop_status", operator: "is", value: "opt_todo" }],
            sorts: [{ propertyId: "prop_secret", direction: "asc" }],
          },
          { id: "vw_board", name: "Board", type: "board", groupByPropertyId: "prop_status" },
        ],
        grading: { categories: [{ id: "cat_1", course: "*", name: "Labs", weight: 40 }] },
      },
      {
        id: "dbs_courses",
        name: "Courses",
        properties: [{ id: "prop_course_name", name: "Name", type: "text" }],
        rows: [{ id: "row_course", cells: { prop_course_name: "Biology 101" } }],
        views: [{ id: "vw_courses", name: "All", type: "table" }],
      },
    ],
  };
}
