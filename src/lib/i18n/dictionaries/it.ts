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
    pricingTitle: "Prezzi · StudyOS",
    pricingDescription:
      "Confronta StudyOS Gratis e Pro. Inizia gratis e passa a Pro quando vuoi il modello più potente, generazioni illimitate e supporto prioritario.",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Lingua",
    choose: "Scegli la lingua",
  },

  // ---- Shared bits used on more than one surface ------------------------
  common: {
    openApp: "Apri l’app",
    signIn: "Accedi",
    getStarted: "Inizia ora",
    cancel: "Annulla",
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
    preview: {
      name: "Quartier generale Informatica",
      thisWeek: "Questa settimana",
      columns: { todo: "Da fare", doing: "In corso", done: "Fatto" },
      cards: ["Quiz sulle dimostrazioni", "Lab liste concatenate", "Relazione di laboratorio 2"],
      coursesLabel: "Corsi",
      courses: ["Strutture dati", "Matematica discreta", "Fisica I"],
    },
  },

  // ---- Pricing page (/pricing) ------------------------------------------
  pricing: {
    nav: { openApp: "Apri l’app", signIn: "Accedi", getStarted: "Inizia ora" },
    badge: "Prezzi semplici e su misura per gli studenti",
    title: "Inizia gratis. Passa a Pro quando vuoi.",
    subtitle:
      "Tutto ciò che ti serve per organizzare il tuo semestre è gratis. Pro aggiunge il modello più potente, generazioni illimitate e supporto prioritario.",
    free: {
      name: "Gratis",
      price: "$0",
      tagline: "Tutto il necessario per organizzarti.",
      bullets: [
        "Spazi di studio generati dall’IA",
        "Modifica inline completa e salvataggio automatico",
        "Database — tabella, bacheca e calendario",
        "Chat con l’agente IA nel tuo spazio",
      ],
      ctaSignedOut: "Inizia gratis",
      ctaSignedIn: "Apri i tuoi spazi",
      bulletCredits: "{count} crediti IA iniziali",
    },
    pro: {
      badge: "Il più popolare",
      name: "Pro",
      price: "$5",
      perMonth: "/mese",
      billed: "Fatturazione mensile · disdici quando vuoi.",
      bullets: [
        "Tutto ciò che c’è in Gratis",
        "Generazioni di spazi illimitate",
        "Il modello più potente e dettagliato",
        "Supporto prioritario e accesso anticipato",
      ],
      currentPlan: "✦ Il tuo piano attuale",
      manageBilling: "Gestisci la fatturazione",
      upgrade: "Passa a Pro",
      ctaSignedOut: "Inizia con Pro",
      bulletCredits: "{count} crediti IA inclusi",
    },
    comparison: {
      title: "Confronta i piani",
      featuresHeader: "Funzionalità",
      freeHeader: "Gratis",
      proHeader: "Pro",
      included: "Incluso",
      notIncluded: "Non incluso",
      features: {
        aiWorkspaces: "Spazi generati dall’IA",
        onboarding: "Domande guidate di configurazione",
        editing: "Modifica inline completa e salvataggio automatico",
        databases: "Database — tabella, bacheca e calendario",
        dragDrop: "Modifica con trascinamento",
        agentChat: "Chat con l’agente IA che modifica il tuo spazio",
        model: "Modello di generazione",
        generations: "Generazioni di spazi",
        support: "Supporto",
        earlyAccess: "Accesso anticipato alle novità",
        credits: "Crediti IA inclusi",
        buyMore: "Acquista altri crediti quando vuoi",
      },
      values: {
        standard: "Standard",
        mostCapable: "Il più potente",
        generous: "Generoso",
        unlimited: "Illimitate",
        community: "Community",
        priority: "Prioritario",
      },
    },
    credits: {
      heading: "L’IA funziona a crediti",
      intro:
        "Ogni richiesta all’IA consuma crediti in base a quanto fa — una piccola modifica costa poco, creare un intero spazio costa di più. Pro arriva carico di crediti e puoi ricaricare quando vuoi.",
      freeIncludes: "Gratis include {count} crediti iniziali",
      proIncludes: "Pro include {count} crediti",
      neverExpire: "Ricarica quando vuoi — i crediti non scadono mai",
      balance: "Il tuo saldo: {count} crediti",
      pack: "Pacchetto di crediti",
      unit: "crediti",
      buy: "Acquista {count} crediti",
      signUpToBuy: "Registrati per acquistare crediti",
      oneTime: "Acquisto una tantum · pagamento sicuro",
    },
    faqTitle: "Domande",
    faq: [
      {
        q: "StudyOS è davvero gratis per iniziare?",
        a: "Sì. Crea un account e genera, modifica e usa i tuoi spazi con il piano Gratis — senza bisogno di carta di credito.",
      },
      {
        q: "Cosa ottengo con Pro?",
        a: "Generazioni illimitate, il modello più potente per spazi più ricchi e accurati, supporto prioritario e accesso anticipato alle novità.",
      },
      {
        q: "Posso disdire quando voglio?",
        a: "Quando vuoi. Gestisci o disdici il tuo abbonamento dal portale di fatturazione — mantieni Pro fino alla fine del periodo.",
      },
      {
        q: "Cosa succede ai miei spazi se passo a un piano inferiore?",
        a: "Nulla viene eliminato. I tuoi spazi restano esattamente come sono e rimangono completamente modificabili con Gratis.",
      },
    ],
    ctaTitle: "Il tuo primo spazio è a una frase di distanza.",
    ctaSubtitle: "Prova StudyOS gratis — passa a un piano superiore solo se vuoi di più.",
    ctaSignedIn: "Genera uno spazio",
    ctaSignedOut: "Inizia gratis",
    footerTagline: "Lo spazio di studio per studenti · © 2026",
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
    planningTitle: "Sto imparando a conoscerti",
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
      other: "Altro",
      otherPlaceholder: "Scrivi la tua preferenza…",
      otherAria: "Altra risposta per {question}",
    },
  },

  // ---- Generation activity (full-screen build progress) -----------------
  genActivity: {
    building: "Sto creando il tuo spazio",
    designing: "Sto progettando il tuo spazio",
    componentsChosen: "Componenti scelti per te",
    planningComponents: "Sto pianificando i componenti",
    onlyRelevant: "Solo le pagine e i tracker rilevanti per le tue risposte.",
    componentsCount: "{count} componenti",
    everythingEditable:
      "Tutto ciò che viene generato resta modificabile — pagine, campi, viste, righe e contenuti.",
    statusReady: "Pronto",
    statusGenerating: "Generazione…",
    statusQueued: "In coda",
    finishingUp: "Sto completando",
    yourWorkspace: "Il tuo spazio",
    pagesLabel: "Pagine",
    sectionsBuilt: "{built} di {total} sezioni create",
    choosingPieces: "Sto scegliendo gli elementi giusti per te…",
    stillEditable: "Tutto resta modificabile una volta pronto",
    writingItIn: "Sto scrivendo il tutto…",
    board: { todo: "Da fare", doing: "In corso", done: "Fatto" },
    phase: {
      analyzing: "Sto analizzando le tue risposte",
      planning: "Sto selezionando i componenti",
      generating: "Sto generando lo spazio",
      validating: "Sto convalidando i dati",
      saving: "Salvataggio",
    },
  },

  // ---- AiActivity overlay (calm spinner used during planning) -----------
  aiActivity: {
    defaultTitle: "Ci sto lavorando",
    defaultSteps: [
      "Sto leggendo il tuo spazio",
      "Sto pianificando le modifiche",
      "Sto progettando il layout",
      "Sto scrivendo il tutto",
    ],
  },

  // ---- Workspace editor chrome ------------------------------------------
  editor: {
    workspaceIcon: "Icona dello spazio",
    newPage: "Nuova pagina",
    untitled: "Senza titolo",
    allWorkspaces: "← Tutti gli spazi",
    deletePage: "Elimina pagina",
    askAi: "Chiedi all’IA",
    closeAgent: "Chiudi agente",
    saving: "Salvataggio…",
    saveFailed: "Salvataggio non riuscito",
    saved: "Salvato",
  },

  // ---- In-workspace AI agent chat ---------------------------------------
  agentChat: {
    title: "Agente IA",
    subtitleIdle: "Comprende tutto il tuo spazio",
    closeChat: "Chiudi chat",
    suggestions: [
      "Aggiungi un tracker delle abitudini",
      "Crea un piano di studio di 2 settimane per gli esami finali",
      "Aggiungi una prova intermedia a ogni corso",
      "Su cosa dovrei concentrarmi questa settimana?",
    ],
    intro:
      "Chiedimi di modificare un singolo elemento o di coordinare aggiornamenti in tutto il tuo spazio. Se qualcosa non è chiaro, te lo chiederò prima di apportare modifiche.",
    workspaceUpdated: "Spazio aggiornato",
    undo: "Annulla",
    undoing: "Annullamento…",
    undone: "Modifica annullata",
    undoFailed: "Questa modifica non può essere annullata perché l’area di lavoro è cambiata.",
    buildingUpdate: "Sto preparando il tuo aggiornamento",
    steps: {
      inspect: "Esamina lo spazio",
      decide: "Decidi l’azione più sicura",
      prepare: "Prepara l’aggiornamento coordinato",
    },
    phase: {
      inspecting: "Sto esaminando il tuo spazio",
      planning: "Sto pianificando la modifica più sicura",
      updating: "Sto coordinando gli aggiornamenti dello spazio",
      validating: "Sto controllando ogni collegamento",
      saving: "Sto salvando le tue modifiche",
    },
    areaStatus: { queued: "In coda", working: "In aggiornamento", complete: "Pronto" },
    initialMessage: "Sto aprendo il tuo spazio",
    placeholderBusy: "L’agente sta lavorando…",
    placeholderIdle: "Chiedi all’agente di creare o modificare qualcosa…",
    send: "Invia",
    inputHint: "Invio per inviare · Maiusc+Invio per andare a capo",
    errorRequestFailed: "Richiesta all’agente non riuscita",
    errorEndedUnexpectedly: "La risposta dell’agente si è interrotta inaspettatamente",
    errorSnag: "L’agente ha riscontrato un intoppo. Riprova.",
    errorCouldntComplete:
      "Non sono riuscito a completarlo in modo sicuro. Riprova oppure rendi la richiesta più specifica.",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    pageIcon: "Icona della pagina",
    headingLevel: "Livello del titolo",
    calloutIcon: "Icona del riquadro",
    addBlock: "+ Aggiungi blocco",
    deleteBlock: "Elimina blocco",
    blockTypes: {
      paragraph: "Testo",
      heading: "Titolo",
      todo: "Da fare",
      bulleted_list_item: "Elenco",
      numbered_list_item: "Numerato",
      quote: "Citazione",
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
    databaseIcon: "Icona del database",
    nameAria: "Nome del database",
    newRow: "+ Nuova riga",
    newCard: "+ Nuova",
    untitled: "Senza titolo",
    empty: "—",
    deleteRow: "Elimina riga",
    deleteCard: "Elimina scheda",
    dragHint: "Trascina in un’altra colonna",
    prevMonth: "Mese precedente",
    nextMonth: "Mese successivo",
    addOnDay: "Aggiungi in questo giorno",
    clickToRename: "Clicca per rinominare",
    delete: "Elimina",
  },

  // ---- Database settings panel ------------------------------------------
  dbSettings: {
    customize: "Personalizza campi e viste",
    description: "Descrizione",
    descriptionPlaceholder: "A cosa serve questo tracker",
    fields: "Campi",
    addField: "+ Aggiungi campo",
    fieldName: "Nome del campo",
    fieldType: "Tipo di campo",
    deleteField: "Elimina campo",
    newField: "Nuovo campo",
    chooseRelatedDatabase: "Scegli il database collegato",
    optionLabel: "Etichetta dell’opzione",
    addOption: "+ opzione",
    newOption: "Nuova opzione",
    views: "Viste",
    addView: "+ Aggiungi vista",
    viewName: "Nome della vista",
    newView: "Nuova vista",
    deleteView: "Elimina vista",
    groupBy: "Raggruppa per…",
    dateField: "Campo data…",
    deleteDatabase: "Elimina questo database",
    deleteConfirm: "Eliminare “{name}” e rimuoverlo da ogni pagina?",
    propertyTypes: {
      text: "Testo",
      number: "Numero",
      checkbox: "Casella di spunta",
      date: "Data",
      select: "Selezione",
      multi_select: "Selezione multipla",
      status: "Stato",
      url: "URL",
      relation: "Relazione",
    },
    viewTypes: {
      table: "Tabella",
      board: "Bacheca",
      calendar: "Calendario",
      list: "Elenco",
      gallery: "Galleria",
    },
    defaults: {
      statusTodo: "Da fare",
      statusInProgress: "In corso",
      statusDone: "Fatto",
      option1: "Opzione 1",
      option2: "Opzione 2",
    },
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
    load: { question: "Quanti corsi stai gestendo?" },
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
      options: { cal: "Per calendario", board: "Per bacheca", list: "Elenchi semplici" },
    },
  },

  // ---- Server-emitted AI progress + errors ------------------------------
  ai: {
    generate: {
      phase: {
        analyzing: "Sto leggendo i tuoi corsi, obiettivi e preferenze",
        planning: "Sto scegliendo i componenti giusti per lo spazio",
        generating: "Sto generando il tuo spazio completo in un’unica passata",
        validating: "Sto controllando collegamenti, viste, campi e dati iniziali",
        saving: "Sto salvando il tuo spazio modificabile",
      },
      error:
        "Non è stato possibile generare lo spazio. Riprova con una descrizione più breve.",
      detail: {
        dashboard: "{count} pagine modificabili collegate",
        courses: "{count} corsi aggiunti",
        trackedItems: "{count} elementi monitorati aggiunti",
        scheduled: "{count} elementi pianificati",
        readings: "{count} letture aggiunte",
        habits: "{count} routine aggiunte",
        grades: "{count} righe di voti aggiunte",
        notes: "Struttura degli appunti modificabile creata",
        generic: "Componente creato e collegato",
      },
    },
    agent: {
      inspecting: "Sto esaminando {pages} pagine e {databases} database",
      inspectingArea: "Sto esaminando {area}",
      planning: "Sto comprendendo la richiesta e verificando eventuali ambiguità",
      updating: "Sto applicando modifiche coordinate in tutto il tuo spazio",
      validating: "Sto controllando riferimenti, viste, campi e dati collegati",
      saving: "Sto salvando lo spazio aggiornato",
      workspaceNotFound: "Spazio non trovato.",
      workspaceChanged: "L’area di lavoro è cambiata mentre lavoravo. Riprova.",
      undoUnavailable: "Questa modifica non può essere annullata perché l’area di lavoro contiene modifiche più recenti.",
      error:
        "L’agente non è riuscito a completare la richiesta in modo sicuro. Riprova oppure rendi la richiesta più specifica.",
      fallbackReply: "Ho aggiornato il tuo spazio.",
    },
    errors: {
      notAuthenticated: "Non autenticato",
      invalidAgentRequest: "Richiesta all’agente non valida",
      describeBeforeGenerating:
        "Descrivi i tuoi studi prima di generare uno spazio.",
    },
  },

  // ---- Credits ----------------------------------------------------------
  credits: {
    label: "Crediti IA",
    amount: "{count} crediti",
    buy: "Acquista crediti",
    metaTitle: "Acquista crediti · StudyOS",
    pageIntro:
      "I crediti alimentano ogni richiesta all’IA — generare spazi e chattare con l’agente. Ricarica quando vuoi; i crediti non scadono mai.",
    oneTimeExpire: "Acquisto una tantum · pagamento sicuro · i crediti non scadono mai",
    wantMore: "Vuoi il modello più potente e i crediti inclusi?",
    spentOn: "Spesi per generazioni IA e modifiche dell’agente.",
    addedBanner: "Aggiunti {added} crediti — ora ne hai {total}.",
    outGenerate:
      "Hai esaurito i crediti IA. Aggiungine altri dalla pagina Prezzi per continuare a generare.",
    outAgent:
      "Hai esaurito i crediti IA. Aggiungine altri dalla pagina Prezzi per continuare a usare l’agente.",
  },

  // ---- Account menu -----------------------------------------------------
  account: {
    pro: "Pro",
    free: "Gratis",
    fallbackName: "Account",
    viewProfile: "Visualizza profilo",
    manageProfile: "Gestisci profilo",
    subscriptionPayments: "Abbonamento e pagamenti",
    buyCredits: "Acquista crediti",
    settings: "Impostazioni",
    signOut: "Esci",
    manageAccount: "Gestisci account",
    creditsAndPlan: "{credits} crediti · {plan}",
  },

  // ---- Account settings page --------------------------------------------
  settings: {
    metaTitle: "Impostazioni account · StudyOS",
    back: "← Spazi",
    title: "Impostazioni account",
    subtitle: "Gestisci il tuo profilo, piano, pagamenti e crediti.",
    profile: "Profilo",
    yourAccount: "Il tuo account",
    subscription: "Abbonamento",
    proDesc:
      "Sei su Pro — il modello più potente e il supporto prioritario. Gestisci il tuo abbonamento, i metodi di pagamento e le fatture qui sotto.",
    freeDesc:
      "Sei sul piano Gratis. Passa a Pro per il modello più potente, i crediti inclusi e il supporto prioritario.",
    manageSubscription: "Gestisci abbonamento e pagamenti",
    upgrade: "Passa a Pro",
    comparePlans: "Confronta i piani",
    creditsDesc:
      "I crediti alimentano ogni richiesta all’IA. Ricarica quando vuoi — i crediti non scadono mai.",
    buyPack: "Acquista {count} crediti · ${price}",
    viewPricing: "Visualizza i prezzi",
    signOut: "Esci",
  },

  // ---- Workspace card (delete control) ----------------------------------
  workspaceCard: {
    delete: "Elimina spazio",
    deleteAria: "Elimina {name}",
    deleteConfirm:
      "Eliminare “{name}”?\n\nQuesto rimuove definitivamente lo spazio e tutto ciò che contiene. L’operazione non può essere annullata.",
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
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
      },
    },
  },
} satisfies Dictionary;
