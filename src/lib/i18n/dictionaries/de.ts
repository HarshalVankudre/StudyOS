import type { Dictionary } from "./en";

/** German (de-DE) — translation of the canonical English dictionary. */
export const de = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — Dein Lern-Workspace, gebaut von KI",
    homeDescription:
      "Beschreibe deine Kurse und Deadlines, und StudyOS baut dir sofort deine Dashboards, Planer und Aufgaben-Tracker. Der KI-gestützte Lern-Workspace für Studierende.",
    appTitle: "Deine Workspaces · StudyOS",
    generateTitle: "Workspace generieren · StudyOS",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Sprache",
    choose: "Sprache wählen",
  },

  // ---- Landing page ------------------------------------------------------
  landing: {
    nav: {
      howItWorks: "So funktioniert’s",
      features: "Funktionen",
      pricing: "Preise",
      openApp: "App öffnen",
      signIn: "Anmelden",
      getStarted: "Loslegen",
    },
    hero: {
      badge: "Gemacht für Studierende & Forschende",
      titleLine1: "Dein ganzes Semester,",
      titleLine2: "organisiert.",
      subtitle:
        "Beschreibe deine Kurse in einem Satz und StudyOS richtet dir die Dashboards, Planer und Tracker ein, die du brauchst — schon ausgefüllt. Keine Vorlagen, keine leeren Seiten.",
      ctaGenerate: "Meinen Workspace generieren",
      ctaDemo: "Demo ansehen",
      finePrint: "Kostenlos starten · Keine Kreditkarte · In Sekunden bereit",
    },
    builtFor: {
      label: "Gebaut für",
      items: [
        "Informatik",
        "Medizinvorbereitung",
        "Jura",
        "MBA",
        "Oberstufe",
        "Masterstudium",
      ],
    },
    how: {
      title: "Von einem Satz zum kompletten Workspace.",
      subtitle: "Drei Schritte, etwa zehn Sekunden.",
      steps: [
        {
          title: "Beschreibe deine Kurse",
          body: "Ein Satz — „Ich bereite mich auf Medizin vor und belege Anatomie, Biochemie und Physiologie.“",
        },
        {
          title: "Erhalte einen kompletten Workspace",
          body: "Kurse, ein Aufgaben-Board, ein Planer und eine Leseliste — schon eingerichtet und ausgefüllt.",
        },
        {
          title: "Lernen und anpassen",
          body: "Bearbeite alles, hake Aufgaben ab, bitte in einfachem Deutsch um Änderungen. Alles speichert automatisch.",
        },
      ],
    },
    features: {
      title: "Alles, was ein Semester braucht.",
      subtitle: "In einem Schritt für dich generiert — danach ganz nach deinem Geschmack.",
      items: {
        generate: {
          k: "Generieren",
          title: "Workspaces, gemacht für dich",
          body: "Ein Prompt wird zu einem kompletten Workspace, zugeschnitten auf genau deine Kurse.",
        },
        databases: {
          k: "Datenbanken",
          title: "Echte, strukturierte Daten",
          body: "Aufgaben, Noten und Lektüre als Tabellen mit eigenen Feldern — keine losen Notizen.",
        },
        calendar: {
          k: "Kalender",
          title: "Planer & Kalender",
          body: "Jede Deadline an einem Ort. Wechsle mit einem Klick zwischen Tabelle, Board und Kalender.",
        },
        dashboard: {
          k: "Dashboard",
          title: "Eine klare Homebase",
          body: "Eine Seite, die deine ganze Woche bündelt, damit du immer weißt, was als Nächstes ansteht.",
        },
        autosave: {
          k: "Autosave",
          title: "Bearbeiten, sofort gespeichert",
          body: "Umbenennen, abhaken, Zeilen hinzufügen — jede Änderung speichert sich selbst, sobald du sie machst.",
        },
        assistant: {
          k: "Assistent",
          title: "Frag in einfachem Deutsch",
          body: "„Füge CS eine Zwischenprüfung hinzu.“ Dein Workspace aktualisiert sich selbst, direkt vor deinen Augen.",
        },
      },
    },
    pricing: {
      title: "Einfache, studierendenfreundliche Preise.",
      subtitle: "Kostenlos starten. Nur upgraden, wenn du mehr willst.",
      perMonth: "/Mon.",
      free: {
        name: "Kostenlos",
        price: "$0",
        features: [
          "KI-Workspaces generieren",
          "Alles bearbeiten & automatisch speichern",
          "Dashboards, Datenbanken, Kalender",
          "Per einfachem Deutsch um Änderungen bitten",
        ],
        cta: "Loslegen",
      },
      pro: {
        badge: "Am beliebtesten",
        name: "Pro",
        price: "$5",
        features: [
          "Alles aus Kostenlos",
          "Unbegrenzte Generierungen",
          "Das klügste, detaillierteste Modell",
          "Priorisierter Support",
        ],
        cta: "Kostenlos starten, jederzeit upgraden",
      },
    },
    closing: {
      titleLine1: "Schluss mit dem Einrichten.",
      titleLine2: "Fang an zu lernen.",
      subtitle: "Dein erster Workspace ist nur einen Satz entfernt.",
      cta: "Meinen Workspace generieren",
    },
    footer: {
      tagline: "Der Lern-Workspace für Studierende · © 2026",
    },
    // The little workspace mockup in the hero.
    preview: {
      name: "CS Lern-Zentrale",
      thisWeek: "Diese Woche",
      columns: { todo: "Zu tun", doing: "In Arbeit", done: "Erledigt" },
      cards: ["Beweise-Quiz", "Linked-List-Übung", "Laborbericht 2"],
      coursesLabel: "Kurse",
      courses: ["Datenstrukturen", "Diskrete Mathematik", "Physik I"],
    },
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "Verwalten",
    upgrade: "Auf Pro upgraden",
    generate: "Generieren",
    upgradedBanner: "Du bist auf Pro — deine Workspaces nutzen jetzt das klügere Modell.",
    title: "Deine Workspaces",
    subtitle: "Alles, was StudyOS für dich gebaut hat.",
    total: "{count} insgesamt",
    emptyTitle: "Noch keine Workspaces",
    emptySubtitle: "Generiere einen oder lade die Demo, um dich umzusehen.",
    emptyGenerate: "Einen Workspace generieren",
    loadDemo: "Demo laden",
    updatedAt: "aktualisiert {date}",
    fallbackIcon: "📄",
  },

  // ---- Generate flow (/generate) ----------------------------------------
  generate: {
    backToWorkspaces: "Deine Workspaces →",
    examples: [
      { emoji: "💻", text: "Ich bin CS-Studi im 1. Jahr und belege 5 Kurse" },
      {
        emoji: "⚕️",
        text: "Medizinvorbereitung, 2. Jahr: Anatomie, Biochemie, Physiologie, Organische Chemie",
      },
      { emoji: "🎓", text: "Oberstufe, lerne 6 Fächer fürs Abitur" },
      {
        emoji: "📈",
        text: "MBA-Studi, belege Mikroökonomie, Rechnungswesen und Marketing",
      },
    ],
    planSteps: [
      "Deine Beschreibung wird gelesen",
      "Gute Fragen werden überlegt",
      "Dein Setup wird zugeschnitten",
    ],
    buildSteps: [
      "Deine Kurse werden geplant",
      "Dein Dashboard wird gestaltet",
      "Dein Planer wird angelegt",
      "Der Workspace wird zusammengesetzt",
    ],
    planningTitle: "Wir lernen dich kennen",
    buildingTitle: "Dein Workspace wird gebaut",
    errorGeneric: "Etwas ist schiefgelaufen. Bitte versuch es erneut.",
    errorBuild: "Beim Generieren deines Workspaces ist etwas schiefgelaufen. Versuch es erneut.",
    describe: {
      step: "Schritt 1 von 2",
      title: "Was studierst du?",
      subtitle:
        "Beschreibe deine Kurse und Ziele in einfachem Deutsch. StudyOS stellt ein paar kurze Fragen und gestaltet dann den ganzen Workspace rund um deine Antworten.",
      placeholder:
        "z. B. Ich bin CS-Studi im 1. Jahr und belege dieses Semester Datenstrukturen, Diskrete Mathematik, Analysis II und Wissenschaftliches Schreiben.",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "Weiter",
      examplesLabel: "Unsicher? Starte mit einem Beispiel",
      finePrint: "Kostenlos · keine Kreditkarte · in Sekunden bereit",
    },
    questions: {
      back: "← Beschreibung bearbeiten",
      step: "Schritt 2 von 2",
      title: "Lass es uns zuschneiden",
      designingFor: "Gestaltet für:",
      pickAny: "wähle beliebig viele",
      pickOne: "wähle eins",
      build: "Meinen Workspace bauen",
      answeredNone: "Beantworte ein paar oder bau einfach los — du entscheidest",
      answeredCount: "{n} / {total} beantwortet",
    },
  },

  // ---- AI activity overlay ----------------------------------------------
  aiActivity: {
    defaultTitle: "Wird bearbeitet",
    defaultSteps: [
      "Dein Workspace wird gelesen",
      "Die Änderungen werden geplant",
      "Das Layout wird gestaltet",
      "Es wird eingetragen",
    ],
    updatingTitle: "Dein Workspace wird aktualisiert",
  },

  // ---- Workspace editor --------------------------------------------------
  editor: {
    newPage: "Neue Seite",
    untitled: "Ohne Titel",
    allWorkspaces: "← Alle Workspaces",
    deletePage: "Seite löschen",
    askAi: "KI fragen",
    aiPlaceholder:
      "Bitte die KI, diesen Workspace zu ändern — „füge CS eine Zwischenprüfung hinzu“, „erstelle einen Lernplan fürs Examen“, „füge einen Gewohnheits-Tracker hinzu“…",
    aiWorking: "Wird bearbeitet…",
    aiApply: "Anwenden",
    aiClose: "Schließen",
    aiError: "Das ließ sich nicht anwenden — formuliere die Anfrage um oder vereinfache sie.",
    saving: "Wird gespeichert…",
    saveFailed: "Speichern fehlgeschlagen",
    saved: "Gespeichert",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    addBlock: "+ Block hinzufügen",
    cancel: "Abbrechen",
    deleteBlock: "Block löschen",
    blockTypes: {
      paragraph: "Text",
      heading: "Überschrift",
      todo: "Aufgabe",
      bulleted_list_item: "Liste",
      callout: "Hinweis",
      divider: "Trennlinie",
      database: "Tabelle",
    },
    placeholders: {
      paragraph: "Schreib etwas…",
      todo: "Aufgabe",
      listItem: "Listeneintrag",
      callout: "Hinweis",
    },
    headingDefault: "Überschrift",
    // Defaults for a brand-new table inserted via "+ Add block → Table".
    newTable: {
      name: "Neue Tabelle",
      propName: "Name",
      propStatus: "Status",
      propDue: "Fällig",
      statusTodo: "Zu tun",
      statusInProgress: "In Arbeit",
      statusDone: "Erledigt",
      viewTable: "Tabelle",
    },
  },

  // ---- Database views (table / board / calendar) ------------------------
  db: {
    nameAria: "Datenbankname",
    newRow: "+ Neue Zeile",
    newCard: "+ Neu",
    untitled: "Ohne Titel",
    empty: "—",
    link: "Link ↗",
    linked: "{count} verknüpft",
    deleteRow: "Zeile löschen",
    deleteCard: "Karte löschen",
    dragHint: "In eine andere Spalte ziehen",
    prevMonth: "Voriger Monat",
    nextMonth: "Nächster Monat",
    addOnDay: "An diesem Tag hinzufügen",
    clickToRename: "Zum Umbenennen klicken",
    delete: "Löschen",
  },

  // ---- Default onboarding questions (no-API-key fallback) ----------------
  onboarding: {
    level: {
      question: "Was ist dein Lernniveau?",
      options: {
        hs: "Oberstufe",
        ug: "Bachelor",
        grad: "Master / Promotion",
        self: "Selbststudium",
      },
    },
    load: {
      question: "Wie viele Kurse jonglierst du gerade?",
      // 1–2, 3–4, 5–6, 7+ stay numeric across locales (see onboarding.ts).
    },
    track: {
      question: "Was möchtest du am liebsten verfolgen?",
      options: {
        assign: "Aufgaben",
        exams: "Prüfungen",
        read: "Lektüre",
        notes: "Notizen",
        habits: "Lerngewohnheiten",
        grades: "Noten",
      },
    },
    style: {
      question: "Wie planst du am liebsten?",
      options: {
        cal: "Nach Kalender",
        board: "Nach Board",
        list: "Einfache Listen",
      },
    },
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  // The fixed labels the rule-based generator emits so the offline experience
  // is localized too. Course names derive from the user's own prompt.
  mock: {
    workspaceName: "Lern-Zentrale",
    workspaceNameField: "{field} Lern-Zentrale",
    welcome:
      "Generiert aus deiner Beschreibung: „{summary}“. Alles hier ist ein Ausgangspunkt, den du bearbeiten kannst.",
    tbd: "Noch offen",
    status: { notStarted: "Nicht begonnen", inProgress: "In Arbeit", done: "Erledigt" },
    type: { homework: "Hausaufgabe", quiz: "Quiz", exam: "Prüfung", project: "Projekt" },
    exam: { midterm: "Zwischenprüfung", final: "Abschlussprüfung" },
    courses: {
      name: "Kurse",
      description: "Jeder Kurs, den du dieses Semester belegst.",
      propCourse: "Kurs",
      propCode: "Kürzel",
      propInstructor: "Dozent/in",
      propCredits: "Credits",
      propSchedule: "Zeitplan",
      viewAll: "Alle Kurse",
    },
    assignments: {
      name: "Aufgaben",
      description: "Hausaufgaben, Quizze, Projekte und Prüfungen.",
      propName: "Aufgabe",
      propCourse: "Kurs",
      propType: "Typ",
      propStatus: "Status",
      propDue: "Fällig",
      propWeight: "Gewicht %",
      viewAll: "Alle",
      viewBoard: "Nach Status",
      viewCalendar: "Kalender",
      projectMilestone: "Projekt-Meilenstein {n} — {code}",
    },
    readings: {
      name: "Leseliste",
      description: "Was zu lesen ist, nach Kurs sortiert.",
      propTitle: "Titel",
      propCourse: "Kurs",
      propRead: "Gelesen",
      propLink: "Link",
      viewAll: "Leseliste",
      coreReading: "{course}: Pflichtlektüre",
    },
    habits: {
      name: "Lerngewohnheiten",
      description: "Ein schlanker wöchentlicher Konsistenz-Tracker.",
      propHabit: "Gewohnheit",
      propDate: "Datum",
      propDone: "Erledigt",
      propMinutes: "Minuten",
      viewAll: "Alle Gewohnheiten",
      viewCalendar: "Kalender",
      reviewNotes: "Heutige Notizen durchgehen",
      practiceRecall: "Abrufen üben",
    },
    grades: {
      name: "Noten-Tracker",
      description: "Bearbeitbare Punkte und Gewichtungen für jeden Kurs.",
      propItem: "Leistung",
      propCourse: "Kurs",
      propScore: "Punkte",
      propOutOf: "Von",
      propWeight: "Gewicht %",
      viewAll: "Alle Noten",
      assessmentN: "Leistung {n}",
    },
    pages: {
      dashboard: "Dashboard",
      courses: "Kurse",
      assignments: "Aufgaben",
      planner: "Planer",
      readings: "Leseliste",
      exams: "Prüfungsvorbereitung",
      notes: "Notizen",
      habits: "Lerngewohnheiten",
      grades: "Noten-Tracker",
    },
    dashboard: {
      assignmentsHeading: "📌 Aufgaben nach Status",
      coursesHeading: "📚 Meine Kurse",
    },
    assignmentsPage: { intro: "Alles, was ansteht, mit Fälligkeitsdaten und Gewichtungen." },
    plannerPage: { intro: "Deine Deadlines übersichtlich auf einem Kalender." },
    examsPage: {
      callout:
        "Bestätige die Termine und teile dann jede Prüfung in Wiederholungsthemen und Übungseinheiten auf.",
    },
    notesPage: {
      heading: "Kursnotizen",
      callout:
        "Füge für jede Vorlesung eine Überschrift hinzu und halte darunter Kernideen und Fragen fest.",
      fallbackCourse: "Kurs",
      startWriting: "Hier mit dem Schreiben beginnen…",
    },
    gradesPage: {
      callout:
        "Ersetze die Beispielleistungen durch die Gewichtungen aus deinem Modulplan und deine echten Ergebnisse.",
    },
    // Workspace component plan (labels + descriptions shown in the loader).
    plan: {
      summaryWith: "Ein maßgeschneiderter Workspace rund um {focus}.",
      summaryGeneric:
        "Ein maßgeschneiderter Workspace für Kurse, Deadlines und Lernplanung.",
      components: {
        dashboard: {
          label: "Dashboard",
          description: "Dein Semester, deine Prioritäten und die nächsten Deadlines.",
        },
        courses: {
          label: "Kurse",
          description: "Kursdetails, Zeitpläne und Dozent/innen.",
        },
        assignments: {
          label: "Aufgaben",
          description: "Studienarbeit, Deadlines, Gewichtungen und Status.",
        },
        planner: {
          label: "Planer",
          description: "Eine Kalenderansicht der anstehenden Arbeit.",
        },
        readings: {
          label: "Leseliste",
          description: "Pflichtlektüre und Lesefortschritt.",
        },
        exams: {
          label: "Prüfungsvorbereitung",
          description: "Prüfungstermine, Themen und Wiederholungsaufgaben.",
        },
        notes: {
          label: "Notizen",
          description: "Ein strukturiertes Zuhause für deine Kursnotizen.",
        },
        habits: {
          label: "Lerngewohnheiten",
          description: "Tägliche Lernroutinen und Konsistenz.",
        },
        grades: {
          label: "Noten-Tracker",
          description: "Punkte, Gewichtungen und Notenziele.",
        },
        projects: {
          label: "Projekte",
          description: "Meilensteine und nächste Schritte für größere Arbeiten.",
        },
      },
    },
  },
} satisfies Dictionary;
