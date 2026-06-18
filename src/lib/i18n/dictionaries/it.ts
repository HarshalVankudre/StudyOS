import type { Dictionary } from "./en";

/** Italian (it-IT) — translation of the canonical English dictionary. */
export const it = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — Il tuo spazio di studio, creato dall’IA",
    homeDescription:
      "Descrivi i tuoi corsi e le tue scadenze e StudyOS crea all’istante le tue dashboard, i planner e i tracker delle attività. Lo spazio di studio potenziato dall’IA per studenti.",
    appTitle: "I tuoi spazi · StudyOS",
    generateTitle: "Genera il tuo spazio · StudyOS",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Lingua",
    choose: "Scegli la lingua",
  },

  // ---- Landing page ------------------------------------------------------
  landing: {
    nav: {
      howItWorks: "Come funziona",
      features: "Funzionalità",
      pricing: "Prezzi",
      openApp: "Apri l’app",
      signIn: "Accedi",
      getStarted: "Inizia ora",
    },
    hero: {
      badge: "Pensato per studenti e ricercatori",
      titleLine1: "Tutto il tuo semestre,",
      titleLine2: "organizzato.",
      subtitle:
        "Descrivi i tuoi corsi in una frase e StudyOS prepara le dashboard, i planner e i tracker di cui hai bisogno — già compilati. Niente modelli, niente pagine vuote.",
      ctaGenerate: "Genera il mio spazio",
      ctaDemo: "Guarda una demo",
      finePrint: "Inizia gratis · Nessuna carta di credito · Pronto in pochi secondi",
    },
    builtFor: {
      label: "Creato per",
      items: [
        "Informatica",
        "Pre-med",
        "Giurisprudenza",
        "MBA",
        "Scuola superiore",
        "Magistrale",
      ],
    },
    how: {
      title: "Da una frase a uno spazio di lavoro completo.",
      subtitle: "Tre passaggi, circa dieci secondi.",
      steps: [
        {
          title: "Descrivi i tuoi corsi",
          body: "Una frase — “Sono uno studente pre-med e seguo Anatomia, Biochimica e Fisiologia.”",
        },
        {
          title: "Ottieni uno spazio completo",
          body: "Corsi, una bacheca delle attività, un planner e una lista di letture — già pronti e compilati.",
        },
        {
          title: "Studia e adatta",
          body: "Modifica qualsiasi cosa, spunta le attività, chiedi cambiamenti in un linguaggio naturale. Tutto si salva da solo.",
        },
      ],
    },
    features: {
      title: "Tutto ciò che serve a un semestre.",
      subtitle: "Generato per te in un solo passaggio — poi è tutto tuo da modellare.",
      items: {
        generate: {
          k: "Genera",
          title: "Spazi creati su misura per te",
          body: "Un solo prompt diventa uno spazio completo adattato esattamente ai tuoi corsi.",
        },
        databases: {
          k: "Database",
          title: "Dati reali e strutturati",
          body: "Attività, voti e letture come tabelle con campi personalizzati — non appunti sparsi.",
        },
        calendar: {
          k: "Calendario",
          title: "Planner e calendario",
          body: "Ogni scadenza in un unico posto. Passa da tabella a bacheca a calendario con un clic.",
        },
        dashboard: {
          k: "Dashboard",
          title: "Una base chiara e ordinata",
          body: "Una pagina che riunisce tutta la tua settimana così sai sempre cosa viene dopo.",
        },
        autosave: {
          k: "Salvataggio automatico",
          title: "Modifica, salvato all’istante",
          body: "Rinomina, spunta, aggiungi righe — ogni modifica si salva da sola nel momento in cui la fai.",
        },
        assistant: {
          k: "Assistente",
          title: "Chiedi in linguaggio naturale",
          body: "“Aggiungi una prova intermedia a Informatica.” Il tuo spazio si aggiorna da solo, davanti ai tuoi occhi.",
        },
      },
    },
    pricing: {
      title: "Prezzi semplici e su misura per gli studenti.",
      subtitle: "Inizia gratis. Passa a un piano superiore solo quando vuoi di più.",
      perMonth: "/mese",
      free: {
        name: "Gratis",
        price: "$0",
        features: [
          "Genera spazi con l’IA",
          "Modifica e salva tutto in automatico",
          "Dashboard, database, calendario",
          "Chiedi modifiche in linguaggio naturale",
        ],
        cta: "Inizia ora",
      },
      pro: {
        badge: "Il più popolare",
        name: "Pro",
        price: "$5",
        features: [
          "Tutto ciò che c’è in Gratis",
          "Generazioni illimitate",
          "Il modello più intelligente e dettagliato",
          "Supporto prioritario",
        ],
        cta: "Inizia gratis, passa a Pro quando vuoi",
      },
    },
    closing: {
      titleLine1: "Smetti di configurare.",
      titleLine2: "Inizia a studiare.",
      subtitle: "Il tuo primo spazio è a una frase di distanza.",
      cta: "Genera il mio spazio",
    },
    footer: {
      tagline: "Lo spazio di studio per studenti · © 2026",
    },
    // The little workspace mockup in the hero.
    preview: {
      name: "Quartier generale Informatica",
      thisWeek: "Questa settimana",
      columns: { todo: "Da fare", doing: "In corso", done: "Fatto" },
      cards: ["Quiz sulle dimostrazioni", "Lab liste concatenate", "Relazione di laboratorio 2"],
      coursesLabel: "Corsi",
      courses: ["Strutture dati", "Matematica discreta", "Fisica I"],
    },
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "Gestisci",
    upgrade: "Passa a Pro",
    generate: "Genera",
    upgradedBanner: "Sei su Pro — i tuoi spazi ora usano il modello più intelligente.",
    title: "I tuoi spazi",
    subtitle: "Tutto ciò che StudyOS ha creato per te.",
    total: "{count} in totale",
    emptyTitle: "Ancora nessuno spazio",
    emptySubtitle: "Generane uno, oppure carica la demo per dare un’occhiata.",
    emptyGenerate: "Genera uno spazio",
    loadDemo: "Carica demo",
    updatedAt: "aggiornato {date}",
    fallbackIcon: "📄",
  },

  // ---- Generate flow (/generate) ----------------------------------------
  generate: {
    backToWorkspaces: "I tuoi spazi →",
    examples: [
      { emoji: "💻", text: "Sono uno studente del 1° anno di Informatica e seguo 5 corsi" },
      {
        emoji: "⚕️",
        text: "Studente pre-med al secondo anno: Anatomia, Biochimica, Fisiologia, Chimica organica",
      },
      { emoji: "🎓", text: "Studente del penultimo anno delle superiori, studio 6 materie per gli esami finali" },
      {
        emoji: "📈",
        text: "Studente MBA che segue Microeconomia, Contabilità e Marketing",
      },
    ],
    planSteps: [
      "Sto leggendo la tua descrizione",
      "Sto pensando a domande utili",
      "Sto personalizzando la tua configurazione",
    ],
    buildSteps: [
      "Sto pianificando i tuoi corsi",
      "Sto progettando la tua dashboard",
      "Sto impostando il tuo planner",
      "Sto assemblando lo spazio",
    ],
    planningTitle: "Sto imparando a conoscerti",
    buildingTitle: "Sto creando il tuo spazio",
    errorGeneric: "Qualcosa è andato storto. Riprova.",
    errorBuild: "Qualcosa è andato storto durante la generazione del tuo spazio. Riprova.",
    describe: {
      step: "Passaggio 1 di 2",
      title: "Cosa stai studiando?",
      subtitle:
        "Descrivi i tuoi corsi e i tuoi obiettivi in linguaggio naturale. StudyOS ti pone un paio di domande veloci, poi progetta l’intero spazio in base alle tue risposte.",
      placeholder:
        "es. Sono uno studente del 1° anno di Informatica e questo semestre seguo Strutture dati, Matematica discreta, Analisi II e Scrittura accademica.",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "Continua",
      examplesLabel: "Non sai da dove iniziare? Parti da un esempio",
      finePrint: "Gratis · nessuna carta di credito · pronto in pochi secondi",
    },
    questions: {
      back: "← Modifica descrizione",
      step: "Passaggio 2 di 2",
      title: "Personalizziamolo",
      designingFor: "Stiamo progettando per:",
      pickAny: "scegline quante vuoi",
      pickOne: "scegline una",
      build: "Crea il mio spazio",
      answeredNone: "Rispondi ad alcune, oppure crea direttamente — decidi tu",
      answeredCount: "{n} / {total} con risposta",
    },
  },

  // ---- AI activity overlay ----------------------------------------------
  aiActivity: {
    defaultTitle: "Ci sto lavorando",
    defaultSteps: [
      "Sto leggendo il tuo spazio",
      "Sto pianificando le modifiche",
      "Sto progettando il layout",
      "Sto scrivendo il tutto",
    ],
    updatingTitle: "Sto aggiornando il tuo spazio",
  },

  // ---- Workspace editor --------------------------------------------------
  editor: {
    newPage: "Nuova pagina",
    untitled: "Senza titolo",
    allWorkspaces: "← Tutti gli spazi",
    deletePage: "Elimina pagina",
    askAi: "Chiedi all’IA",
    aiPlaceholder:
      "Chiedi all’IA di modificare questo spazio — “aggiungi una prova intermedia a Informatica”, “crea un piano di studio per gli esami finali”, “aggiungi un tracker delle abitudini”…",
    aiWorking: "Sto lavorando…",
    aiApply: "Applica",
    aiClose: "Chiudi",
    aiError: "Non sono riuscito ad applicarlo — prova a riformulare o a semplificare la richiesta.",
    saving: "Salvataggio…",
    saveFailed: "Salvataggio non riuscito",
    saved: "Salvato",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    addBlock: "+ Aggiungi blocco",
    cancel: "Annulla",
    deleteBlock: "Elimina blocco",
    blockTypes: {
      paragraph: "Testo",
      heading: "Titolo",
      todo: "Da fare",
      bulleted_list_item: "Elenco",
      callout: "Riquadro",
      divider: "Separatore",
      database: "Tabella",
    },
    placeholders: {
      paragraph: "Scrivi qualcosa…",
      todo: "Da fare",
      listItem: "Voce dell’elenco",
      callout: "Riquadro",
    },
    headingDefault: "Titolo",
    // Defaults for a brand-new table inserted via "+ Add block → Table".
    newTable: {
      name: "Nuova tabella",
      propName: "Nome",
      propStatus: "Stato",
      propDue: "Scadenza",
      statusTodo: "Da fare",
      statusInProgress: "In corso",
      statusDone: "Fatto",
      viewTable: "Tabella",
    },
  },

  // ---- Database views (table / board / calendar) ------------------------
  db: {
    nameAria: "Nome del database",
    newRow: "+ Nuova riga",
    newCard: "+ Nuova",
    untitled: "Senza titolo",
    empty: "—",
    link: "Collega ↗",
    linked: "{count} collegati",
    deleteRow: "Elimina riga",
    deleteCard: "Elimina scheda",
    dragHint: "Trascina in un’altra colonna",
    prevMonth: "Mese precedente",
    nextMonth: "Mese successivo",
    addOnDay: "Aggiungi in questo giorno",
    clickToRename: "Clicca per rinominare",
    delete: "Elimina",
  },

  // ---- Default onboarding questions (no-API-key fallback) ----------------
  onboarding: {
    level: {
      question: "Qual è il tuo livello di studio?",
      options: {
        hs: "Scuola superiore",
        ug: "Triennale",
        grad: "Magistrale / Post-laurea",
        self: "Studio autonomo",
      },
    },
    load: {
      question: "Quanti corsi stai gestendo?",
      // 1–2, 3–4, 5–6, 7+ stay numeric across locales (see onboarding.ts).
    },
    track: {
      question: "Cosa vuoi monitorare di più?",
      options: {
        assign: "Attività",
        exams: "Esami",
        read: "Letture",
        notes: "Appunti",
        habits: "Abitudini di studio",
        grades: "Voti",
      },
    },
    style: {
      question: "Come ti piace pianificare?",
      options: {
        cal: "Per calendario",
        board: "Per bacheca",
        list: "Elenchi semplici",
      },
    },
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  // The fixed labels the rule-based generator emits so the offline experience
  // is localized too. Course names derive from the user's own prompt.
  mock: {
    workspaceName: "Quartier generale studio",
    workspaceNameField: "Quartier generale studio {field}",
    welcome:
      "Generato dalla tua descrizione: “{summary}”. Tutto qui è un punto di partenza che puoi modificare.",
    tbd: "Da definire",
    status: { notStarted: "Non iniziato", inProgress: "In corso", done: "Fatto" },
    type: { homework: "Compiti", quiz: "Quiz", exam: "Esame", project: "Progetto" },
    exam: { midterm: "Prova intermedia", final: "Esame finale" },
    courses: {
      name: "Corsi",
      description: "Tutte le lezioni che segui questo periodo.",
      propCourse: "Corso",
      propCode: "Codice",
      propInstructor: "Docente",
      propCredits: "Crediti",
      propSchedule: "Orario",
      viewAll: "Tutti i corsi",
    },
    assignments: {
      name: "Attività",
      description: "Compiti, quiz, progetti ed esami.",
      propName: "Attività",
      propCourse: "Corso",
      propType: "Tipo",
      propStatus: "Stato",
      propDue: "Scadenza",
      propWeight: "Peso %",
      viewAll: "Tutte",
      viewBoard: "Per stato",
      viewCalendar: "Calendario",
      projectMilestone: "Traguardo del progetto {n} — {code}",
    },
    readings: {
      name: "Lista di letture",
      description: "Cosa leggere, organizzato per corso.",
      propTitle: "Titolo",
      propCourse: "Corso",
      propRead: "Letto",
      propLink: "Link",
      viewAll: "Lista di letture",
      coreReading: "{course}: lettura fondamentale",
    },
    habits: {
      name: "Abitudini di studio",
      description: "Un tracker leggero della costanza settimanale.",
      propHabit: "Abitudine",
      propDate: "Data",
      propDone: "Fatto",
      propMinutes: "Minuti",
      viewAll: "Tutte le abitudini",
      viewCalendar: "Calendario",
      reviewNotes: "Rivedi gli appunti di oggi",
      practiceRecall: "Esercita il richiamo",
    },
    grades: {
      name: "Tracker dei voti",
      description: "Punteggi e pesi modificabili per ogni corso.",
      propItem: "Valutazione",
      propCourse: "Corso",
      propScore: "Punteggio",
      propOutOf: "Su",
      propWeight: "Peso %",
      viewAll: "Tutti i voti",
      assessmentN: "Valutazione {n}",
    },
    pages: {
      dashboard: "Dashboard",
      courses: "Corsi",
      assignments: "Attività",
      planner: "Planner",
      readings: "Lista di letture",
      exams: "Preparazione esami",
      notes: "Appunti",
      habits: "Abitudini di studio",
      grades: "Tracker dei voti",
    },
    dashboard: {
      assignmentsHeading: "📌 Attività per stato",
      coursesHeading: "📚 I miei corsi",
    },
    assignmentsPage: { intro: "Tutto ciò che devi fare, con scadenze e pesi." },
    plannerPage: { intro: "Le tue scadenze disposte su un calendario." },
    examsPage: {
      callout:
        "Conferma le date, poi suddividi ogni esame in argomenti di ripasso e sessioni di esercitazione.",
    },
    notesPage: {
      heading: "Appunti dei corsi",
      callout:
        "Aggiungi un titolo per ogni lezione, poi raccogli sotto le idee chiave e le domande.",
      fallbackCourse: "Corso",
      startWriting: "Inizia a scrivere qui…",
    },
    gradesPage: {
      callout:
        "Sostituisci le valutazioni iniziali con i pesi del tuo programma e i risultati reali.",
    },
    // Workspace component plan (labels + descriptions shown in the loader).
    plan: {
      summaryWith: "Uno spazio su misura costruito attorno a {focus}.",
      summaryGeneric:
        "Uno spazio su misura per corsi, scadenze e pianificazione dello studio.",
      components: {
        dashboard: {
          label: "Dashboard",
          description: "Il tuo semestre, le priorità e le prossime scadenze.",
        },
        courses: {
          label: "Corsi",
          description: "Dettagli dei corsi, orari e docenti.",
        },
        assignments: {
          label: "Attività",
          description: "Compiti, scadenze, pesi e stato.",
        },
        planner: {
          label: "Planner",
          description: "Una vista a calendario del lavoro che ti aspetta.",
        },
        readings: {
          label: "Lista di letture",
          description: "Testi assegnati e avanzamento delle letture.",
        },
        exams: {
          label: "Preparazione esami",
          description: "Date degli esami, argomenti e attività di ripasso.",
        },
        notes: {
          label: "Appunti",
          description: "Uno spazio strutturato per gli appunti dei corsi.",
        },
        habits: {
          label: "Abitudini di studio",
          description: "Routine di studio quotidiane e costanza.",
        },
        grades: {
          label: "Tracker dei voti",
          description: "Punteggi, pesi e obiettivi di voto.",
        },
        projects: {
          label: "Progetti",
          description: "Traguardi e prossime azioni per i lavori più impegnativi.",
        },
      },
    },
  },
} satisfies Dictionary;
