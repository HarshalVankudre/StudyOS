/**
 * English — the canonical StudyOS dictionary.
 *
 * This object IS the translation contract: its shape is exported as the
 * `Dictionary` type, and every other locale file is declared
 * `satisfies Dictionary`, so TypeScript fails the build if a translation is
 * missing or has the wrong shape. Keep keys in sync across all locales.
 *
 * Placeholders look like `{name}` and are filled with `fmt()` (see
 * ../interpolate.ts). Calendar month/weekday names are NOT here — they come from
 * `Intl.DateTimeFormat(locale)` at render time.
 */
export const en = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — Your study workspace, built by AI",
    homeDescription:
      "Describe your courses and deadlines, and StudyOS instantly builds your dashboards, planners, and assignment trackers. The AI-powered study workspace for students.",
    appTitle: "Your workspaces · StudyOS",
    generateTitle: "Generate your workspace · StudyOS",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Language",
    choose: "Choose language",
  },

  // ---- Landing page ------------------------------------------------------
  landing: {
    nav: {
      howItWorks: "How it works",
      features: "Features",
      pricing: "Pricing",
      openApp: "Open app",
      signIn: "Sign in",
      getStarted: "Get started",
    },
    hero: {
      badge: "Made for students & researchers",
      titleLine1: "Your whole semester,",
      titleLine2: "organized.",
      subtitle:
        "Describe your classes in a sentence and StudyOS sets up the dashboards, planners and trackers you need — already filled in. No templates, no blank pages.",
      ctaGenerate: "Generate my workspace",
      ctaDemo: "See a demo",
      finePrint: "Free to start · No credit card · Ready in seconds",
    },
    builtFor: {
      label: "Built for",
      items: [
        "Computer Science",
        "Pre-med",
        "Law",
        "MBA",
        "High school",
        "Grad school",
      ],
    },
    how: {
      title: "From a sentence to a full workspace.",
      subtitle: "Three steps, about ten seconds.",
      steps: [
        {
          title: "Describe your classes",
          body: "One sentence — “I’m pre-med taking Anatomy, Biochem and Physiology.”",
        },
        {
          title: "Get a full workspace",
          body: "Courses, an assignment board, a planner and a reading list — already set up and filled in.",
        },
        {
          title: "Study and adjust",
          body: "Edit anything, check off tasks, ask for changes in plain English. Everything autosaves.",
        },
      ],
    },
    features: {
      title: "Everything a semester needs.",
      subtitle: "Generated for you in one step — then yours to shape.",
      items: {
        generate: {
          k: "Generate",
          title: "Workspaces, made for you",
          body: "One prompt becomes a complete workspace tailored to your exact courses.",
        },
        databases: {
          k: "Databases",
          title: "Real, structured data",
          body: "Assignments, grades and readings as tables with custom fields — not loose notes.",
        },
        calendar: {
          k: "Calendar",
          title: "Planner & calendar",
          body: "Every deadline in one place. Switch between table, board and calendar in a click.",
        },
        dashboard: {
          k: "Dashboard",
          title: "A clear home base",
          body: "A page that pulls your whole week together so you always know what’s next.",
        },
        autosave: {
          k: "Autosave",
          title: "Edit, saved instantly",
          body: "Rename, check off, add rows — every change saves itself the moment you make it.",
        },
        assistant: {
          k: "Assistant",
          title: "Ask in plain English",
          body: "“Add a midterm to CS.” Your workspace updates itself, right in front of you.",
        },
      },
    },
    pricing: {
      title: "Simple, student-friendly pricing.",
      subtitle: "Start free. Upgrade only when you want more.",
      perMonth: "/mo",
      free: {
        name: "Free",
        price: "$0",
        features: [
          "Generate AI workspaces",
          "Edit & autosave everything",
          "Dashboards, databases, calendar",
          "Ask to edit in plain English",
        ],
        cta: "Get started",
      },
      pro: {
        badge: "Most popular",
        name: "Pro",
        price: "$5",
        features: [
          "Everything in Free",
          "Unlimited generations",
          "The smartest, most detailed model",
          "Priority support",
        ],
        cta: "Start free, upgrade anytime",
      },
    },
    closing: {
      titleLine1: "Stop setting up.",
      titleLine2: "Start studying.",
      subtitle: "Your first workspace is one sentence away.",
      cta: "Generate my workspace",
    },
    footer: {
      tagline: "The study workspace for students · © 2026",
    },
    // The little workspace mockup in the hero.
    preview: {
      name: "CS Study HQ",
      thisWeek: "This week",
      columns: { todo: "To do", doing: "Doing", done: "Done" },
      cards: ["Proofs Quiz", "Linked List Lab", "Lab Report 2"],
      coursesLabel: "Courses",
      courses: ["Data Structures", "Discrete Math", "Physics I"],
    },
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "Manage",
    upgrade: "Upgrade to Pro",
    generate: "Generate",
    upgradedBanner: "You’re on Pro — your workspaces now use the smarter model.",
    title: "Your workspaces",
    subtitle: "Everything StudyOS has built for you.",
    total: "{count} total",
    emptyTitle: "No workspaces yet",
    emptySubtitle: "Generate one, or load the demo to look around.",
    emptyGenerate: "Generate a workspace",
    loadDemo: "Load demo",
    updatedAt: "updated {date}",
    fallbackIcon: "📄",
  },

  // ---- Generate flow (/generate) ----------------------------------------
  generate: {
    backToWorkspaces: "Your workspaces →",
    examples: [
      { emoji: "💻", text: "I’m a 1st-year CS student taking 5 courses" },
      {
        emoji: "⚕️",
        text: "Pre-med sophomore: Anatomy, Biochemistry, Physiology, Organic Chem",
      },
      { emoji: "🎓", text: "High school junior studying 6 subjects for finals" },
      {
        emoji: "📈",
        text: "MBA student taking Microeconomics, Accounting and Marketing",
      },
    ],
    planSteps: [
      "Reading your description",
      "Thinking of good questions",
      "Tailoring your setup",
    ],
    buildSteps: [
      "Planning your courses",
      "Designing your dashboard",
      "Laying out your planner",
      "Assembling the workspace",
    ],
    planningTitle: "Getting to know you",
    buildingTitle: "Building your workspace",
    errorGeneric: "Something went wrong. Please try again.",
    errorBuild: "Something went wrong generating your workspace. Try again.",
    describe: {
      step: "Step 1 of 2",
      title: "What are you studying?",
      subtitle:
        "Describe your courses and goals in plain English. StudyOS asks a couple of quick questions, then designs the whole workspace around your answers.",
      placeholder:
        "e.g. I’m a 1st-year CS student taking Data Structures, Discrete Math, Calculus II and Academic Writing this semester.",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "Continue",
      examplesLabel: "Not sure? Start from an example",
      finePrint: "Free · no credit card · ready in seconds",
    },
    questions: {
      back: "← Edit description",
      step: "Step 2 of 2",
      title: "Let’s tailor it",
      designingFor: "Designing for:",
      pickAny: "pick any",
      pickOne: "pick one",
      build: "Build my workspace",
      answeredNone: "Answer some, or just build — your call",
      answeredCount: "{n} / {total} answered",
    },
  },

  // ---- AI activity overlay ----------------------------------------------
  aiActivity: {
    defaultTitle: "Working on it",
    defaultSteps: [
      "Reading your workspace",
      "Planning the changes",
      "Designing the layout",
      "Writing it in",
    ],
    updatingTitle: "Updating your workspace",
  },

  // ---- Workspace editor --------------------------------------------------
  editor: {
    newPage: "New page",
    untitled: "Untitled",
    allWorkspaces: "← All workspaces",
    deletePage: "Delete page",
    askAi: "Ask AI",
    aiPlaceholder:
      "Ask AI to change this workspace — “add a midterm to CS”, “make a finals study plan”, “add a habit tracker”…",
    aiWorking: "Working…",
    aiApply: "Apply",
    aiClose: "Close",
    aiError: "Couldn’t apply that — try rephrasing or simplifying the request.",
    saving: "Saving…",
    saveFailed: "Save failed",
    saved: "Saved",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    addBlock: "+ Add block",
    cancel: "Cancel",
    deleteBlock: "Delete block",
    blockTypes: {
      paragraph: "Text",
      heading: "Heading",
      todo: "To-do",
      bulleted_list_item: "List",
      callout: "Callout",
      divider: "Divider",
      database: "Table",
    },
    placeholders: {
      paragraph: "Type something…",
      todo: "To-do",
      listItem: "List item",
      callout: "Callout",
    },
    headingDefault: "Heading",
    // Defaults for a brand-new table inserted via "+ Add block → Table".
    newTable: {
      name: "New table",
      propName: "Name",
      propStatus: "Status",
      propDue: "Due",
      statusTodo: "To do",
      statusInProgress: "In progress",
      statusDone: "Done",
      viewTable: "Table",
    },
  },

  // ---- Database views (table / board / calendar) ------------------------
  db: {
    nameAria: "Database name",
    newRow: "+ New row",
    newCard: "+ New",
    untitled: "Untitled",
    empty: "—",
    link: "Link ↗",
    linked: "{count} linked",
    deleteRow: "Delete row",
    deleteCard: "Delete card",
    dragHint: "Drag to another column",
    prevMonth: "Previous month",
    nextMonth: "Next month",
    addOnDay: "Add on this day",
    clickToRename: "Click to rename",
    delete: "Delete",
  },

  // ---- Default onboarding questions (no-API-key fallback) ----------------
  onboarding: {
    level: {
      question: "What’s your study level?",
      options: {
        hs: "High school",
        ug: "Undergrad",
        grad: "Grad / Postgrad",
        self: "Self-study",
      },
    },
    load: {
      question: "How many courses are you juggling?",
      // 1–2, 3–4, 5–6, 7+ stay numeric across locales (see onboarding.ts).
    },
    track: {
      question: "What do you most want to track?",
      options: {
        assign: "Assignments",
        exams: "Exams",
        read: "Readings",
        notes: "Notes",
        habits: "Study habits",
        grades: "Grades",
      },
    },
    style: {
      question: "How do you like to plan?",
      options: {
        cal: "By calendar",
        board: "By board",
        list: "Simple lists",
      },
    },
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  // The fixed labels the rule-based generator emits so the offline experience
  // is localized too. Course names derive from the user's own prompt.
  mock: {
    workspaceName: "Study HQ",
    workspaceNameField: "{field} Study HQ",
    welcome:
      "Generated from your description: “{summary}”. Everything here is a starting point you can edit.",
    tbd: "TBD",
    status: { notStarted: "Not started", inProgress: "In progress", done: "Done" },
    type: { homework: "Homework", quiz: "Quiz", exam: "Exam", project: "Project" },
    exam: { midterm: "Midterm", final: "Final" },
    courses: {
      name: "Courses",
      description: "Every class you’re taking this term.",
      propCourse: "Course",
      propCode: "Code",
      propInstructor: "Instructor",
      propCredits: "Credits",
      propSchedule: "Schedule",
      viewAll: "All courses",
    },
    assignments: {
      name: "Assignments",
      description: "Homework, quizzes, projects and exams.",
      propName: "Assignment",
      propCourse: "Course",
      propType: "Type",
      propStatus: "Status",
      propDue: "Due",
      propWeight: "Weight %",
      viewAll: "All",
      viewBoard: "By status",
      viewCalendar: "Calendar",
      projectMilestone: "Project milestone {n} — {code}",
    },
    readings: {
      name: "Reading List",
      description: "What to read, organised by course.",
      propTitle: "Title",
      propCourse: "Course",
      propRead: "Read",
      propLink: "Link",
      viewAll: "Reading list",
      coreReading: "{course}: core reading",
    },
    habits: {
      name: "Study Habits",
      description: "A lightweight weekly consistency tracker.",
      propHabit: "Habit",
      propDate: "Date",
      propDone: "Done",
      propMinutes: "Minutes",
      viewAll: "All habits",
      viewCalendar: "Calendar",
      reviewNotes: "Review today’s notes",
      practiceRecall: "Practice recall",
    },
    grades: {
      name: "Grade Tracker",
      description: "Editable scores and weights for each course.",
      propItem: "Assessment",
      propCourse: "Course",
      propScore: "Score",
      propOutOf: "Out of",
      propWeight: "Weight %",
      viewAll: "All grades",
      assessmentN: "Assessment {n}",
    },
    pages: {
      dashboard: "Dashboard",
      courses: "Courses",
      assignments: "Assignments",
      planner: "Planner",
      readings: "Reading List",
      exams: "Exam Prep",
      notes: "Notes",
      habits: "Study Habits",
      grades: "Grade Tracker",
    },
    dashboard: {
      assignmentsHeading: "📌 Assignments by status",
      coursesHeading: "📚 My courses",
    },
    assignmentsPage: { intro: "Everything you owe, with due dates and weights." },
    plannerPage: { intro: "Your deadlines laid out on a calendar." },
    examsPage: {
      callout:
        "Confirm the dates, then break each exam into revision topics and practice sessions.",
    },
    notesPage: {
      heading: "Course Notes",
      callout:
        "Add a heading for each lecture, then capture key ideas and questions underneath.",
      fallbackCourse: "Course",
      startWriting: "Start writing here…",
    },
    gradesPage: {
      callout:
        "Replace the starter assessments with your syllabus weights and actual results.",
    },
    // Workspace component plan (labels + descriptions shown in the loader).
    plan: {
      summaryWith: "A tailored workspace built around {focus}.",
      summaryGeneric:
        "A tailored workspace for courses, deadlines, and study planning.",
      components: {
        dashboard: {
          label: "Dashboard",
          description: "Your semester, priorities, and next deadlines.",
        },
        courses: {
          label: "Courses",
          description: "Course details, schedules, and instructors.",
        },
        assignments: {
          label: "Assignments",
          description: "Coursework, deadlines, weights, and status.",
        },
        planner: {
          label: "Planner",
          description: "A calendar view of the work ahead.",
        },
        readings: {
          label: "Reading List",
          description: "Assigned texts and reading progress.",
        },
        exams: {
          label: "Exam Prep",
          description: "Exam dates, topics, and revision tasks.",
        },
        notes: {
          label: "Notes",
          description: "A structured home for course notes.",
        },
        habits: {
          label: "Study Habits",
          description: "Daily study routines and consistency.",
        },
        grades: {
          label: "Grade Tracker",
          description: "Scores, weights, and grade targets.",
        },
        projects: {
          label: "Projects",
          description: "Milestones and next actions for larger work.",
        },
      },
    },
  },
};

/**
 * The translation contract every locale must satisfy.
 *
 * `en` is declared WITHOUT `as const`, so its leaf types widen to `string`
 * (and arrays to `string[]`). That's deliberate: other locales provide
 * different string values, but the object *shape* (every key, nested structure)
 * is enforced by `satisfies Dictionary` in each locale file.
 */
export type Dictionary = typeof en;
