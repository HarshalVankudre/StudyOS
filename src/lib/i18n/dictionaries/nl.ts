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
    pricingTitle: "Prijzen · StudyOS",
    pricingDescription:
      "Vergelijk StudyOS Gratis en Pro. Begin gratis en upgrade wanneer je het krachtigste model, onbeperkte generaties en prioriteitssupport wilt.",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Taal",
    choose: "Kies een taal",
  },

  // ---- Shared bits used on more than one surface ------------------------
  common: {
    openApp: "App openen",
    signIn: "Inloggen",
    getStarted: "Aan de slag",
    cancel: "Annuleren",
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
        "Beschrijf je vakken in één zin en StudyOS zet de dashboards, planners en trackers op die je nodig hebt — al ingevuld. Geen sjablonen, geen lege pagina’s.",
      ctaGenerate: "Genereer mijn werkruimte",
      ctaDemo: "Bekijk een demo",
      finePrint: "Gratis om te beginnen · Geen creditcard · Klaar in seconden",
    },
    builtFor: {
      label: "Gemaakt voor",
      items: [
        "Informatica",
        "Geneeskunde-voorbereiding",
        "Rechten",
        "MBA",
        "Middelbare school",
        "Master",
      ],
    },
    how: {
      title: "Van één zin naar een volledige werkruimte.",
      subtitle: "Drie stappen, ongeveer tien seconden.",
      steps: [
        {
          title: "Beschrijf je vakken",
          body: "Eén zin — “Ik bereid me voor op geneeskunde en volg Anatomie, Biochemie en Fysiologie.”",
        },
        {
          title: "Krijg een volledige werkruimte",
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
          title: "Werkruimtes, op maat voor jou",
          body: "Eén prompt wordt een complete werkruimte, afgestemd op precies jouw vakken.",
        },
        databases: {
          k: "Databases",
          title: "Echte, gestructureerde data",
          body: "Opdrachten, cijfers en leesstof als tabellen met eigen velden — geen losse notities.",
        },
        calendar: {
          k: "Agenda",
          title: "Planner & agenda",
          body: "Elke deadline op één plek. Wissel met één klik tussen tabel, bord en agenda.",
        },
        dashboard: {
          k: "Dashboard",
          title: "Een helder thuisbasis",
          body: "Een pagina die je hele week samenbrengt, zodat je altijd weet wat er aankomt.",
        },
        autosave: {
          k: "Automatisch opslaan",
          title: "Bewerk, direct opgeslagen",
          body: "Hernoem, vink af, voeg rijen toe — elke wijziging slaat zichzelf op zodra je hem maakt.",
        },
        assistant: {
          k: "Assistent",
          title: "Vraag het in gewoon Nederlands",
          body: "“Voeg een tussentoets toe aan Informatica.” Je werkruimte werkt zichzelf bij, voor je ogen.",
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
          "Onbeperkte generaties",
          "Het slimste, meest gedetailleerde model",
          "Prioriteitssupport",
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
    preview: {
      name: "Informatica Studiebasis",
      thisWeek: "Deze week",
      columns: { todo: "Te doen", doing: "Bezig", done: "Klaar" },
      cards: ["Bewijzen-quiz", "Linked List-lab", "Labverslag 2"],
      coursesLabel: "Vakken",
      courses: ["Datastructuren", "Discrete wiskunde", "Natuurkunde I"],
    },
  },

  // ---- Pricing page (/pricing) ------------------------------------------
  pricing: {
    nav: { openApp: "App openen", signIn: "Inloggen", getStarted: "Aan de slag" },
    badge: "Eenvoudige, studentvriendelijke prijzen",
    title: "Begin gratis. Upgrade wanneer je er klaar voor bent.",
    subtitle:
      "Alles wat je nodig hebt om je semester te organiseren is gratis. Pro voegt het krachtigste model, onbeperkte generaties en prioriteitssupport toe.",
    free: {
      name: "Gratis",
      price: "$0",
      tagline: "Alles om georganiseerd te raken.",
      bullets: [
        "AI-gegenereerde studiewerkruimtes",
        "Volledige inline bewerking & automatisch opslaan",
        "Databases — tabel, bord & agenda",
        "AI-agentchat in je werkruimte",
      ],
      ctaSignedOut: "Begin gratis",
      ctaSignedIn: "Open je werkruimtes",
      bulletCredits: "{count} AI-startcredits",
    },
    pro: {
      badge: "Meest gekozen",
      name: "Pro",
      price: "$5",
      perMonth: "/mnd",
      billed: "Maandelijks gefactureerd · altijd opzegbaar.",
      bullets: [
        "Alles uit Gratis",
        "Onbeperkte werkruimtegeneraties",
        "Het krachtigste, meest gedetailleerde model",
        "Prioriteitssupport & vroege toegang",
      ],
      currentPlan: "✦ Je huidige abonnement",
      manageBilling: "Facturatie beheren",
      upgrade: "Upgraden naar Pro",
      ctaSignedOut: "Aan de slag met Pro",
      bulletCredits: "{count} AI-credits inbegrepen",
    },
    comparison: {
      title: "Vergelijk abonnementen",
      featuresHeader: "Functies",
      freeHeader: "Gratis",
      proHeader: "Pro",
      included: "Inbegrepen",
      notIncluded: "Niet inbegrepen",
      features: {
        aiWorkspaces: "AI-gegenereerde werkruimtes",
        onboarding: "Begeleide instapvragen",
        editing: "Volledige inline bewerking & automatisch opslaan",
        databases: "Databases — tabel, bord & agenda",
        dragDrop: "Bewerken met slepen en neerzetten",
        agentChat: "AI-agentchat die je werkruimte bewerkt",
        model: "Generatiemodel",
        generations: "Werkruimtegeneraties",
        support: "Support",
        earlyAccess: "Vroege toegang tot nieuwe functies",
        credits: "Inbegrepen AI-credits",
        buyMore: "Koop altijd meer credits",
      },
      values: {
        standard: "Standaard",
        mostCapable: "Krachtigst",
        generous: "Royaal",
        unlimited: "Onbeperkt",
        community: "Community",
        priority: "Prioriteit",
      },
    },
    credits: {
      heading: "AI draait op credits",
      intro:
        "Elke AI-aanvraag kost credits op basis van hoeveel werk hij doet — een snelle aanpassing kost weinig, een hele werkruimte bouwen kost meer. Pro komt boordevol credits, en je kunt altijd bijvullen.",
      freeIncludes: "Gratis bevat {count} startcredits",
      proIncludes: "Pro bevat {count} credits",
      neverExpire: "Vul altijd bij — credits verlopen nooit",
      balance: "Je saldo: {count} credits",
      pack: "Creditpakket",
      unit: "credits",
      buy: "Koop {count} credits",
      signUpToBuy: "Meld je aan om credits te kopen",
      oneTime: "Eenmalige aankoop · veilig afrekenen",
    },
    faqTitle: "Vragen",
    faq: [
      {
        q: "Is StudyOS echt gratis om te beginnen?",
        a: "Ja. Maak een account aan en genereer, bewerk en gebruik je werkruimtes met het Gratis-abonnement — geen creditcard vereist.",
      },
      {
        q: "Wat krijg ik met Pro?",
        a: "Onbeperkte generaties, het krachtigste model voor rijkere en nauwkeurigere werkruimtes, prioriteitssupport en vroege toegang tot nieuwe functies.",
      },
      {
        q: "Kan ik altijd opzeggen?",
        a: "Altijd. Beheer of zeg je abonnement op via het facturatieportaal — je houdt Pro tot het einde van de periode.",
      },
      {
        q: "Wat gebeurt er met mijn werkruimtes als ik downgrade?",
        a: "Er wordt niets verwijderd. Je werkruimtes blijven precies zoals ze zijn en volledig bewerkbaar met Gratis.",
      },
    ],
    ctaTitle: "Je eerste werkruimte is één zin verwijderd.",
    ctaSubtitle: "Probeer StudyOS gratis — upgrade alleen als je meer wilt.",
    ctaSignedIn: "Genereer een werkruimte",
    ctaSignedOut: "Begin gratis",
    footerTagline: "De studiewerkruimte voor studenten · © 2026",
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "Beheren",
    upgrade: "Upgraden naar Pro",
    generate: "Genereren",
    upgradedBanner: "Je hebt Pro — je werkruimtes gebruiken nu het slimmere model.",
    title: "Je werkruimtes",
    subtitle: "Alles wat StudyOS voor je heeft gebouwd.",
    total: "{count} in totaal",
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
      { emoji: "💻", text: "Ik ben eerstejaars informaticastudent en volg 5 vakken" },
      {
        emoji: "⚕️",
        text: "Tweedejaars geneeskunde-voorbereiding: Anatomie, Biochemie, Fysiologie, Organische chemie",
      },
      { emoji: "🎓", text: "Vijfde klas middelbare school, 6 vakken voor de eindexamens" },
      {
        emoji: "📈",
        text: "MBA-student met Micro-economie, Boekhouden en Marketing",
      },
    ],
    planSteps: [
      "Je beschrijving lezen",
      "Goede vragen bedenken",
      "Je opzet op maat maken",
    ],
    planningTitle: "Je leren kennen",
    errorGeneric: "Er ging iets mis. Probeer het opnieuw.",
    errorBuild: "Er ging iets mis bij het genereren van je werkruimte. Probeer het opnieuw.",
    describe: {
      step: "Stap 1 van 2",
      title: "Wat studeer je?",
      subtitle:
        "Beschrijf je vakken en doelen in gewoon Nederlands. StudyOS stelt een paar korte vragen en ontwerpt vervolgens de hele werkruimte rond je antwoorden.",
      placeholder:
        "bijv. Ik ben eerstejaars informaticastudent en volg dit semester Datastructuren, Discrete wiskunde, Calculus II en Academisch schrijven.",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "Doorgaan",
      examplesLabel: "Niet zeker? Begin met een voorbeeld",
      finePrint: "Gratis · geen creditcard · klaar in seconden",
    },
    questions: {
      back: "← Beschrijving bewerken",
      step: "Stap 2 van 2",
      title: "Laten we het op maat maken",
      designingFor: "Ontworpen voor:",
      pickAny: "kies er een paar",
      pickOne: "kies er één",
      build: "Bouw mijn werkruimte",
      answeredNone: "Beantwoord er een paar, of bouw gewoon — jij beslist",
      answeredCount: "{n} / {total} beantwoord",
      other: "Anders",
      otherPlaceholder: "Typ je eigen voorkeur…",
      otherAria: "Ander antwoord voor {question}",
    },
  },

  // ---- Generation activity (full-screen build progress) -----------------
  genActivity: {
    building: "Je werkruimte bouwen",
    designing: "Je werkruimte ontwerpen",
    componentsChosen: "Componenten voor je gekozen",
    planningComponents: "Componenten plannen",
    onlyRelevant: "Alleen de pagina’s en trackers die relevant zijn voor je antwoorden.",
    componentsCount: "{count} componenten",
    everythingEditable:
      "Alles wat is gegenereerd blijft bewerkbaar — pagina’s, velden, weergaven, rijen en inhoud.",
    statusReady: "Klaar",
    statusGenerating: "Genereren…",
    statusQueued: "In wachtrij",
    finishingUp: "Laatste hand wordt gelegd",
    yourWorkspace: "Je werkruimte",
    pagesLabel: "Pagina’s",
    sectionsBuilt: "{built} van {total} secties gebouwd",
    choosingPieces: "De juiste onderdelen voor je kiezen…",
    stillEditable: "Alles blijft bewerkbaar zodra het klaar is",
    writingItIn: "Aan het invullen…",
    board: { todo: "Te doen", doing: "Bezig", done: "Klaar" },
    phase: {
      analyzing: "Je antwoorden analyseren",
      planning: "Componenten selecteren",
      generating: "Werkruimte genereren",
      validating: "Gegevens valideren",
      saving: "Opslaan",
    },
  },

  // ---- AiActivity overlay (calm spinner used during planning) -----------
  aiActivity: {
    defaultTitle: "Ermee bezig",
    defaultSteps: [
      "Je werkruimte lezen",
      "De wijzigingen plannen",
      "De lay-out ontwerpen",
      "Het invoeren",
    ],
  },

  // ---- Workspace editor chrome ------------------------------------------
  editor: {
    workspaceIcon: "Werkruimte-icoon",
    newPage: "Nieuwe pagina",
    untitled: "Naamloos",
    allWorkspaces: "← Alle werkruimtes",
    deletePage: "Pagina verwijderen",
    askAi: "Vraag AI",
    closeAgent: "Agent sluiten",
    saving: "Opslaan…",
    saveFailed: "Opslaan mislukt",
    saved: "Opgeslagen",
  },

  // ---- In-workspace AI agent chat ---------------------------------------
  agentChat: {
    title: "AI-agent",
    subtitleIdle: "Begrijpt je hele werkruimte",
    closeChat: "Chat sluiten",
    suggestions: [
      "Voeg een gewoontetracker toe",
      "Maak een studieplan van 2 weken voor de eindexamens",
      "Voeg een tussentoets toe aan elk vak",
      "Waar moet ik me deze week op richten?",
    ],
    intro:
      "Vraag me om één item te wijzigen of om updates over je hele werkruimte te coördineren. Als iets onduidelijk is, vraag ik het voordat ik bewerk.",
    workspaceUpdated: "Werkruimte bijgewerkt",
    undo: "Ongedaan maken",
    undoing: "Ongedaan maken…",
    undone: "Wijziging ongedaan gemaakt",
    undoFailed: "Deze wijziging kan niet ongedaan worden gemaakt omdat de werkruimte is veranderd.",
    buildingUpdate: "Je update bouwen",
    thinking: "Aan het denken…",
    stopTask: "Taak stoppen",
    stopping: "Stoppen…",
    taskStopped: "Taak gestopt.",
    stopFailed: "De taak kon niet worden gestopt. Mogelijk wordt deze nog uitgevoerd.",
    steps: {
      inspect: "Werkruimte inspecteren",
      decide: "De veiligste actie bepalen",
      prepare: "Gecoördineerde update voorbereiden",
    },
    phase: {
      inspecting: "Je werkruimte bekijken",
      planning: "De veiligste wijziging plannen",
      updating: "Werkruimte-updates coördineren",
      validating: "Elke verbinding controleren",
      saving: "Je wijzigingen opslaan",
    },
    areaStatus: { queued: "In wachtrij", working: "Bijwerken", complete: "Klaar" },
    initialMessage: "Je werkruimte openen",
    placeholderBusy: "De agent is bezig…",
    placeholderIdle: "Vraag de agent om iets te bouwen of te wijzigen…",
    send: "Versturen",
    inputHint: "Enter om te versturen · Shift+Enter voor een nieuwe regel",
    errorRequestFailed: "Agentverzoek mislukt",
    errorEndedUnexpectedly: "Agentantwoord eindigde onverwacht",
    errorSnag: "De agent liep tegen een probleem aan. Probeer het opnieuw.",
    errorCouldntComplete:
      "Ik kon dat niet veilig voltooien. Probeer het opnieuw of maak het verzoek specifieker.",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    pageIcon: "Pagina-icoon",
    headingLevel: "Kopniveau",
    calloutIcon: "Callout-icoon",
    addBlock: "+ Blok toevoegen",
    deleteBlock: "Blok verwijderen",
    blockTypes: {
      paragraph: "Tekst",
      heading: "Kop",
      todo: "Taak",
      bulleted_list_item: "Lijst",
      numbered_list_item: "Genummerd",
      quote: "Citaat",
      callout: "Callout",
      divider: "Scheidingslijn",
      database: "Tabel",
      media: "Afbeelding",
    },
    placeholders: {
      paragraph: "Typ iets…",
      todo: "Taak",
      listItem: "Lijstitem",
      callout: "Callout",
    },
    headingDefault: "Kop",
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
    databaseIcon: "Database-icoon",
    nameAria: "Databasenaam",
    newRow: "+ Nieuwe rij",
    newCard: "+ Nieuw",
    untitled: "Naamloos",
    empty: "—",
    deleteRow: "Rij verwijderen",
    deleteCard: "Kaart verwijderen",
    dragHint: "Sleep naar een andere kolom",
    prevMonth: "Vorige maand",
    nextMonth: "Volgende maand",
    addOnDay: "Toevoegen op deze dag",
    clickToRename: "Klik om te hernoemen",
    delete: "Verwijderen",
  },

  // ---- Database settings panel ------------------------------------------
  dbSettings: {
    customize: "Velden & weergaven aanpassen",
    description: "Beschrijving",
    descriptionPlaceholder: "Waar deze tracker voor is",
    fields: "Velden",
    addField: "+ Veld toevoegen",
    fieldName: "Veldnaam",
    fieldType: "Veldtype",
    deleteField: "Veld verwijderen",
    newField: "Nieuw veld",
    chooseRelatedDatabase: "Kies een gerelateerde database",
    optionLabel: "Optielabel",
    addOption: "+ optie",
    newOption: "Nieuwe optie",
    views: "Weergaven",
    addView: "+ Weergave toevoegen",
    viewName: "Weergavenaam",
    newView: "Nieuwe weergave",
    deleteView: "Weergave verwijderen",
    groupBy: "Groeperen op…",
    dateField: "Datumveld…",
    deleteDatabase: "Deze database verwijderen",
    deleteConfirm: "“{name}” verwijderen en van elke pagina weghalen?",
    propertyTypes: {
      text: "Tekst",
      number: "Getal",
      checkbox: "Selectievakje",
      date: "Datum",
      select: "Selectie",
      multi_select: "Meervoudige selectie",
      status: "Status",
      url: "URL",
      relation: "Relatie",
    },
    viewTypes: {
      table: "Tabel",
      board: "Bord",
      calendar: "Agenda",
      list: "Lijst",
      gallery: "Galerij",
    },
    defaults: {
      statusTodo: "Te doen",
      statusInProgress: "Bezig",
      statusDone: "Klaar",
      option1: "Optie 1",
      option2: "Optie 2",
    },
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
    load: { question: "Hoeveel vakken jongleer je tegelijk?" },
    track: {
      question: "Wat wil je het liefst bijhouden?",
      options: {
        assign: "Opdrachten",
        exams: "Tentamens",
        read: "Leesstof",
        notes: "Notities",
        habits: "Studiegewoontes",
        grades: "Cijfers",
      },
    },
    style: {
      question: "Hoe plan je het liefst?",
      options: { cal: "Per agenda", board: "Per bord", list: "Eenvoudige lijsten" },
    },
  },

  // ---- Server-emitted AI progress + errors ------------------------------
  ai: {
    generate: {
      phase: {
        analyzing: "Je vakken, doelen en voorkeuren lezen",
        planning: "De juiste werkruimtecomponenten kiezen",
        generating: "Je complete werkruimte in één keer genereren",
        validating: "Koppelingen, weergaven, velden en startgegevens controleren",
        saving: "Je bewerkbare werkruimte opslaan",
      },
      error:
        "De werkruimte kon niet worden gegenereerd. Probeer het opnieuw met een kortere beschrijving.",
      detail: {
        dashboard: "{count} bewerkbare pagina’s gekoppeld",
        courses: "{count} vakken toegevoegd",
        trackedItems: "{count} bijgehouden items toegevoegd",
        scheduled: "{count} items ingepland",
        readings: "{count} leesitems toegevoegd",
        habits: "{count} routines toegevoegd",
        grades: "{count} cijferrijen toegevoegd",
        notes: "Bewerkbare notitiestructuur aangemaakt",
        generic: "Component aangemaakt en gekoppeld",
      },
    },
    agent: {
      inspecting: "{pages} pagina’s en {databases} databases bekijken",
      inspectingArea: "{area} bekijken",
      planning: "Het verzoek begrijpen en controleren op dubbelzinnigheid",
      updating: "Gecoördineerde wijzigingen toepassen in je werkruimte",
      validating: "Verwijzingen, weergaven, velden en gekoppelde gegevens controleren",
      saving: "De bijgewerkte werkruimte opslaan",
      workspaceNotFound: "Werkruimte niet gevonden.",
      workspaceChanged: "Je werkruimte is gewijzigd terwijl ik bezig was. Probeer het opnieuw.",
      undoUnavailable: "Deze wijziging kan niet ongedaan worden gemaakt omdat de werkruimte nieuwere bewerkingen bevat.",
      error:
        "De agent kon dat verzoek niet veilig voltooien. Probeer het opnieuw of maak het verzoek specifieker.",
      fallbackReply: "Je werkruimte bijgewerkt.",
    },
    errors: {
      notAuthenticated: "Niet geverifieerd",
      invalidAgentRequest: "Ongeldig agentverzoek",
      describeBeforeGenerating:
        "Beschrijf je studie voordat je een werkruimte genereert.",
    },
  },

  // ---- Credits ----------------------------------------------------------
  credits: {
    label: "AI-credits",
    amount: "{count} credits",
    buy: "Credits kopen",
    metaTitle: "Credits kopen · StudyOS",
    pageIntro:
      "Credits drijven elke AI-aanvraag aan — werkruimtes genereren en chatten met de agent. Vul op elk moment aan; credits verlopen nooit.",
    oneTimeExpire: "Eenmalige aankoop · veilig afrekenen · credits verlopen nooit",
    wantMore: "Wil je het meest capabele model en inbegrepen credits?",
    spentOn: "Besteed aan AI-generaties en agentbewerkingen.",
    addedBanner: "{added} credits toegevoegd — je hebt er nu {total}.",
    outGenerate:
      "Je AI-credits zijn op. Voeg er meer toe via de Prijzen-pagina om te blijven genereren.",
    outAgent:
      "Je AI-credits zijn op. Voeg er meer toe via de Prijzen-pagina om de agent te blijven gebruiken.",
  },

  // ---- Account menu -----------------------------------------------------
  account: {
    pro: "Pro",
    free: "Gratis",
    fallbackName: "Account",
    viewProfile: "Profiel bekijken",
    manageProfile: "Profiel beheren",
    subscriptionPayments: "Abonnement & betalingen",
    buyCredits: "Credits kopen",
    settings: "Instellingen",
    signOut: "Uitloggen",
    manageAccount: "Account beheren",
    creditsAndPlan: "{credits} credits · {plan}",
  },

  // ---- Account settings page --------------------------------------------
  settings: {
    metaTitle: "Accountinstellingen · StudyOS",
    back: "← Werkruimtes",
    title: "Accountinstellingen",
    subtitle: "Beheer je profiel, abonnement, betalingen en credits.",
    profile: "Profiel",
    yourAccount: "Je account",
    subscription: "Abonnement",
    proDesc:
      "Je hebt Pro — het krachtigste model en prioriteitssupport. Beheer hieronder je abonnement, betaalmethoden en facturen.",
    freeDesc:
      "Je zit op het Gratis-abonnement. Upgrade naar Pro voor het krachtigste model, inbegrepen credits en prioriteitssupport.",
    manageSubscription: "Abonnement & betalingen beheren",
    upgrade: "Upgraden naar Pro",
    comparePlans: "Abonnementen vergelijken",
    creditsDesc:
      "Credits voeden elke AI-aanvraag. Vul altijd bij — credits verlopen nooit.",
    buyPack: "Koop {count} credits · ${price}",
    viewPricing: "Prijzen bekijken",
    signOut: "Uitloggen",
  },

  // ---- Workspace card (delete control) ----------------------------------
  workspaceCard: {
    delete: "Werkruimte verwijderen",
    deleteAria: "{name} verwijderen",
    deleteConfirm:
      "“{name}” verwijderen?\n\nHiermee verwijder je de werkruimte en alles erin definitief. Dit kan niet ongedaan worden gemaakt.",
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  mock: {
    workspaceName: "Studiebasis",
    workspaceNameField: "{field} Studiebasis",
    welcome:
      "Gegenereerd op basis van je beschrijving: “{summary}”. Alles hier is een startpunt dat je kunt bewerken.",
    tbd: "Nog te bepalen",
    status: { notStarted: "Niet begonnen", inProgress: "Bezig", done: "Klaar" },
    type: { homework: "Huiswerk", quiz: "Quiz", exam: "Tentamen", project: "Project" },
    exam: { midterm: "Tussentoets", final: "Eindtentamen" },
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
      viewBoard: "Per status",
      viewCalendar: "Agenda",
      projectMilestone: "Projectmijlpaal {n} — {code}",
    },
    readings: {
      name: "Leeslijst",
      description: "Wat te lezen, geordend per vak.",
      propTitle: "Titel",
      propCourse: "Vak",
      propRead: "Gelezen",
      propLink: "Link",
      viewAll: "Leeslijst",
      coreReading: "{course}: kernleesstof",
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
      practiceRecall: "Actief herhalen",
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
      assignmentsHeading: "📌 Opdrachten per status",
      coursesHeading: "📚 Mijn vakken",
    },
    assignmentsPage: { intro: "Alles wat je nog moet doen, met deadlines en wegingen." },
    plannerPage: { intro: "Je deadlines uitgezet op een agenda." },
    examsPage: {
      callout:
        "Bevestig de data en splits elk tentamen daarna op in herhalingsonderwerpen en oefensessies.",
    },
    notesPage: {
      heading: "Vaknotities",
      callout:
        "Voeg een kop toe voor elk college en leg daaronder de belangrijkste ideeën en vragen vast.",
      fallbackCourse: "Vak",
      startWriting: "Begin hier met schrijven…",
    },
    gradesPage: {
      callout:
        "Vervang de starttoetsen door de wegingen uit je studiehandleiding en je echte resultaten.",
    },
    plan: {
      summaryWith: "Een werkruimte op maat, gebouwd rond {focus}.",
      summaryGeneric:
        "Een werkruimte op maat voor vakken, deadlines en studieplanning.",
      components: {
        dashboard: {
          label: "Dashboard",
          description: "Je semester, prioriteiten en eerstvolgende deadlines.",
        },
        courses: {
          label: "Vakken",
          description: "Vakgegevens, roosters en docenten.",
        },
        assignments: {
          label: "Opdrachten",
          description: "Studiewerk, deadlines, wegingen en status.",
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
          description: "Een gestructureerd thuis voor vaknotities.",
        },
        habits: {
          label: "Studiegewoontes",
          description: "Dagelijkse studieroutines en consistentie.",
        },
        grades: {
          label: "Cijfertracker",
          description: "Scores, wegingen en cijferdoelen.",
        },
      },
    },
  },
} satisfies Dictionary;
