/**
 * A realistic sample workspace for a 1st-year CS student.
 *
 * Used as:
 *   - a fixture for building/previewing the renderer before the AI is wired,
 *   - the "golden example" of target quality for the AI generator,
 *   - a sanity check that the data model can hold a real student's life.
 *
 * Dates are set around mid-June 2026 so "due soon" looks realistic in demos.
 */
import type { Workspace } from "./types";

export const sampleWorkspace: Workspace = {
  id: "ws-sample",
  name: "Study HQ",
  icon: "🎓",
  homePageId: "page-home",

  databases: [
    // ---- Courses ---------------------------------------------------------
    {
      id: "db-courses",
      name: "Courses",
      icon: "📚",
      description: "Every class you're taking this semester.",
      properties: [
        { id: "c-name", name: "Course", type: "text" },
        { id: "c-code", name: "Code", type: "text" },
        { id: "c-instructor", name: "Instructor", type: "text" },
        { id: "c-credits", name: "Credits", type: "number" },
        { id: "c-schedule", name: "Schedule", type: "text" },
      ],
      views: [{ id: "v-courses-table", name: "All courses", type: "table" }],
      rows: [
        {
          id: "row-cs101",
          cells: {
            "c-name": "Intro to Computer Science",
            "c-code": "CS 101",
            "c-instructor": "Dr. Alan Park",
            "c-credits": 4,
            "c-schedule": "Mon / Wed · 10:00",
          },
        },
        {
          id: "row-math201",
          cells: {
            "c-name": "Discrete Mathematics",
            "c-code": "MATH 201",
            "c-instructor": "Prof. Lena Ortiz",
            "c-credits": 3,
            "c-schedule": "Tue / Thu · 13:00",
          },
        },
        {
          id: "row-cs210",
          cells: {
            "c-name": "Data Structures",
            "c-code": "CS 210",
            "c-instructor": "Dr. Priya Nair",
            "c-credits": 4,
            "c-schedule": "Mon / Wed · 14:00",
          },
        },
        {
          id: "row-eng102",
          cells: {
            "c-name": "Academic Writing",
            "c-code": "ENG 102",
            "c-instructor": "Ms. Grace Kim",
            "c-credits": 3,
            "c-schedule": "Fri · 11:00",
          },
        },
        {
          id: "row-phys150",
          cells: {
            "c-name": "Physics I",
            "c-code": "PHYS 150",
            "c-instructor": "Dr. Omar Haddad",
            "c-credits": 4,
            "c-schedule": "Tue / Thu · 09:00",
          },
        },
      ],
    },

    // ---- Assignments -----------------------------------------------------
    {
      id: "db-assignments",
      name: "Assignments",
      icon: "📝",
      description: "Homework, quizzes, projects and exams.",
      properties: [
        { id: "a-name", name: "Assignment", type: "text" },
        {
          id: "a-course",
          name: "Course",
          type: "select",
          options: [
            { id: "co-cs101", label: "CS 101", color: "blue" },
            { id: "co-math201", label: "MATH 201", color: "violet" },
            { id: "co-cs210", label: "CS 210", color: "indigo" },
            { id: "co-eng102", label: "ENG 102", color: "amber" },
            { id: "co-phys150", label: "PHYS 150", color: "rose" },
          ],
        },
        {
          id: "a-type",
          name: "Type",
          type: "select",
          options: [
            { id: "ty-hw", label: "Homework", color: "sky" },
            { id: "ty-quiz", label: "Quiz", color: "violet" },
            { id: "ty-exam", label: "Exam", color: "rose" },
            { id: "ty-project", label: "Project", color: "emerald" },
          ],
        },
        {
          id: "a-status",
          name: "Status",
          type: "status",
          options: [
            { id: "st-todo", label: "Not started", color: "zinc" },
            { id: "st-doing", label: "In progress", color: "amber" },
            { id: "st-done", label: "Done", color: "green" },
          ],
        },
        { id: "a-due", name: "Due", type: "date" },
        { id: "a-weight", name: "Weight %", type: "number" },
      ],
      views: [
        { id: "v-assign-table", name: "All", type: "table" },
        {
          id: "v-assign-board",
          name: "By status",
          type: "board",
          groupByPropertyId: "a-status",
        },
        {
          id: "v-assign-calendar",
          name: "Calendar",
          type: "calendar",
          datePropertyId: "a-due",
        },
      ],
      rows: [
        {
          id: "as-1",
          cells: {
            "a-name": "Problem Set 3",
            "a-course": "co-cs101",
            "a-type": "ty-hw",
            "a-status": "st-doing",
            "a-due": "2026-06-22",
            "a-weight": 10,
          },
        },
        {
          id: "as-2",
          cells: {
            "a-name": "Proofs Quiz",
            "a-course": "co-math201",
            "a-type": "ty-quiz",
            "a-status": "st-todo",
            "a-due": "2026-06-20",
            "a-weight": 5,
          },
        },
        {
          id: "as-3",
          cells: {
            "a-name": "Linked List Lab",
            "a-course": "co-cs210",
            "a-type": "ty-project",
            "a-status": "st-doing",
            "a-due": "2026-06-24",
            "a-weight": 15,
          },
        },
        {
          id: "as-4",
          cells: {
            "a-name": "Essay First Draft",
            "a-course": "co-eng102",
            "a-type": "ty-hw",
            "a-status": "st-todo",
            "a-due": "2026-06-25",
            "a-weight": 20,
          },
        },
        {
          id: "as-5",
          cells: {
            "a-name": "Lab Report 2",
            "a-course": "co-phys150",
            "a-type": "ty-hw",
            "a-status": "st-done",
            "a-due": "2026-06-16",
            "a-weight": 8,
          },
        },
        {
          id: "as-6",
          cells: {
            "a-name": "Midterm Exam",
            "a-course": "co-cs101",
            "a-type": "ty-exam",
            "a-status": "st-todo",
            "a-due": "2026-07-01",
            "a-weight": 30,
          },
        },
        {
          id: "as-7",
          cells: {
            "a-name": "Graph Algorithms HW",
            "a-course": "co-cs210",
            "a-type": "ty-hw",
            "a-status": "st-todo",
            "a-due": "2026-06-28",
            "a-weight": 10,
          },
        },
        {
          id: "as-8",
          cells: {
            "a-name": "Reading Response",
            "a-course": "co-eng102",
            "a-type": "ty-hw",
            "a-status": "st-done",
            "a-due": "2026-06-15",
            "a-weight": 5,
          },
        },
      ],
    },

    // ---- Reading list ----------------------------------------------------
    {
      id: "db-readings",
      name: "Reading List",
      icon: "📖",
      description: "Chapters and resources to get through.",
      properties: [
        { id: "r-title", name: "Title", type: "text" },
        {
          id: "r-course",
          name: "Course",
          type: "select",
          options: [
            { id: "rc-cs101", label: "CS 101", color: "blue" },
            { id: "rc-math201", label: "MATH 201", color: "violet" },
            { id: "rc-cs210", label: "CS 210", color: "indigo" },
            { id: "rc-eng102", label: "ENG 102", color: "amber" },
            { id: "rc-phys150", label: "PHYS 150", color: "rose" },
          ],
        },
        { id: "r-done", name: "Read", type: "checkbox" },
        { id: "r-link", name: "Link", type: "url" },
      ],
      views: [{ id: "v-readings-table", name: "Reading list", type: "table" }],
      rows: [
        {
          id: "rd-1",
          cells: {
            "r-title": "Ch. 4 — Recursion",
            "r-course": "rc-cs101",
            "r-done": false,
            "r-link": "https://example.com/cs101-ch4",
          },
        },
        {
          id: "rd-2",
          cells: {
            "r-title": "Set Theory Notes",
            "r-course": "rc-math201",
            "r-done": true,
            "r-link": null,
          },
        },
        {
          id: "rd-3",
          cells: {
            "r-title": "Big-O Cheatsheet",
            "r-course": "rc-cs210",
            "r-done": false,
            "r-link": "https://example.com/big-o",
          },
        },
        {
          id: "rd-4",
          cells: {
            "r-title": "Citation Style Guide",
            "r-course": "rc-eng102",
            "r-done": false,
            "r-link": null,
          },
        },
        {
          id: "rd-5",
          cells: {
            "r-title": "Kinematics — Ch. 2",
            "r-course": "rc-phys150",
            "r-done": true,
            "r-link": null,
          },
        },
      ],
    },
  ],

  pages: [
    // ---- Home / Dashboard ------------------------------------------------
    {
      id: "page-home",
      title: "Dashboard",
      icon: "🏠",
      blocks: [
        {
          id: "b-welcome",
          type: "callout",
          emoji: "👋",
          text: "Welcome to your Study HQ — your whole semester in one place. Generated for: a 1st-year CS student taking 5 courses.",
        },
        {
          id: "b-h-due",
          type: "heading",
          level: 2,
          text: "📌 Assignments by status",
        },
        {
          id: "b-board",
          type: "database_view",
          databaseId: "db-assignments",
          viewId: "v-assign-board",
        },
        { id: "b-h-courses", type: "heading", level: 2, text: "📚 My courses" },
        {
          id: "b-courses",
          type: "database_view",
          databaseId: "db-courses",
          viewId: "v-courses-table",
        },
      ],
    },

    // ---- Assignments page ------------------------------------------------
    {
      id: "page-assignments",
      title: "Assignments",
      icon: "📝",
      blocks: [
        { id: "pa-h", type: "heading", level: 1, text: "Assignments" },
        {
          id: "pa-p",
          type: "paragraph",
          text: "Everything you owe, with due dates and weights.",
        },
        {
          id: "pa-table",
          type: "database_view",
          databaseId: "db-assignments",
          viewId: "v-assign-table",
        },
      ],
    },

    // ---- Courses page ----------------------------------------------------
    {
      id: "page-courses",
      title: "Courses",
      icon: "📚",
      blocks: [
        { id: "pc-h", type: "heading", level: 1, text: "Courses" },
        {
          id: "pc-table",
          type: "database_view",
          databaseId: "db-courses",
          viewId: "v-courses-table",
        },
      ],
    },

    // ---- Planner page ----------------------------------------------------
    {
      id: "page-planner",
      title: "Planner",
      icon: "🗓",
      blocks: [
        { id: "pp-h", type: "heading", level: 1, text: "Planner" },
        {
          id: "pp-p",
          type: "paragraph",
          text: "Your deadlines laid out on a calendar.",
        },
        {
          id: "pp-cal",
          type: "database_view",
          databaseId: "db-assignments",
          viewId: "v-assign-calendar",
        },
      ],
    },

    // ---- Reading list page ----------------------------------------------
    {
      id: "page-readings",
      title: "Reading List",
      icon: "📖",
      blocks: [
        { id: "pr-h", type: "heading", level: 1, text: "Reading List" },
        {
          id: "pr-table",
          type: "database_view",
          databaseId: "db-readings",
          viewId: "v-readings-table",
        },
      ],
    },
  ],
};
