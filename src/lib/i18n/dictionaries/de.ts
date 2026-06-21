import type { Dictionary } from "./en";

/** German (de-DE) — translation of the canonical English dictionary. */
export const de = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — Dein Lern-Workspace, gebaut von KI",
    homeDescription:
      "Beschreibe deine Kurse und Deadlines, und StudyOS baut dir sofort deine Dashboards, Planer und Aufgaben-Tracker. Der KI-gestützte Lern-Workspace für Studierende.",
    appTitle: "Deine Workspaces · StudyOS",
    generateTitle: "Deinen Workspace generieren · StudyOS",
    pricingTitle: "Preise · StudyOS",
    pricingDescription:
      "Vergleiche StudyOS Kostenlos und Pro. Starte kostenlos und upgrade, wenn du das leistungsfähigste Modell, unbegrenzte Generierungen und priorisierten Support willst.",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Sprache",
    choose: "Sprache wählen",
  },

  // ---- Shared bits used on more than one surface ------------------------
  common: {
    openApp: "App öffnen",
    signIn: "Anmelden",
    getStarted: "Loslegen",
    cancel: "Abbrechen",
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
    preview: {
      name: "CS Lern-Zentrale",
      thisWeek: "Diese Woche",
      columns: { todo: "Zu tun", doing: "In Arbeit", done: "Erledigt" },
      cards: ["Beweise-Quiz", "Linked-List-Übung", "Laborbericht 2"],
      coursesLabel: "Kurse",
      courses: ["Datenstrukturen", "Diskrete Mathematik", "Physik I"],
    },
  },

  // ---- Pricing page (/pricing) ------------------------------------------
  pricing: {
    nav: { openApp: "App öffnen", signIn: "Anmelden", getStarted: "Loslegen" },
    badge: "Einfache, studierendenfreundliche Preise",
    title: "Kostenlos starten. Upgrade, wenn du bereit bist.",
    subtitle:
      "Alles, was du brauchst, um dein Semester zu organisieren, ist kostenlos. Pro ergänzt das leistungsfähigste Modell, unbegrenzte Generierungen und priorisierten Support.",
    free: {
      name: "Kostenlos",
      price: "$0",
      tagline: "Alles, um organisiert zu werden.",
      bullets: [
        "KI-generierte Lern-Workspaces",
        "Vollständiges Inline-Bearbeiten & Autosave",
        "Datenbanken — Tabelle, Board & Kalender",
        "KI-Agent-Chat in deinem Workspace",
      ],
      ctaSignedOut: "Kostenlos loslegen",
      ctaSignedIn: "Deine Workspaces öffnen",
      bulletCredits: "{count} KI-Credits zum Start",
    },
    pro: {
      badge: "Am beliebtesten",
      name: "Pro",
      price: "$5",
      perMonth: "/Mon.",
      billed: "Monatlich abgerechnet · jederzeit kündbar.",
      bullets: [
        "Alles aus Kostenlos",
        "Unbegrenzte Workspace-Generierungen",
        "Das leistungsfähigste, detaillierteste Modell",
        "Priorisierter Support & früher Zugang",
      ],
      currentPlan: "✦ Dein aktueller Tarif",
      manageBilling: "Abrechnung verwalten",
      upgrade: "Auf Pro upgraden",
      ctaSignedOut: "Mit Pro loslegen",
      bulletCredits: "{count} KI-Credits inklusive",
    },
    comparison: {
      title: "Tarife vergleichen",
      featuresHeader: "Funktionen",
      freeHeader: "Kostenlos",
      proHeader: "Pro",
      included: "Enthalten",
      notIncluded: "Nicht enthalten",
      features: {
        aiWorkspaces: "KI-generierte Workspaces",
        onboarding: "Geführte Onboarding-Fragen",
        editing: "Vollständiges Inline-Bearbeiten & Autosave",
        databases: "Datenbanken — Tabelle, Board & Kalender",
        dragDrop: "Bearbeiten per Drag-and-drop",
        agentChat: "KI-Agent-Chat, der deinen Workspace bearbeitet",
        model: "Generierungsmodell",
        generations: "Workspace-Generierungen",
        support: "Support",
        earlyAccess: "Früher Zugang zu neuen Funktionen",
        credits: "Inkludierte KI-Credits",
        buyMore: "Jederzeit weitere Credits kaufen",
      },
      values: {
        standard: "Standard",
        mostCapable: "Leistungsfähigstes",
        generous: "Großzügig",
        unlimited: "Unbegrenzt",
        community: "Community",
        priority: "Priorisiert",
      },
    },
    credits: {
      heading: "KI läuft mit Credits",
      intro:
        "Jede KI-Anfrage verbraucht Credits, je nachdem, wie viel sie leistet — eine schnelle Anpassung kostet wenig, einen ganzen Workspace zu bauen kostet mehr. Pro kommt randvoll mit Credits, und du kannst jederzeit aufladen.",
      freeIncludes: "Kostenlos enthält {count} Start-Credits",
      proIncludes: "Pro enthält {count} Credits",
      neverExpire: "Jederzeit aufladen — Credits verfallen nie",
      balance: "Dein Guthaben: {count} Credits",
      pack: "Credit-Paket",
      unit: "Credits",
      buy: "{count} Credits kaufen",
      signUpToBuy: "Registriere dich, um Credits zu kaufen",
      oneTime: "Einmaliger Kauf · sichere Bezahlung",
    },
    faqTitle: "Fragen",
    faq: [
      {
        q: "Ist StudyOS wirklich kostenlos zum Starten?",
        a: "Ja. Erstelle ein Konto und generiere, bearbeite und nutze deine Workspaces im Kostenlos-Tarif — keine Kreditkarte nötig.",
      },
      {
        q: "Was bekomme ich mit Pro?",
        a: "Unbegrenzte Generierungen, das leistungsfähigste Modell für reichhaltigere und genauere Workspaces, priorisierten Support und frühen Zugang zu neuen Funktionen.",
      },
      {
        q: "Kann ich jederzeit kündigen?",
        a: "Jederzeit. Verwalte oder kündige dein Abo im Abrechnungsportal — Pro bleibt dir bis zum Ende des Zeitraums erhalten.",
      },
      {
        q: "Was passiert mit meinen Workspaces, wenn ich downgrade?",
        a: "Nichts wird gelöscht. Deine Workspaces bleiben genau so, wie sie sind, und sind im Kostenlos-Tarif weiterhin voll bearbeitbar.",
      },
    ],
    ctaTitle: "Dein erster Workspace ist nur einen Satz entfernt.",
    ctaSubtitle: "Teste StudyOS kostenlos — upgrade nur, wenn du mehr willst.",
    ctaSignedIn: "Einen Workspace generieren",
    ctaSignedOut: "Kostenlos loslegen",
    footerTagline: "Der Lern-Workspace für Studierende · © 2026",
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
    planningTitle: "Wir lernen dich kennen",
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
      other: "Sonstiges",
      otherPlaceholder: "Gib deine eigene Vorliebe ein…",
      otherAria: "Andere Antwort für {question}",
    },
  },

  // ---- Generation activity (full-screen build progress) -----------------
  genActivity: {
    building: "Dein Workspace wird gebaut",
    designing: "Dein Workspace wird gestaltet",
    componentsChosen: "Für dich ausgewählte Komponenten",
    planningComponents: "Komponenten werden geplant",
    onlyRelevant: "Nur die Seiten und Tracker, die für deine Antworten relevant sind.",
    componentsCount: "{count} Komponenten",
    everythingEditable:
      "Alles Generierte bleibt bearbeitbar — Seiten, Felder, Ansichten, Zeilen und Inhalte.",
    statusReady: "Bereit",
    statusGenerating: "Wird generiert…",
    statusQueued: "In Warteschlange",
    finishingUp: "Wird abgeschlossen",
    yourWorkspace: "Dein Workspace",
    pagesLabel: "Seiten",
    sectionsBuilt: "{built} von {total} Bereichen gebaut",
    choosingPieces: "Die passenden Bausteine für dich werden gewählt…",
    stillEditable: "Alles bleibt bearbeitbar, sobald es fertig ist",
    writingItIn: "Wird eingetragen…",
    board: { todo: "Zu tun", doing: "In Arbeit", done: "Erledigt" },
    phase: {
      analyzing: "Deine Antworten werden analysiert",
      planning: "Komponenten werden ausgewählt",
      generating: "Workspace wird generiert",
      validating: "Daten werden geprüft",
      saving: "Wird gespeichert",
    },
  },

  // ---- AiActivity overlay (calm spinner used during planning) -----------
  aiActivity: {
    defaultTitle: "Wird bearbeitet",
    defaultSteps: [
      "Dein Workspace wird gelesen",
      "Die Änderungen werden geplant",
      "Das Layout wird gestaltet",
      "Es wird eingetragen",
    ],
  },

  // ---- Workspace editor chrome ------------------------------------------
  editor: {
    workspaceIcon: "Workspace-Symbol",
    newPage: "Neue Seite",
    untitled: "Ohne Titel",
    allWorkspaces: "← Alle Workspaces",
    deletePage: "Seite löschen",
    askAi: "KI fragen",
    closeAgent: "Agent schließen",
    saving: "Wird gespeichert…",
    saveFailed: "Speichern fehlgeschlagen",
    saved: "Gespeichert",
  },

  // ---- In-workspace AI agent chat ---------------------------------------
  agentChat: {
    title: "KI-Agent",
    subtitleIdle: "Versteht deinen gesamten Workspace",
    closeChat: "Chat schließen",
    suggestions: [
      "Einen Gewohnheits-Tracker hinzufügen",
      "Einen 2-wöchigen Lernplan fürs Examen erstellen",
      "Jedem Kurs eine Zwischenprüfung hinzufügen",
      "Worauf sollte ich mich diese Woche konzentrieren?",
    ],
    intro:
      "Bitte mich, ein einzelnes Element zu ändern oder Aktualisierungen über deinen gesamten Workspace zu koordinieren. Wenn etwas unklar ist, frage ich nach, bevor ich etwas bearbeite.",
    workspaceUpdated: "Workspace aktualisiert",
    undo: "Rückgängig",
    undoing: "Wird rückgängig gemacht…",
    undone: "Änderung rückgängig gemacht",
    undoFailed: "Diese Änderung kann nicht rückgängig gemacht werden, weil sich der Arbeitsbereich geändert hat.",
    buildingUpdate: "Deine Aktualisierung wird erstellt",
    thinking: "Denkt nach…",
    stopTask: "Aufgabe stoppen",
    stopping: "Wird gestoppt…",
    taskStopped: "Aufgabe gestoppt.",
    stopFailed: "Die Aufgabe konnte nicht gestoppt werden. Sie läuft möglicherweise weiter.",
    steps: {
      inspect: "Workspace prüfen",
      decide: "Sicherste Aktion festlegen",
      prepare: "Koordinierte Aktualisierung vorbereiten",
    },
    phase: {
      inspecting: "Dein Workspace wird durchgesehen",
      planning: "Die sicherste Änderung wird geplant",
      updating: "Workspace-Aktualisierungen werden koordiniert",
      validating: "Jede Verbindung wird geprüft",
      saving: "Deine Änderungen werden gespeichert",
    },
    areaStatus: { queued: "In Warteschlange", working: "Wird aktualisiert", complete: "Bereit" },
    initialMessage: "Dein Workspace wird geöffnet",
    placeholderBusy: "Der Agent arbeitet…",
    placeholderIdle: "Bitte den Agenten, etwas zu bauen oder zu ändern…",
    send: "Senden",
    inputHint: "Enter zum Senden · Umschalt+Enter für eine neue Zeile",
    errorRequestFailed: "Agent-Anfrage fehlgeschlagen",
    errorEndedUnexpectedly: "Agent-Antwort unerwartet beendet",
    errorSnag: "Beim Agenten gab es ein Problem. Bitte versuch es erneut.",
    errorCouldntComplete:
      "Das ließ sich nicht sicher abschließen. Versuch es erneut oder formuliere die Anfrage konkreter.",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    pageIcon: "Seitensymbol",
    headingLevel: "Überschriftenebene",
    calloutIcon: "Hinweissymbol",
    addBlock: "+ Block hinzufügen",
    deleteBlock: "Block löschen",
    blockTypes: {
      paragraph: "Text",
      heading: "Überschrift",
      todo: "Aufgabe",
      bulleted_list_item: "Liste",
      numbered_list_item: "Nummeriert",
      quote: "Zitat",
      callout: "Hinweis",
      divider: "Trennlinie",
      database: "Tabelle",
      media: "Bild",
    },
    placeholders: {
      paragraph: "Schreib etwas…",
      todo: "Aufgabe",
      listItem: "Listeneintrag",
      callout: "Hinweis",
    },
    headingDefault: "Überschrift",
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
    databaseIcon: "Datenbanksymbol",
    nameAria: "Datenbankname",
    newRow: "+ Neue Zeile",
    newCard: "+ Neu",
    untitled: "Ohne Titel",
    empty: "—",
    deleteRow: "Zeile löschen",
    deleteCard: "Karte löschen",
    dragHint: "In eine andere Spalte ziehen",
    prevMonth: "Voriger Monat",
    nextMonth: "Nächster Monat",
    addOnDay: "An diesem Tag hinzufügen",
    clickToRename: "Zum Umbenennen klicken",
    delete: "Löschen",
  },

  // ---- Database settings panel ------------------------------------------
  dbSettings: {
    customize: "Felder & Ansichten anpassen",
    description: "Beschreibung",
    descriptionPlaceholder: "Wofür dieser Tracker da ist",
    fields: "Felder",
    addField: "+ Feld hinzufügen",
    fieldName: "Feldname",
    fieldType: "Feldtyp",
    deleteField: "Feld löschen",
    newField: "Neues Feld",
    chooseRelatedDatabase: "Verknüpfte Datenbank wählen",
    optionLabel: "Optionsbezeichnung",
    addOption: "+ Option",
    newOption: "Neue Option",
    views: "Ansichten",
    addView: "+ Ansicht hinzufügen",
    viewName: "Ansichtsname",
    newView: "Neue Ansicht",
    deleteView: "Ansicht löschen",
    groupBy: "Gruppieren nach…",
    dateField: "Datumsfeld…",
    deleteDatabase: "Diese Datenbank löschen",
    deleteConfirm: "„{name}“ löschen und von jeder Seite entfernen?",
    propertyTypes: {
      text: "Text",
      number: "Zahl",
      checkbox: "Kontrollkästchen",
      date: "Datum",
      select: "Auswahl",
      multi_select: "Mehrfachauswahl",
      status: "Status",
      url: "URL",
      relation: "Beziehung",
    },
    viewTypes: {
      table: "Tabelle",
      board: "Board",
      calendar: "Kalender",
      list: "Liste",
      gallery: "Galerie",
    },
    defaults: {
      statusTodo: "Zu tun",
      statusInProgress: "In Arbeit",
      statusDone: "Erledigt",
      option1: "Option 1",
      option2: "Option 2",
    },
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
    load: { question: "Wie viele Kurse jonglierst du gerade?" },
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
      options: { cal: "Nach Kalender", board: "Nach Board", list: "Einfache Listen" },
    },
  },

  // ---- Server-emitted AI progress + errors ------------------------------
  ai: {
    generate: {
      phase: {
        analyzing: "Deine Kurse, Ziele und Vorlieben werden gelesen",
        planning: "Die richtigen Workspace-Komponenten werden ausgewählt",
        generating: "Dein kompletter Workspace wird in einem Durchgang generiert",
        validating: "Verknüpfungen, Ansichten, Felder und Startdaten werden geprüft",
        saving: "Dein bearbeitbarer Workspace wird gespeichert",
      },
      error:
        "Der Workspace konnte nicht generiert werden. Bitte versuch es mit einer kürzeren Beschreibung erneut.",
      detail: {
        dashboard: "{count} bearbeitbare Seiten verbunden",
        courses: "{count} Kurse hinzugefügt",
        trackedItems: "{count} verfolgte Elemente hinzugefügt",
        scheduled: "{count} Elemente eingeplant",
        readings: "{count} Leseeinträge hinzugefügt",
        habits: "{count} Routinen hinzugefügt",
        grades: "{count} Notenzeilen hinzugefügt",
        notes: "Bearbeitbare Notizstruktur erstellt",
        generic: "Komponente erstellt und verbunden",
      },
    },
    agent: {
      inspecting: "{pages} Seiten und {databases} Datenbanken werden durchgesehen",
      inspectingArea: "{area} wird durchgesehen",
      planning: "Die Anfrage wird verstanden und auf Mehrdeutigkeit geprüft",
      updating: "Koordinierte Änderungen werden über deinen Workspace angewendet",
      validating: "Verweise, Ansichten, Felder und verknüpfte Daten werden geprüft",
      saving: "Der aktualisierte Workspace wird gespeichert",
      workspaceNotFound: "Workspace nicht gefunden.",
      workspaceChanged: "Dein Arbeitsbereich wurde während meiner Arbeit geändert. Bitte versuche es erneut.",
      undoUnavailable: "Diese Änderung kann nicht rückgängig gemacht werden, weil der Arbeitsbereich neuere Änderungen enthält.",
      error:
        "Der Agent konnte diese Anfrage nicht sicher abschließen. Bitte versuch es erneut oder formuliere die Anfrage konkreter.",
      fallbackReply: "Dein Workspace wurde aktualisiert.",
    },
    errors: {
      notAuthenticated: "Nicht authentifiziert",
      invalidAgentRequest: "Ungültige Agent-Anfrage",
      describeBeforeGenerating:
        "Beschreibe dein Studium, bevor du einen Workspace generierst.",
    },
  },

  // ---- Credits ----------------------------------------------------------
  credits: {
    label: "KI-Credits",
    amount: "{count} Credits",
    buy: "Credits kaufen",
    metaTitle: "Credits kaufen · StudyOS",
    pageIntro:
      "Credits treiben jede KI-Anfrage an — Workspaces generieren und mit dem Agenten chatten. Lade jederzeit auf; Credits verfallen nie.",
    oneTimeExpire: "Einmaliger Kauf · sichere Bezahlung · Credits verfallen nie",
    wantMore: "Willst du das leistungsfähigste Modell und inkludierte Credits?",
    spentOn: "Werden für KI-Generierungen und Agent-Bearbeitungen ausgegeben.",
    addedBanner: "{added} Credits hinzugefügt — du hast jetzt {total}.",
    outGenerate:
      "Deine KI-Credits sind aufgebraucht. Lade auf der Preise-Seite mehr nach, um weiter zu generieren.",
    outAgent:
      "Deine KI-Credits sind aufgebraucht. Lade auf der Preise-Seite mehr nach, um den Agenten weiter zu nutzen.",
  },

  // ---- Account menu -----------------------------------------------------
  account: {
    pro: "Pro",
    free: "Kostenlos",
    fallbackName: "Konto",
    viewProfile: "Profil ansehen",
    manageProfile: "Profil verwalten",
    subscriptionPayments: "Abo & Zahlungen",
    buyCredits: "Credits kaufen",
    settings: "Einstellungen",
    signOut: "Abmelden",
    manageAccount: "Konto verwalten",
    creditsAndPlan: "{credits} Credits · {plan}",
  },

  // ---- Account settings page --------------------------------------------
  settings: {
    metaTitle: "Kontoeinstellungen · StudyOS",
    back: "← Workspaces",
    title: "Kontoeinstellungen",
    subtitle: "Verwalte dein Profil, deinen Tarif, deine Zahlungen und deine Credits.",
    profile: "Profil",
    yourAccount: "Dein Konto",
    subscription: "Abo",
    proDesc:
      "Du bist auf Pro — das leistungsfähigste Modell und priorisierter Support. Verwalte unten dein Abo, deine Zahlungsmethoden und deine Rechnungen.",
    freeDesc:
      "Du bist im Kostenlos-Tarif. Upgrade auf Pro für das leistungsfähigste Modell, inkludierte Credits und priorisierten Support.",
    manageSubscription: "Abo & Zahlungen verwalten",
    upgrade: "Auf Pro upgraden",
    comparePlans: "Tarife vergleichen",
    creditsDesc:
      "Credits treiben jede KI-Anfrage an. Lade jederzeit auf — Credits verfallen nie.",
    buyPack: "{count} Credits kaufen · ${price}",
    viewPricing: "Preise ansehen",
    signOut: "Abmelden",
  },

  // ---- Workspace card (delete control) ----------------------------------
  workspaceCard: {
    delete: "Workspace löschen",
    deleteAria: "{name} löschen",
    deleteConfirm:
      "„{name}“ löschen?\n\nDadurch werden der Workspace und alles darin dauerhaft entfernt. Das kann nicht rückgängig gemacht werden.",
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
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
      },
    },
  },
} satisfies Dictionary;
