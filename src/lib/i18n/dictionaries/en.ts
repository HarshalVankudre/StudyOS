/**
 * English — the canonical StudyOS dictionary.
 *
 * This object IS the translation contract: its shape is exported as the
 * `Dictionary` type, and every other locale file is declared
 * `satisfies Dictionary`, so TypeScript fails the build if a translation is
 * missing or has the wrong shape. Keep keys in sync across all locales.
 *
 * `en` is declared WITHOUT `as const`, so leaf types widen to `string` (and
 * arrays to `string[]`): other locales supply different strings, but the object
 * SHAPE (every key, nesting, array element shape) is enforced.
 *
 * Placeholders look like `{name}` and are filled with `fmt()` (../interpolate).
 * Calendar month/weekday names come from `Intl.DateTimeFormat(locale)`, not here.
 */
export const en = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — Your study workspace, built by AI",
    homeDescription:
      "Describe your courses and deadlines, and StudyOS instantly builds your dashboards, planners, and assignment trackers. The AI-powered study workspace for students.",
    appTitle: "Your workspaces · StudyOS",
    generateTitle: "Generate your workspace · StudyOS",
    pricingTitle: "Pricing · StudyOS",
    pricingDescription:
      "Compare StudyOS Free and Pro. Start free and upgrade when you want the most capable model, unlimited generations, and priority support.",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Language",
    choose: "Choose language",
  },

  // ---- Shared bits used on more than one surface ------------------------
  common: {
    openApp: "Open app",
    signIn: "Sign in",
    getStarted: "Get started",
    cancel: "Cancel",
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
    preview: {
      name: "CS Study HQ",
      thisWeek: "This week",
      columns: { todo: "To do", doing: "Doing", done: "Done" },
      cards: ["Proofs Quiz", "Linked List Lab", "Lab Report 2"],
      coursesLabel: "Courses",
      courses: ["Data Structures", "Discrete Math", "Physics I"],
    },
  },

  // ---- Pricing page (/pricing) ------------------------------------------
  pricing: {
    nav: { openApp: "Open app", signIn: "Sign in", getStarted: "Get started" },
    badge: "Simple, student-friendly pricing",
    title: "Start free. Upgrade when you’re ready.",
    subtitle:
      "Everything you need to organize your semester is free. Pro adds the most capable model, unlimited generations, and priority support.",
    free: {
      name: "Free",
      price: "$0",
      tagline: "Everything to get organized.",
      bullets: [
        "AI-generated study workspaces",
        "Full inline editing & autosave",
        "Databases — table, board & calendar",
        "AI agent chat in your workspace",
      ],
      ctaSignedOut: "Get started free",
      ctaSignedIn: "Open your workspaces",
      bulletCredits: "{count} starter AI credits",
    },
    pro: {
      badge: "Most popular",
      name: "Pro",
      price: "$5",
      perMonth: "/mo",
      billed: "Billed monthly · cancel anytime.",
      bullets: [
        "Everything in Free",
        "Unlimited workspace generations",
        "The most capable, most detailed model",
        "Priority support & early access",
      ],
      currentPlan: "✦ Your current plan",
      manageBilling: "Manage billing",
      upgrade: "Upgrade to Pro",
      ctaSignedOut: "Get started with Pro",
      bulletCredits: "{count} AI credits included",
    },
    comparison: {
      title: "Compare plans",
      featuresHeader: "Features",
      freeHeader: "Free",
      proHeader: "Pro",
      included: "Included",
      notIncluded: "Not included",
      features: {
        aiWorkspaces: "AI-generated workspaces",
        onboarding: "Guided onboarding questions",
        editing: "Full inline editing & autosave",
        databases: "Databases — table, board & calendar",
        dragDrop: "Drag-and-drop editing",
        agentChat: "AI agent chat that edits your workspace",
        model: "Generation model",
        generations: "Workspace generations",
        support: "Support",
        earlyAccess: "Early access to new features",
        credits: "Included AI credits",
        buyMore: "Buy more credits anytime",
      },
      values: {
        standard: "Standard",
        mostCapable: "Most capable",
        generous: "Generous",
        unlimited: "Unlimited",
        community: "Community",
        priority: "Priority",
      },
    },
    credits: {
      heading: "AI runs on credits",
      intro:
        "Every AI request spends credits based on how much it does — a quick tweak costs a little, building a whole workspace costs more. Pro comes loaded with credits, and you can top up anytime.",
      freeIncludes: "Free includes {count} starter credits",
      proIncludes: "Pro includes {count} credits",
      neverExpire: "Top up anytime — credits never expire",
      balance: "Your balance: {count} credits",
      pack: "Credit pack",
      unit: "credits",
      buy: "Buy {count} credits",
      signUpToBuy: "Sign up to buy credits",
      oneTime: "One-time purchase · secure checkout",
    },
    faqTitle: "Questions",
    faq: [
      {
        q: "Is StudyOS really free to start?",
        a: "Yes. Create an account and generate, edit, and use your workspaces on the Free plan — no credit card required.",
      },
      {
        q: "What do I get with Pro?",
        a: "Unlimited generations, the most capable model for richer and more accurate workspaces, priority support, and early access to new features.",
      },
      {
        q: "Can I cancel anytime?",
        a: "Anytime. Manage or cancel your subscription from the billing portal — you keep Pro until the end of the period.",
      },
      {
        q: "What happens to my workspaces if I downgrade?",
        a: "Nothing is deleted. Your workspaces stay exactly as they are and remain fully editable on Free.",
      },
    ],
    ctaTitle: "Your first workspace is one sentence away.",
    ctaSubtitle: "Try StudyOS free — upgrade only if you want more.",
    ctaSignedIn: "Generate a workspace",
    ctaSignedOut: "Get started free",
    footerTagline: "The study workspace for students · © 2026",
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
    planningTitle: "Getting to know you",
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
      other: "Other",
      otherPlaceholder: "Type your own preference…",
      otherAria: "Other answer for {question}",
    },
  },

  // ---- Generation activity (full-screen build progress) -----------------
  genActivity: {
    building: "Building your workspace",
    designing: "Designing your workspace",
    componentsChosen: "Components chosen for you",
    planningComponents: "Planning components",
    onlyRelevant: "Only the pages and trackers relevant to your answers.",
    componentsCount: "{count} components",
    everythingEditable:
      "Everything generated stays editable — pages, fields, views, rows, and content.",
    statusReady: "Ready",
    statusGenerating: "Generating…",
    statusQueued: "Queued",
    finishingUp: "Finishing up",
    yourWorkspace: "Your workspace",
    pagesLabel: "Pages",
    sectionsBuilt: "{built} of {total} sections built",
    choosingPieces: "Choosing the right pieces for you…",
    stillEditable: "Everything stays editable once it’s ready",
    writingItIn: "Writing it in…",
    board: { todo: "To do", doing: "Doing", done: "Done" },
    phase: {
      analyzing: "Analyzing your answers",
      planning: "Selecting components",
      generating: "Generating workspace",
      validating: "Validating data",
      saving: "Saving",
    },
  },

  // ---- AiActivity overlay (calm spinner used during planning) -----------
  aiActivity: {
    defaultTitle: "Working on it",
    defaultSteps: [
      "Reading your workspace",
      "Planning the changes",
      "Designing the layout",
      "Writing it in",
    ],
  },

  // ---- Workspace editor chrome ------------------------------------------
  editor: {
    workspaceIcon: "Workspace icon",
    newPage: "New page",
    untitled: "Untitled",
    allWorkspaces: "← All workspaces",
    deletePage: "Delete page",
    askAi: "Ask AI",
    closeAgent: "Close agent",
    saving: "Saving…",
    saveFailed: "Save failed",
    saved: "Saved",
  },

  // ---- In-workspace AI agent chat ---------------------------------------
  agentChat: {
    title: "AI agent",
    subtitleIdle: "Understands your whole workspace",
    closeChat: "Close chat",
    suggestions: [
      "Add a habit tracker",
      "Make a 2-week finals study plan",
      "Add a midterm to each course",
      "What should I focus on this week?",
    ],
    intro:
      "Ask me to change one item or coordinate updates across your full workspace. If anything is unclear, I’ll ask before editing.",
    workspaceUpdated: "Workspace updated",
    undo: "Undo",
    undoing: "Undoing…",
    undone: "Change undone",
    undoFailed:
      "This change can’t be undone because the workspace changed.",
    buildingUpdate: "Building your update",
    thinking: "Thinking…",
    steps: {
      inspect: "Inspect workspace",
      decide: "Decide the safest action",
      prepare: "Prepare coordinated update",
    },
    phase: {
      inspecting: "Reviewing your workspace",
      planning: "Planning the safest change",
      updating: "Coordinating workspace updates",
      validating: "Checking every connection",
      saving: "Saving your changes",
    },
    areaStatus: { queued: "Queued", working: "Updating", complete: "Ready" },
    initialMessage: "Opening your workspace",
    placeholderBusy: "The agent is working…",
    placeholderIdle: "Ask the agent to build or change something…",
    send: "Send",
    inputHint: "Enter to send · Shift+Enter for a new line",
    errorRequestFailed: "Agent request failed",
    errorEndedUnexpectedly: "Agent response ended unexpectedly",
    errorSnag: "The agent hit a snag. Please try again.",
    errorCouldntComplete:
      "I couldn’t complete that safely. Try again or make the request more specific.",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    pageIcon: "Page icon",
    headingLevel: "Heading level",
    calloutIcon: "Callout icon",
    addBlock: "+ Add block",
    deleteBlock: "Delete block",
    blockTypes: {
      paragraph: "Text",
      heading: "Heading",
      todo: "To-do",
      bulleted_list_item: "List",
      numbered_list_item: "Numbered",
      quote: "Quote",
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
    databaseIcon: "Database icon",
    nameAria: "Database name",
    newRow: "+ New row",
    newCard: "+ New",
    untitled: "Untitled",
    empty: "—",
    deleteRow: "Delete row",
    deleteCard: "Delete card",
    dragHint: "Drag to another column",
    prevMonth: "Previous month",
    nextMonth: "Next month",
    addOnDay: "Add on this day",
    clickToRename: "Click to rename",
    delete: "Delete",
  },

  // ---- Database settings panel ------------------------------------------
  dbSettings: {
    customize: "Customize fields & views",
    description: "Description",
    descriptionPlaceholder: "What this tracker is for",
    fields: "Fields",
    addField: "+ Add field",
    fieldName: "Field name",
    fieldType: "Field type",
    deleteField: "Delete field",
    newField: "New field",
    chooseRelatedDatabase: "Choose related database",
    optionLabel: "Option label",
    addOption: "+ option",
    newOption: "New option",
    views: "Views",
    addView: "+ Add view",
    viewName: "View name",
    newView: "New view",
    deleteView: "Delete view",
    groupBy: "Group by…",
    dateField: "Date field…",
    deleteDatabase: "Delete this database",
    deleteConfirm: "Delete “{name}” and remove it from every page?",
    propertyTypes: {
      text: "Text",
      number: "Number",
      checkbox: "Checkbox",
      date: "Date",
      select: "Select",
      multi_select: "Multi-select",
      status: "Status",
      url: "URL",
      relation: "Relation",
    },
    viewTypes: {
      table: "Table",
      board: "Board",
      calendar: "Calendar",
      list: "List",
      gallery: "Gallery",
    },
    defaults: {
      statusTodo: "To do",
      statusInProgress: "In progress",
      statusDone: "Done",
      option1: "Option 1",
      option2: "Option 2",
    },
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
    load: { question: "How many courses are you juggling?" },
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
      options: { cal: "By calendar", board: "By board", list: "Simple lists" },
    },
  },

  // ---- Server-emitted AI progress + errors ------------------------------
  ai: {
    generate: {
      phase: {
        analyzing: "Reading your courses, goals, and preferences",
        planning: "Choosing the right workspace components",
        generating: "Generating your complete workspace in one pass",
        validating: "Checking links, views, fields, and starter data",
        saving: "Saving your editable workspace",
      },
      error:
        "The workspace could not be generated. Please try again with a shorter description.",
      detail: {
        dashboard: "{count} editable pages connected",
        courses: "{count} courses added",
        trackedItems: "{count} tracked items added",
        scheduled: "{count} items scheduled",
        readings: "{count} reading items added",
        habits: "{count} routines added",
        grades: "{count} grade rows added",
        notes: "Editable note structure created",
        generic: "Component created and connected",
      },
    },
    agent: {
      inspecting: "Reviewing {pages} pages and {databases} databases",
      inspectingArea: "Reviewing {area}",
      planning: "Understanding the request and checking for ambiguity",
      updating: "Applying coordinated changes across your workspace",
      validating: "Checking references, views, fields, and linked data",
      saving: "Saving the updated workspace",
      workspaceNotFound: "Workspace not found.",
      workspaceChanged:
        "Your workspace changed while I was working. Please try again.",
      undoUnavailable:
        "This change can’t be undone because the workspace has newer edits.",
      error:
        "The agent could not finish that request safely. Please try again or make the request more specific.",
      fallbackReply: "Updated your workspace.",
    },
    errors: {
      notAuthenticated: "Not authenticated",
      invalidAgentRequest: "Invalid agent request",
      describeBeforeGenerating:
        "Describe your studies before generating a workspace.",
    },
  },

  // ---- Credits ----------------------------------------------------------
  credits: {
    label: "AI credits",
    amount: "{count} credits",
    buy: "Buy credits",
    metaTitle: "Buy credits · StudyOS",
    pageIntro:
      "Credits power every AI request — generating workspaces and chatting with the agent. Top up anytime; credits never expire.",
    oneTimeExpire: "One-time purchase · secure checkout · credits never expire",
    wantMore: "Want the most capable model and included credits?",
    spentOn: "Spent on AI generations and agent edits.",
    addedBanner: "Added {added} credits — you now have {total}.",
    outGenerate:
      "You’re out of AI credits. Add more from the Pricing page to keep generating.",
    outAgent:
      "You’re out of AI credits. Add more from the Pricing page to keep using the agent.",
  },

  // ---- Account menu -----------------------------------------------------
  account: {
    pro: "Pro",
    free: "Free",
    fallbackName: "Account",
    viewProfile: "View profile",
    manageProfile: "Manage profile",
    subscriptionPayments: "Subscription & payments",
    buyCredits: "Buy credits",
    settings: "Settings",
    signOut: "Sign out",
    manageAccount: "Manage account",
    creditsAndPlan: "{credits} credits · {plan}",
  },

  // ---- Account settings page --------------------------------------------
  settings: {
    metaTitle: "Account settings · StudyOS",
    back: "← Workspaces",
    title: "Account settings",
    subtitle: "Manage your profile, plan, payments, and credits.",
    profile: "Profile",
    yourAccount: "Your account",
    subscription: "Subscription",
    proDesc:
      "You’re on Pro — the most capable model and priority support. Manage your subscription, payment methods, and invoices below.",
    freeDesc:
      "You’re on the Free plan. Upgrade to Pro for the most capable model, included credits, and priority support.",
    manageSubscription: "Manage subscription & payments",
    upgrade: "Upgrade to Pro",
    comparePlans: "Compare plans",
    creditsDesc:
      "Credits power every AI request. Top up anytime — credits never expire.",
    buyPack: "Buy {count} credits · ${price}",
    viewPricing: "View pricing",
    signOut: "Sign out",
  },

  // ---- Workspace card (delete control) ----------------------------------
  workspaceCard: {
    delete: "Delete workspace",
    deleteAria: "Delete {name}",
    deleteConfirm:
      "Delete “{name}”?\n\nThis permanently removes the workspace and everything in it. This can’t be undone.",
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
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
      },
    },
  },
};

/**
 * The translation contract every locale must satisfy.
 *
 * `en` is declared WITHOUT `as const`, so its leaf types widen to `string`
 * (and arrays to `string[]`). Other locale files supply different string values
 * but must match this object's SHAPE, enforced by `satisfies Dictionary`.
 */
export type Dictionary = typeof en;
