import type { Dictionary } from "./en";

/** Dutch (nl-NL) — translation of the canonical English dictionary. */
export const nl = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — Je studiewerkruimte, gebouwd door AI",
    homeDescription:
      "Beschrijf je vakken en deadlines, en StudyOS bouwt direct je dashboards, planners en opdrachttrackers. De AI-aangedreven studiewerkruimte voor studenten.",
    appTitle: "Je werkruimtes · StudyOS",
    generateTitle: "Genereer je werkruimte · StudyOS",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Taal",
    choose: "Kies een taal",
  },

  // ---- Landing page ------------------------------------------------------
  landing: {
    nav: {
      howItWorks: "Hoe het werkt",
      features: "Functies",
      pricing: "Prijzen",
      openApp: "App openen",
      signIn: "Inloggen",
      getStarted: "Aan de slag",
    },
    hero: {
      badge: "Gemaakt voor studenten & onderzoekers",
      titleLine1: "Je hele semester,",
      titleLine2: "georganiseerd.",
      subtitle:
        "Beschrijf je vakken in één zin en StudyOS zet de dashboards, planners en trackers klaar die je nodig hebt — al ingevuld. Geen sjablonen, geen lege pagina’s.",
      ctaGenerate: "Genereer mijn werkruimte",
      ctaDemo: "Bekijk een demo",
      finePrint: "Gratis te beginnen · Geen creditcard · Klaar in seconden",
    },
    builtFor: {
      label: "Gebouwd voor",
      items: [
        "Informatica",
        "Pre-med",
        "Rechten",
        "MBA",
        "Middelbare school",
        "Master",
      ],
    },
    how: {
      title: "Van één zin naar een complete werkruimte.",
      subtitle: "Drie stappen, ongeveer tien seconden.",
      steps: [
        {
          title: "Beschrijf je vakken",
          body: "Eén zin — “Ik ben pre-med en volg Anatomie, Biochemie en Fysiologie.”",
        },
        {
          title: "Krijg een complete werkruimte",
          body: "Vakken, een opdrachtenbord, een planner en een leeslijst — al opgezet en ingevuld.",
        },
        {
          title: "Studeer en pas aan",
          body: "Bewerk alles, vink taken af, vraag om wijzigingen in gewoon Nederlands. Alles wordt automatisch opgeslagen.",
        },
      ],
    },
    features: {
      title: "Alles wat een semester nodig heeft.",
      subtitle: "In één stap voor je gegenereerd — daarna helemaal van jou.",
      items: {
        generate: {
          k: "Genereren",
          title: "Werkruimtes, voor jou gemaakt",
          body: "Eén prompt wordt een complete werkruimte, afgestemd op precies jouw vakken.",
        },
        databases: {
          k: "Databases",
          title: "Echte, gestructureerde data",
          body: "Opdrachten, cijfers en literatuur als tabellen met eigen velden — geen losse notities.",
        },
        calendar: {
          k: "Agenda",
          title: "Planner & agenda",
          body: "Elke deadline op één plek. Wissel met één klik tussen tabel, bord en agenda.",
        },
        dashboard: {
          k: "Dashboard",
          title: "Een overzichtelijk thuisbasis",
          body: "Een pagina die je hele week samenbrengt, zodat je altijd weet wat er aankomt.",
        },
        autosave: {
          k: "Automatisch opslaan",
          title: "Bewerk, direct opgeslagen",
          body: "Hernoemen, afvinken, rijen toevoegen — elke wijziging slaat zichzelf op zodra je hem maakt.",
        },
        assistant: {
          k: "Assistent",
          title: "Vraag in gewoon Nederlands",
          body: "“Voeg een tentamen toe aan Informatica.” Je werkruimte werkt zichzelf bij, recht voor je ogen.",
        },
      },
    },
    pricing: {
      title: "Eenvoudige, studentvriendelijke prijzen.",
      subtitle: "Begin gratis. Upgrade alleen als je meer wilt.",
      perMonth: "/mnd",
      free: {
        name: "Gratis",
        price: "$0",
        features: [
          "AI-werkruimtes genereren",
          "Alles bewerken & automatisch opslaan",
          "Dashboards, databases, agenda",
          "Vraag om bewerkingen in gewoon Nederlands",
        ],
        cta: "Aan de slag",
      },
      pro: {
        badge: "Meest gekozen",
        name: "Pro",
        price: "$5",
        features: [
          "Alles uit Gratis",
          "Onbeperkt genereren",
          "Het slimste, meest gedetailleerde model",
          "Voorrangsondersteuning",
        ],
        cta: "Begin gratis, upgrade wanneer je wilt",
      },
    },
    closing: {
      titleLine1: "Stop met opzetten.",
      titleLine2: "Begin met studeren.",
      subtitle: "Je eerste werkruimte is één zin verwijderd.",
      cta: "Genereer mijn werkruimte",
    },
    footer: {
      tagline: "De studiewerkruimte voor studenten · © 2026",
    },
    // The little workspace mockup in the hero.
    preview: {
      name: "Informatica Studie HQ",
      thisWeek: "Deze week",
      columns: { todo: "Te doen", doing: "Bezig", done: "Klaar" },
      cards: ["Bewijzen-quiz", "Linked List-lab", "Labverslag 2"],
      coursesLabel: "Vakken",
      courses: ["Datastructuren", "Discrete wiskunde", "Natuurkunde I"],
    },
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "Beheren",
    upgrade: "Upgraden naar Pro",
    generate: "Genereren",
    upgradedBanner: "Je gebruikt Pro — je werkruimtes draaien nu op het slimmere model.",
    title: "Je werkruimtes",
    subtitle: "Alles wat StudyOS voor je heeft gebouwd.",
    total: "{count} totaal",
    emptyTitle: "Nog geen werkruimtes",
    emptySubtitle: "Genereer er een, of laad de demo om rond te kijken.",
    emptyGenerate: "Genereer een werkruimte",
    loadDemo: "Demo laden",
    updatedAt: "bijgewerkt {date}",
    fallbackIcon: "📄",
  },

  // ---- Generate flow (/generate) ----------------------------------------
  generate: {
    backToWorkspaces: "Je werkruimtes →",
    examples: [
      { emoji: "💻", text: "Ik ben een eerstejaars informaticastudent en volg 5 vakken" },
      {
        emoji: "⚕️",
        text: "Tweedejaars pre-med: Anatomie, Biochemie, Fysiologie, Organische chemie",
      },
      { emoji: "🎓", text: "Vijfdeklasser die voor de eindexamens 6 vakken studeert" },
      {
        emoji: "📈",
        text: "MBA-student die Micro-economie, Boekhouden en Marketing volgt",
      },
    ],
    planSteps: [
      "Je beschrijving lezen",
      "Goede vragen bedenken",
      "Je opzet op maat maken",
    ],
    buildSteps: [
      "Je vakken plannen",
      "Je dashboard ontwerpen",
      "Je planner indelen",
      "De werkruimte samenstellen",
    ],
    planningTitle: "Je leren kennen",
    buildingTitle: "Je werkruimte bouwen",
    errorGeneric: "Er ging iets mis. Probeer het opnieuw.",
    errorBuild: "Er ging iets mis bij het genereren van je werkruimte. Probeer opnieuw.",
    describe: {
      step: "Stap 1 van 2",
      title: "Wat ben je aan het studeren?",
      subtitle:
        "Beschrijf je vakken en doelen in gewoon Nederlands. StudyOS stelt een paar korte vragen en ontwerpt vervolgens de hele werkruimte rond je antwoorden.",
      placeholder:
        "bijv. Ik ben een eerstejaars informaticastudent en volg dit semester Datastructuren, Discrete wiskunde, Calculus II en Academisch schrijven.",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "Doorgaan",
      examplesLabel: "Weet je het niet zeker? Begin met een voorbeeld",
      finePrint: "Gratis · geen creditcard · klaar in seconden",
    },
    questions: {
      back: "← Beschrijving bewerken",
      step: "Stap 2 van 2",
      title: "Laten we het op maat maken",
      designingFor: "Ontworpen voor:",
      pickAny: "kies een willekeurige",
      pickOne: "kies er één",
      build: "Bouw mijn werkruimte",
      answeredNone: "Beantwoord er een paar, of bouw gewoon — aan jou de keuze",
      answeredCount: "{n} / {total} beantwoord",
    },
  },

  // ---- AI activity overlay ----------------------------------------------
  aiActivity: {
    defaultTitle: "Hiermee bezig",
    defaultSteps: [
      "Je werkruimte lezen",
      "De wijzigingen plannen",
      "De indeling ontwerpen",
      "Het invoeren",
    ],
    updatingTitle: "Je werkruimte bijwerken",
  },

  // ---- Workspace editor --------------------------------------------------
  editor: {
    newPage: "Nieuwe pagina",
    untitled: "Naamloos",
    allWorkspaces: "← Alle werkruimtes",
    deletePage: "Pagina verwijderen",
    askAi: "Vraag AI",
    aiPlaceholder:
      "Vraag AI om deze werkruimte aan te passen — “voeg een tentamen toe aan Informatica”, “maak een studieplan voor de eindexamens”, “voeg een gewoontetracker toe”…",
    aiWorking: "Bezig…",
    aiApply: "Toepassen",
    aiClose: "Sluiten",
    aiError: "Kon dat niet toepassen — probeer het anders te formuleren of vereenvoudig de vraag.",
    saving: "Opslaan…",
    saveFailed: "Opslaan mislukt",
    saved: "Opgeslagen",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    addBlock: "+ Blok toevoegen",
    cancel: "Annuleren",
    deleteBlock: "Blok verwijderen",
    blockTypes: {
      paragraph: "Tekst",
      heading: "Kop",
      todo: "Taak",
      bulleted_list_item: "Lijst",
      callout: "Notitieblok",
      divider: "Scheidingslijn",
      database: "Tabel",
    },
    placeholders: {
      paragraph: "Typ iets…",
      todo: "Taak",
      listItem: "Lijstitem",
      callout: "Notitieblok",
    },
    headingDefault: "Kop",
    // Defaults for a brand-new table inserted via "+ Add block → Table".
    newTable: {
      name: "Nieuwe tabel",
      propName: "Naam",
      propStatus: "Status",
      propDue: "Deadline",
      statusTodo: "Te doen",
      statusInProgress: "Bezig",
      statusDone: "Klaar",
      viewTable: "Tabel",
    },
  },

  // ---- Database views (table / board / calendar) ------------------------
  db: {
    nameAria: "Databasenaam",
    newRow: "+ Nieuwe rij",
    newCard: "+ Nieuw",
    untitled: "Naamloos",
    empty: "—",
    link: "Koppelen ↗",
    linked: "{count} gekoppeld",
    deleteRow: "Rij verwijderen",
    deleteCard: "Kaart verwijderen",
    dragHint: "Sleep naar een andere kolom",
    prevMonth: "Vorige maand",
    nextMonth: "Volgende maand",
    addOnDay: "Toevoegen op deze dag",
    clickToRename: "Klik om te hernoemen",
    delete: "Verwijderen",
  },

  // ---- Default onboarding questions (no-API-key fallback) ----------------
  onboarding: {
    level: {
      question: "Wat is je studieniveau?",
      options: {
        hs: "Middelbare school",
        ug: "Bachelor",
        grad: "Master / Postdoctoraal",
        self: "Zelfstudie",
      },
    },
    load: {
      question: "Hoeveel vakken jongleer je?",
      // 1–2, 3–4, 5–6, 7+ stay numeric across locales (see onboarding.ts).
    },
    track: {
      question: "Wat wil je het liefst bijhouden?",
      options: {
        assign: "Opdrachten",
        exams: "Tentamens",
        read: "Literatuur",
        notes: "Notities",
        habits: "Studiegewoontes",
        grades: "Cijfers",
      },
    },
    style: {
      question: "Hoe plan je het liefst?",
      options: {
        cal: "Via een agenda",
        board: "Via een bord",
        list: "Eenvoudige lijsten",
      },
    },
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  // The fixed labels the rule-based generator emits so the offline experience
  // is localized too. Course names derive from the user's own prompt.
  mock: {
    workspaceName: "Studie HQ",
    workspaceNameField: "{field} Studie HQ",
    welcome:
      "Gegenereerd op basis van je beschrijving: “{summary}”. Alles hier is een startpunt dat je kunt bewerken.",
    tbd: "Nog te bepalen",
    status: { notStarted: "Niet begonnen", inProgress: "Bezig", done: "Klaar" },
    type: { homework: "Huiswerk", quiz: "Quiz", exam: "Tentamen", project: "Project" },
    exam: { midterm: "Tussentijds tentamen", final: "Eindtentamen" },
    courses: {
      name: "Vakken",
      description: "Elk vak dat je dit semester volgt.",
      propCourse: "Vak",
      propCode: "Code",
      propInstructor: "Docent",
      propCredits: "Studiepunten",
      propSchedule: "Rooster",
      viewAll: "Alle vakken",
    },
    assignments: {
      name: "Opdrachten",
      description: "Huiswerk, quizzen, projecten en tentamens.",
      propName: "Opdracht",
      propCourse: "Vak",
      propType: "Type",
      propStatus: "Status",
      propDue: "Deadline",
      propWeight: "Weging %",
      viewAll: "Alle",
      viewBoard: "Op status",
      viewCalendar: "Agenda",
      projectMilestone: "Projectmijlpaal {n} — {code}",
    },
    readings: {
      name: "Leeslijst",
      description: "Wat je moet lezen, geordend per vak.",
      propTitle: "Titel",
      propCourse: "Vak",
      propRead: "Gelezen",
      propLink: "Link",
      viewAll: "Leeslijst",
      coreReading: "{course}: kernliteratuur",
    },
    habits: {
      name: "Studiegewoontes",
      description: "Een lichte wekelijkse consistentietracker.",
      propHabit: "Gewoonte",
      propDate: "Datum",
      propDone: "Klaar",
      propMinutes: "Minuten",
      viewAll: "Alle gewoontes",
      viewCalendar: "Agenda",
      reviewNotes: "Notities van vandaag doornemen",
      practiceRecall: "Actief ophalen oefenen",
    },
    grades: {
      name: "Cijfertracker",
      description: "Bewerkbare scores en wegingen voor elk vak.",
      propItem: "Toets",
      propCourse: "Vak",
      propScore: "Score",
      propOutOf: "Van",
      propWeight: "Weging %",
      viewAll: "Alle cijfers",
      assessmentN: "Toets {n}",
    },
    pages: {
      dashboard: "Dashboard",
      courses: "Vakken",
      assignments: "Opdrachten",
      planner: "Planner",
      readings: "Leeslijst",
      exams: "Tentamenvoorbereiding",
      notes: "Notities",
      habits: "Studiegewoontes",
      grades: "Cijfertracker",
    },
    dashboard: {
      assignmentsHeading: "📌 Opdrachten op status",
      coursesHeading: "📚 Mijn vakken",
    },
    assignmentsPage: { intro: "Alles wat je nog moet doen, met deadlines en wegingen." },
    plannerPage: { intro: "Je deadlines overzichtelijk op een agenda." },
    examsPage: {
      callout:
        "Bevestig de data en verdeel daarna elk tentamen in herhalingsonderwerpen en oefensessies.",
    },
    notesPage: {
      heading: "Vaknotities",
      callout:
        "Voeg voor elk college een kop toe en leg er de kernideeën en vragen onder vast.",
      fallbackCourse: "Vak",
      startWriting: "Begin hier met schrijven…",
    },
    gradesPage: {
      callout:
        "Vervang de begintoetsen door de wegingen uit je studiegids en je daadwerkelijke resultaten.",
    },
    // Workspace component plan (labels + descriptions shown in the loader).
    plan: {
      summaryWith: "Een werkruimte op maat, opgebouwd rond {focus}.",
      summaryGeneric:
        "Een werkruimte op maat voor vakken, deadlines en studieplanning.",
      components: {
        dashboard: {
          label: "Dashboard",
          description: "Je semester, prioriteiten en eerstvolgende deadlines.",
        },
        courses: {
          label: "Vakken",
          description: "Vakdetails, roosters en docenten.",
        },
        assignments: {
          label: "Opdrachten",
          description: "Studietaken, deadlines, wegingen en status.",
        },
        planner: {
          label: "Planner",
          description: "Een agendaweergave van het werk dat voor je ligt.",
        },
        readings: {
          label: "Leeslijst",
          description: "Voorgeschreven teksten en leesvoortgang.",
        },
        exams: {
          label: "Tentamenvoorbereiding",
          description: "Tentamendata, onderwerpen en herhalingstaken.",
        },
        notes: {
          label: "Notities",
          description: "Een gestructureerde plek voor vaknotities.",
        },
        habits: {
          label: "Studiegewoontes",
          description: "Dagelijkse studieroutines en consistentie.",
        },
        grades: {
          label: "Cijfertracker",
          description: "Scores, wegingen en cijferdoelen.",
        },
        projects: {
          label: "Projecten",
          description: "Mijlpalen en eerstvolgende acties voor groter werk.",
        },
      },
    },
  },
} satisfies Dictionary;
