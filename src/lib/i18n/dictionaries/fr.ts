import type { Dictionary } from "./en";
// Français (fr-FR) — traduction de StudyOS, conforme au contrat Dictionary.
export const fr = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — Votre espace d’études, conçu par l’IA",
    homeDescription:
      "Décrivez vos cours et vos échéances, et StudyOS crée instantanément vos tableaux de bord, vos plannings et vos suivis de devoirs. L’espace d’études propulsé par l’IA pour les étudiants.",
    appTitle: "Vos espaces de travail · StudyOS",
    generateTitle: "Générez votre espace de travail · StudyOS",
    pricingTitle: "Tarifs · StudyOS",
    pricingDescription:
      "Comparez StudyOS Gratuit et Pro. Commencez gratuitement et passez à l’offre supérieure quand vous voulez le modèle le plus performant, des générations illimitées et un support prioritaire.",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Langue",
    choose: "Choisir la langue",
  },

  // ---- Shared bits used on more than one surface ------------------------
  common: {
    openApp: "Ouvrir l’app",
    signIn: "Se connecter",
    getStarted: "Commencer",
    cancel: "Annuler",
  },

  // ---- Landing page ------------------------------------------------------
  landing: {
    nav: {
      howItWorks: "Comment ça marche",
      features: "Fonctionnalités",
      pricing: "Tarifs",
      openApp: "Ouvrir l’app",
      signIn: "Se connecter",
      getStarted: "Commencer",
    },
    hero: {
      badge: "Conçu pour les étudiants et les chercheurs",
      titleLine1: "Tout votre semestre,",
      titleLine2: "organisé.",
      subtitle:
        "Décrivez vos cours en une phrase et StudyOS met en place les tableaux de bord, plannings et suivis dont vous avez besoin — déjà remplis. Aucun modèle à choisir, aucune page blanche.",
      ctaGenerate: "Générer mon espace de travail",
      ctaDemo: "Voir une démo",
      finePrint: "Gratuit pour commencer · Sans carte bancaire · Prêt en quelques secondes",
    },
    builtFor: {
      label: "Conçu pour",
      items: [
        "Informatique",
        "Médecine",
        "Droit",
        "MBA",
        "Lycée",
        "Études supérieures",
      ],
    },
    how: {
      title: "D’une phrase à un espace de travail complet.",
      subtitle: "Trois étapes, une dizaine de secondes.",
      steps: [
        {
          title: "Décrivez vos cours",
          body: "Une phrase — « Je suis en médecine et je suis les cours d’Anatomie, de Biochimie et de Physiologie. »",
        },
        {
          title: "Obtenez un espace de travail complet",
          body: "Des cours, un tableau de devoirs, un planning et une liste de lectures — déjà mis en place et remplis.",
        },
        {
          title: "Étudiez et ajustez",
          body: "Modifiez tout, cochez vos tâches, demandez des changements en langage courant. Tout est enregistré automatiquement.",
        },
      ],
    },
    features: {
      title: "Tout ce qu’un semestre demande.",
      subtitle: "Généré pour vous en une étape — puis à vous de le façonner.",
      items: {
        generate: {
          k: "Générer",
          title: "Des espaces conçus pour vous",
          body: "Une seule consigne devient un espace de travail complet, adapté à vos cours exacts.",
        },
        databases: {
          k: "Bases de données",
          title: "Des données réelles et structurées",
          body: "Devoirs, notes et lectures sous forme de tableaux avec des champs personnalisés — pas de notes éparses.",
        },
        calendar: {
          k: "Calendrier",
          title: "Planning et calendrier",
          body: "Toutes vos échéances au même endroit. Basculez entre tableau, tableau Kanban et calendrier en un clic.",
        },
        dashboard: {
          k: "Tableau de bord",
          title: "Un point de repère clair",
          body: "Une page qui rassemble toute votre semaine pour que vous sachiez toujours ce qui vient ensuite.",
        },
        autosave: {
          k: "Enregistrement auto",
          title: "Modifié, enregistré aussitôt",
          body: "Renommez, cochez, ajoutez des lignes — chaque changement s’enregistre dès que vous le faites.",
        },
        assistant: {
          k: "Assistant",
          title: "Demandez en langage courant",
          body: "« Ajoute un partiel en informatique. » Votre espace de travail se met à jour sous vos yeux.",
        },
      },
    },
    pricing: {
      title: "Des tarifs simples, pensés pour les étudiants.",
      subtitle: "Commencez gratuitement. Passez à l’offre supérieure seulement quand vous en voulez plus.",
      perMonth: "/mois",
      free: {
        name: "Gratuit",
        price: "$0",
        features: [
          "Générer des espaces de travail par l’IA",
          "Tout modifier et enregistrer automatiquement",
          "Tableaux de bord, bases de données, calendrier",
          "Demander des modifications en langage courant",
        ],
        cta: "Commencer",
      },
      pro: {
        badge: "Le plus populaire",
        name: "Pro",
        price: "$5",
        features: [
          "Tout ce que contient l’offre Gratuit",
          "Générations illimitées",
          "Le modèle le plus intelligent et le plus détaillé",
          "Support prioritaire",
        ],
        cta: "Commencez gratuitement, évoluez quand vous voulez",
      },
    },
    closing: {
      titleLine1: "Arrêtez de tout configurer.",
      titleLine2: "Commencez à étudier.",
      subtitle: "Votre premier espace de travail n’est qu’à une phrase.",
      cta: "Générer mon espace de travail",
    },
    footer: {
      tagline: "L’espace d’études pour les étudiants · © 2026",
    },
    preview: {
      name: "QG d’études Informatique",
      thisWeek: "Cette semaine",
      columns: { todo: "À faire", doing: "En cours", done: "Terminé" },
      cards: ["Quiz sur les preuves", "TP listes chaînées", "Compte rendu de TP 2"],
      coursesLabel: "Cours",
      courses: ["Structures de données", "Mathématiques discrètes", "Physique I"],
    },
  },

  // ---- Pricing page (/pricing) ------------------------------------------
  pricing: {
    nav: { openApp: "Ouvrir l’app", signIn: "Se connecter", getStarted: "Commencer" },
    badge: "Des tarifs simples, pensés pour les étudiants",
    title: "Commencez gratuitement. Évoluez quand vous êtes prêt.",
    subtitle:
      "Tout ce dont vous avez besoin pour organiser votre semestre est gratuit. L’offre Pro ajoute le modèle le plus performant, des générations illimitées et un support prioritaire.",
    free: {
      name: "Gratuit",
      price: "$0",
      tagline: "Tout pour s’organiser.",
      bullets: [
        "Espaces d’études générés par l’IA",
        "Édition en ligne complète et enregistrement auto",
        "Bases de données — tableau, tableau Kanban et calendrier",
        "Chat avec l’agent IA dans votre espace de travail",
      ],
      ctaSignedOut: "Commencer gratuitement",
      ctaSignedIn: "Ouvrir vos espaces de travail",
      bulletCredits: "{count} crédits IA de départ",
    },
    pro: {
      badge: "Le plus populaire",
      name: "Pro",
      price: "$5",
      perMonth: "/mois",
      billed: "Facturé mensuellement · annulable à tout moment.",
      bullets: [
        "Tout ce que contient l’offre Gratuit",
        "Générations d’espaces de travail illimitées",
        "Le modèle le plus performant et le plus détaillé",
        "Support prioritaire et accès anticipé",
      ],
      currentPlan: "✦ Votre offre actuelle",
      manageBilling: "Gérer la facturation",
      upgrade: "Passer à Pro",
      ctaSignedOut: "Commencer avec Pro",
      bulletCredits: "{count} crédits IA inclus",
    },
    comparison: {
      title: "Comparer les offres",
      featuresHeader: "Fonctionnalités",
      freeHeader: "Gratuit",
      proHeader: "Pro",
      included: "Inclus",
      notIncluded: "Non inclus",
      features: {
        aiWorkspaces: "Espaces de travail générés par l’IA",
        onboarding: "Questions d’accueil guidées",
        editing: "Édition en ligne complète et enregistrement auto",
        databases: "Bases de données — tableau, tableau Kanban et calendrier",
        dragDrop: "Édition par glisser-déposer",
        agentChat: "Chat avec l’agent IA qui modifie votre espace de travail",
        model: "Modèle de génération",
        generations: "Générations d’espaces de travail",
        support: "Support",
        earlyAccess: "Accès anticipé aux nouvelles fonctionnalités",
        credits: "Crédits IA inclus",
        buyMore: "Achetez plus de crédits à tout moment",
      },
      values: {
        standard: "Standard",
        mostCapable: "Le plus performant",
        generous: "Généreux",
        unlimited: "Illimité",
        community: "Communauté",
        priority: "Prioritaire",
      },
    },
    credits: {
      heading: "L’IA fonctionne avec des crédits",
      intro:
        "Chaque requête IA dépense des crédits selon son ampleur — un petit ajustement coûte peu, construire un espace de travail entier coûte plus. L’offre Pro arrive chargée de crédits, et vous pouvez recharger à tout moment.",
      freeIncludes: "L’offre Gratuit inclut {count} crédits de départ",
      proIncludes: "L’offre Pro inclut {count} crédits",
      neverExpire: "Rechargez à tout moment — les crédits n’expirent jamais",
      balance: "Votre solde : {count} crédits",
      pack: "Pack de crédits",
      unit: "crédits",
      buy: "Acheter {count} crédits",
      signUpToBuy: "Inscrivez-vous pour acheter des crédits",
      oneTime: "Achat unique · paiement sécurisé",
    },
    faqTitle: "Questions",
    faq: [
      {
        q: "StudyOS est-il vraiment gratuit pour commencer ?",
        a: "Oui. Créez un compte et générez, modifiez et utilisez vos espaces de travail avec l’offre Gratuit — sans carte bancaire.",
      },
      {
        q: "Qu’est-ce que j’obtiens avec Pro ?",
        a: "Des générations illimitées, le modèle le plus performant pour des espaces de travail plus riches et plus précis, un support prioritaire et un accès anticipé aux nouvelles fonctionnalités.",
      },
      {
        q: "Puis-je annuler à tout moment ?",
        a: "À tout moment. Gérez ou annulez votre abonnement depuis le portail de facturation — vous conservez Pro jusqu’à la fin de la période.",
      },
      {
        q: "Qu’advient-il de mes espaces de travail si je rétrograde ?",
        a: "Rien n’est supprimé. Vos espaces de travail restent exactement tels quels et demeurent entièrement modifiables avec l’offre Gratuit.",
      },
    ],
    ctaTitle: "Votre premier espace de travail n’est qu’à une phrase.",
    ctaSubtitle: "Essayez StudyOS gratuitement — passez à l’offre supérieure seulement si vous en voulez plus.",
    ctaSignedIn: "Générer un espace de travail",
    ctaSignedOut: "Commencer gratuitement",
    footerTagline: "L’espace d’études pour les étudiants · © 2026",
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "Gérer",
    upgrade: "Passer à Pro",
    generate: "Générer",
    upgradedBanner: "Vous êtes en Pro — vos espaces de travail utilisent désormais le modèle le plus intelligent.",
    title: "Vos espaces de travail",
    subtitle: "Tout ce que StudyOS a conçu pour vous.",
    total: "{count} au total",
    emptyTitle: "Aucun espace de travail pour l’instant",
    emptySubtitle: "Générez-en un, ou chargez la démo pour explorer.",
    emptyGenerate: "Générer un espace de travail",
    loadDemo: "Charger la démo",
    updatedAt: "mis à jour le {date}",
    fallbackIcon: "📄",
  },

  // ---- Generate flow (/generate) ----------------------------------------
  generate: {
    backToWorkspaces: "Vos espaces de travail →",
    examples: [
      { emoji: "💻", text: "Je suis en 1re année d’informatique et je suis 5 cours" },
      {
        emoji: "⚕️",
        text: "Étudiant en 2e année de médecine : Anatomie, Biochimie, Physiologie, Chimie organique",
      },
      { emoji: "🎓", text: "Lycéen en première révisant 6 matières pour les examens" },
      {
        emoji: "📈",
        text: "Étudiant en MBA suivant Microéconomie, Comptabilité et Marketing",
      },
    ],
    planSteps: [
      "Lecture de votre description",
      "Réflexion sur de bonnes questions",
      "Adaptation de votre configuration",
    ],
    planningTitle: "Faisons connaissance",
    errorGeneric: "Une erreur est survenue. Veuillez réessayer.",
    errorBuild: "Une erreur est survenue lors de la génération de votre espace de travail. Réessayez.",
    describe: {
      step: "Étape 1 sur 2",
      title: "Qu’étudiez-vous ?",
      subtitle:
        "Décrivez vos cours et vos objectifs en langage courant. StudyOS vous pose quelques questions rapides, puis conçoit tout l’espace de travail autour de vos réponses.",
      placeholder:
        "ex. Je suis en 1re année d’informatique et je suis Structures de données, Mathématiques discrètes, Analyse II et Expression écrite ce semestre.",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "Continuer",
      examplesLabel: "Vous hésitez ? Partez d’un exemple",
      finePrint: "Gratuit · sans carte bancaire · prêt en quelques secondes",
    },
    questions: {
      back: "← Modifier la description",
      step: "Étape 2 sur 2",
      title: "Personnalisons tout ça",
      designingFor: "Conçu pour :",
      pickAny: "choisissez-en plusieurs",
      pickOne: "choisissez-en un",
      build: "Créer mon espace de travail",
      answeredNone: "Répondez à quelques-unes, ou lancez directement — c’est vous qui décidez",
      answeredCount: "{n} / {total} répondues",
      other: "Autre",
      otherPlaceholder: "Saisissez votre propre préférence…",
      otherAria: "Autre réponse pour {question}",
    },
  },

  // ---- Generation activity (full-screen build progress) -----------------
  genActivity: {
    building: "Création de votre espace de travail",
    designing: "Conception de votre espace de travail",
    componentsChosen: "Composants choisis pour vous",
    planningComponents: "Planification des composants",
    onlyRelevant: "Uniquement les pages et les suivis pertinents au regard de vos réponses.",
    componentsCount: "{count} composants",
    everythingEditable:
      "Tout ce qui est généré reste modifiable — pages, champs, vues, lignes et contenu.",
    statusReady: "Prêt",
    statusGenerating: "Génération…",
    statusQueued: "En file d’attente",
    finishingUp: "Finalisation",
    yourWorkspace: "Votre espace de travail",
    pagesLabel: "Pages",
    sectionsBuilt: "{built} sections sur {total} créées",
    choosingPieces: "Sélection des bons éléments pour vous…",
    stillEditable: "Tout reste modifiable une fois prêt",
    writingItIn: "Rédaction en cours…",
    board: { todo: "À faire", doing: "En cours", done: "Terminé" },
    phase: {
      analyzing: "Analyse de vos réponses",
      planning: "Sélection des composants",
      generating: "Génération de l’espace de travail",
      validating: "Validation des données",
      saving: "Enregistrement",
    },
  },

  // ---- AiActivity overlay (calm spinner used during planning) -----------
  aiActivity: {
    defaultTitle: "En cours de traitement",
    defaultSteps: [
      "Lecture de votre espace de travail",
      "Planification des changements",
      "Conception de la mise en page",
      "Rédaction des modifications",
    ],
  },

  // ---- Workspace editor chrome ------------------------------------------
  editor: {
    workspaceIcon: "Icône de l’espace de travail",
    newPage: "Nouvelle page",
    untitled: "Sans titre",
    allWorkspaces: "← Tous les espaces de travail",
    deletePage: "Supprimer la page",
    askAi: "Demander à l’IA",
    closeAgent: "Fermer l’agent",
    saving: "Enregistrement…",
    saveFailed: "Échec de l’enregistrement",
    saved: "Enregistré",
  },

  // ---- In-workspace AI agent chat ---------------------------------------
  agentChat: {
    title: "Agent IA",
    subtitleIdle: "Comprend l’ensemble de votre espace de travail",
    closeChat: "Fermer le chat",
    suggestions: [
      "Ajouter un suivi d’habitudes",
      "Créer un plan de révision de 2 semaines pour les examens",
      "Ajouter un partiel à chaque cours",
      "Sur quoi devrais-je me concentrer cette semaine ?",
    ],
    intro:
      "Demandez-moi de modifier un seul élément ou de coordonner des mises à jour dans tout votre espace de travail. Si quelque chose n’est pas clair, je poserai une question avant de modifier.",
    workspaceUpdated: "Espace de travail mis à jour",
    undo: "Annuler",
    undoing: "Annulation…",
    undone: "Modification annulée",
    undoFailed: "Cette modification ne peut pas être annulée, car l’espace de travail a changé.",
    buildingUpdate: "Création de votre mise à jour",
    thinking: "Réflexion…",
    stopTask: "Arrêter la tâche",
    stopping: "Arrêt…",
    taskStopped: "Tâche arrêtée.",
    stopFailed: "Impossible d’arrêter la tâche. Elle est peut-être toujours en cours.",
    steps: {
      inspect: "Examiner l’espace de travail",
      decide: "Choisir l’action la plus sûre",
      prepare: "Préparer la mise à jour coordonnée",
    },
    phase: {
      inspecting: "Examen de votre espace de travail",
      planning: "Planification du changement le plus sûr",
      updating: "Coordination des mises à jour de l’espace de travail",
      validating: "Vérification de chaque connexion",
      saving: "Enregistrement de vos modifications",
    },
    areaStatus: { queued: "En file d’attente", working: "Mise à jour", complete: "Prêt" },
    initialMessage: "Ouverture de votre espace de travail",
    placeholderBusy: "L’agent est en train de travailler…",
    placeholderIdle: "Demandez à l’agent de créer ou de modifier quelque chose…",
    send: "Envoyer",
    inputHint: "Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne",
    errorRequestFailed: "Échec de la requête de l’agent",
    errorEndedUnexpectedly: "La réponse de l’agent s’est terminée de façon inattendue",
    errorSnag: "L’agent a rencontré un problème. Veuillez réessayer.",
    errorCouldntComplete:
      "Je n’ai pas pu effectuer cela en toute sécurité. Réessayez ou précisez davantage votre demande.",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    pageIcon: "Icône de la page",
    headingLevel: "Niveau de titre",
    calloutIcon: "Icône de l’encadré",
    addBlock: "+ Ajouter un bloc",
    deleteBlock: "Supprimer le bloc",
    blockTypes: {
      paragraph: "Texte",
      heading: "Titre",
      todo: "Tâche",
      bulleted_list_item: "Liste",
      numbered_list_item: "Numérotée",
      quote: "Citation",
      callout: "Encadré",
      divider: "Séparateur",
      database: "Tableau",
    },
    placeholders: {
      paragraph: "Saisissez quelque chose…",
      todo: "Tâche",
      listItem: "Élément de liste",
      callout: "Encadré",
    },
    headingDefault: "Titre",
    newTable: {
      name: "Nouveau tableau",
      propName: "Nom",
      propStatus: "Statut",
      propDue: "Échéance",
      statusTodo: "À faire",
      statusInProgress: "En cours",
      statusDone: "Terminé",
      viewTable: "Tableau",
    },
  },

  // ---- Database views (table / board / calendar) ------------------------
  db: {
    databaseIcon: "Icône de la base de données",
    nameAria: "Nom de la base de données",
    newRow: "+ Nouvelle ligne",
    newCard: "+ Nouveau",
    untitled: "Sans titre",
    empty: "—",
    deleteRow: "Supprimer la ligne",
    deleteCard: "Supprimer la carte",
    dragHint: "Faites glisser vers une autre colonne",
    prevMonth: "Mois précédent",
    nextMonth: "Mois suivant",
    addOnDay: "Ajouter ce jour-là",
    clickToRename: "Cliquez pour renommer",
    delete: "Supprimer",
  },

  // ---- Database settings panel ------------------------------------------
  dbSettings: {
    customize: "Personnaliser les champs et les vues",
    description: "Description",
    descriptionPlaceholder: "À quoi sert ce suivi",
    fields: "Champs",
    addField: "+ Ajouter un champ",
    fieldName: "Nom du champ",
    fieldType: "Type de champ",
    deleteField: "Supprimer le champ",
    newField: "Nouveau champ",
    chooseRelatedDatabase: "Choisir la base de données liée",
    optionLabel: "Libellé de l’option",
    addOption: "+ option",
    newOption: "Nouvelle option",
    views: "Vues",
    addView: "+ Ajouter une vue",
    viewName: "Nom de la vue",
    newView: "Nouvelle vue",
    deleteView: "Supprimer la vue",
    groupBy: "Grouper par…",
    dateField: "Champ de date…",
    deleteDatabase: "Supprimer cette base de données",
    deleteConfirm: "Supprimer « {name} » et la retirer de toutes les pages ?",
    propertyTypes: {
      text: "Texte",
      number: "Nombre",
      checkbox: "Case à cocher",
      date: "Date",
      select: "Sélection",
      multi_select: "Sélection multiple",
      status: "Statut",
      url: "URL",
      relation: "Relation",
    },
    viewTypes: {
      table: "Tableau",
      board: "Tableau Kanban",
      calendar: "Calendrier",
      list: "Liste",
      gallery: "Galerie",
    },
    defaults: {
      statusTodo: "À faire",
      statusInProgress: "En cours",
      statusDone: "Terminé",
      option1: "Option 1",
      option2: "Option 2",
    },
  },

  // ---- Default onboarding questions (no-API-key fallback) ----------------
  onboarding: {
    level: {
      question: "Quel est votre niveau d’études ?",
      options: {
        hs: "Lycée",
        ug: "Licence",
        grad: "Master / Doctorat",
        self: "En autodidacte",
      },
    },
    load: { question: "Combien de cours jonglez-vous en ce moment ?" },
    track: {
      question: "Que souhaitez-vous suivre le plus ?",
      options: {
        assign: "Devoirs",
        exams: "Examens",
        read: "Lectures",
        notes: "Notes",
        habits: "Habitudes d’étude",
        grades: "Résultats",
      },
    },
    style: {
      question: "Comment aimez-vous planifier ?",
      options: { cal: "Par calendrier", board: "Par tableau", list: "Listes simples" },
    },
  },

  // ---- Server-emitted AI progress + errors ------------------------------
  ai: {
    generate: {
      phase: {
        analyzing: "Lecture de vos cours, objectifs et préférences",
        planning: "Choix des bons composants pour l’espace de travail",
        generating: "Génération de votre espace de travail complet en une seule passe",
        validating: "Vérification des liens, vues, champs et données de départ",
        saving: "Enregistrement de votre espace de travail modifiable",
      },
      error:
        "Impossible de générer l’espace de travail. Veuillez réessayer avec une description plus courte.",
      detail: {
        dashboard: "{count} pages modifiables connectées",
        courses: "{count} cours ajoutés",
        trackedItems: "{count} éléments suivis ajoutés",
        scheduled: "{count} éléments planifiés",
        readings: "{count} lectures ajoutées",
        habits: "{count} routines ajoutées",
        grades: "{count} lignes de notes ajoutées",
        notes: "Structure de notes modifiable créée",
        generic: "Composant créé et connecté",
      },
    },
    agent: {
      inspecting: "Examen de {pages} pages et {databases} bases de données",
      inspectingArea: "Examen de {area}",
      planning: "Compréhension de la demande et recherche d’ambiguïtés",
      updating: "Application de modifications coordonnées dans votre espace de travail",
      validating: "Vérification des références, vues, champs et données liées",
      saving: "Enregistrement de l’espace de travail mis à jour",
      workspaceNotFound: "Espace de travail introuvable.",
      workspaceChanged: "Votre espace de travail a changé pendant mon intervention. Veuillez réessayer.",
      undoUnavailable: "Cette modification ne peut pas être annulée, car l’espace de travail contient des changements plus récents.",
      error:
        "L’agent n’a pas pu terminer cette demande en toute sécurité. Veuillez réessayer ou préciser davantage votre demande.",
      fallbackReply: "Votre espace de travail a été mis à jour.",
    },
    errors: {
      notAuthenticated: "Non authentifié",
      invalidAgentRequest: "Requête d’agent invalide",
      describeBeforeGenerating:
        "Décrivez vos études avant de générer un espace de travail.",
    },
  },

  // ---- Credits ----------------------------------------------------------
  credits: {
    label: "Crédits IA",
    amount: "{count} crédits",
    buy: "Acheter des crédits",
    metaTitle: "Acheter des crédits · StudyOS",
    pageIntro:
      "Les crédits alimentent chaque requête IA — générer des espaces de travail et discuter avec l’agent. Rechargez à tout moment ; les crédits n’expirent jamais.",
    oneTimeExpire: "Achat unique · paiement sécurisé · les crédits n’expirent jamais",
    wantMore: "Vous voulez le modèle le plus performant et des crédits inclus ?",
    spentOn: "Dépensés pour les générations IA et les modifications de l’agent.",
    addedBanner: "{added} crédits ajoutés — vous avez maintenant {total}.",
    outGenerate:
      "Vous n’avez plus de crédits IA. Ajoutez-en depuis la page Tarifs pour continuer à générer.",
    outAgent:
      "Vous n’avez plus de crédits IA. Ajoutez-en depuis la page Tarifs pour continuer à utiliser l’agent.",
  },

  // ---- Account menu -----------------------------------------------------
  account: {
    pro: "Pro",
    free: "Gratuit",
    fallbackName: "Compte",
    viewProfile: "Voir le profil",
    manageProfile: "Gérer le profil",
    subscriptionPayments: "Abonnement et paiements",
    buyCredits: "Acheter des crédits",
    settings: "Paramètres",
    signOut: "Se déconnecter",
    manageAccount: "Gérer le compte",
    creditsAndPlan: "{credits} crédits · {plan}",
  },

  // ---- Account settings page --------------------------------------------
  settings: {
    metaTitle: "Paramètres du compte · StudyOS",
    back: "← Espaces de travail",
    title: "Paramètres du compte",
    subtitle: "Gérez votre profil, votre offre, vos paiements et vos crédits.",
    profile: "Profil",
    yourAccount: "Votre compte",
    subscription: "Abonnement",
    proDesc:
      "Vous êtes en Pro — le modèle le plus performant et un support prioritaire. Gérez votre abonnement, vos moyens de paiement et vos factures ci-dessous.",
    freeDesc:
      "Vous êtes sur l’offre Gratuit. Passez à Pro pour le modèle le plus performant, des crédits inclus et un support prioritaire.",
    manageSubscription: "Gérer l’abonnement et les paiements",
    upgrade: "Passer à Pro",
    comparePlans: "Comparer les offres",
    creditsDesc:
      "Les crédits alimentent chaque requête IA. Rechargez à tout moment — les crédits n’expirent jamais.",
    buyPack: "Acheter {count} crédits · ${price}",
    viewPricing: "Voir les tarifs",
    signOut: "Se déconnecter",
  },

  // ---- Workspace card (delete control) ----------------------------------
  workspaceCard: {
    delete: "Supprimer l’espace de travail",
    deleteAria: "Supprimer {name}",
    deleteConfirm:
      "Supprimer « {name} » ?\n\nCela supprime définitivement l’espace de travail et tout son contenu. Cette action est irréversible.",
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  mock: {
    workspaceName: "QG d’études",
    workspaceNameField: "QG d’études {field}",
    welcome:
      "Généré à partir de votre description : « {summary} ». Tout ici est un point de départ que vous pouvez modifier.",
    tbd: "À définir",
    status: { notStarted: "Non commencé", inProgress: "En cours", done: "Terminé" },
    type: { homework: "Devoir", quiz: "Quiz", exam: "Examen", project: "Projet" },
    exam: { midterm: "Partiel", final: "Examen final" },
    courses: {
      name: "Cours",
      description: "Tous les cours que vous suivez ce semestre.",
      propCourse: "Cours",
      propCode: "Code",
      propInstructor: "Enseignant",
      propCredits: "Crédits",
      propSchedule: "Emploi du temps",
      viewAll: "Tous les cours",
    },
    assignments: {
      name: "Devoirs",
      description: "Devoirs, quiz, projets et examens.",
      propName: "Devoir",
      propCourse: "Cours",
      propType: "Type",
      propStatus: "Statut",
      propDue: "Échéance",
      propWeight: "Pondération %",
      viewAll: "Tous",
      viewBoard: "Par statut",
      viewCalendar: "Calendrier",
      projectMilestone: "Jalon de projet {n} — {code}",
    },
    readings: {
      name: "Liste de lectures",
      description: "Quoi lire, organisé par cours.",
      propTitle: "Titre",
      propCourse: "Cours",
      propRead: "Lu",
      propLink: "Lien",
      viewAll: "Liste de lectures",
      coreReading: "{course} : lecture essentielle",
    },
    habits: {
      name: "Habitudes d’étude",
      description: "Un suivi léger de régularité hebdomadaire.",
      propHabit: "Habitude",
      propDate: "Date",
      propDone: "Fait",
      propMinutes: "Minutes",
      viewAll: "Toutes les habitudes",
      viewCalendar: "Calendrier",
      reviewNotes: "Revoir les notes du jour",
      practiceRecall: "S’entraîner à la restitution",
    },
    grades: {
      name: "Suivi des notes",
      description: "Notes et pondérations modifiables pour chaque cours.",
      propItem: "Évaluation",
      propCourse: "Cours",
      propScore: "Note",
      propOutOf: "Sur",
      propWeight: "Pondération %",
      viewAll: "Toutes les notes",
      assessmentN: "Évaluation {n}",
    },
    pages: {
      dashboard: "Tableau de bord",
      courses: "Cours",
      assignments: "Devoirs",
      planner: "Planning",
      readings: "Liste de lectures",
      exams: "Préparation aux examens",
      notes: "Notes",
      habits: "Habitudes d’étude",
      grades: "Suivi des notes",
    },
    dashboard: {
      assignmentsHeading: "📌 Devoirs par statut",
      coursesHeading: "📚 Mes cours",
    },
    assignmentsPage: { intro: "Tout ce que vous devez rendre, avec les échéances et les pondérations." },
    plannerPage: { intro: "Vos échéances présentées sur un calendrier." },
    examsPage: {
      callout:
        "Confirmez les dates, puis décomposez chaque examen en sujets de révision et séances d’entraînement.",
    },
    notesPage: {
      heading: "Notes de cours",
      callout:
        "Ajoutez un titre pour chaque cours magistral, puis notez les idées clés et les questions en dessous.",
      fallbackCourse: "Cours",
      startWriting: "Commencez à écrire ici…",
    },
    gradesPage: {
      callout:
        "Remplacez les évaluations de départ par les pondérations de votre programme et vos résultats réels.",
    },
    plan: {
      summaryWith: "Un espace de travail sur mesure construit autour de {focus}.",
      summaryGeneric:
        "Un espace de travail sur mesure pour les cours, les échéances et la planification des études.",
      components: {
        dashboard: {
          label: "Tableau de bord",
          description: "Votre semestre, vos priorités et vos prochaines échéances.",
        },
        courses: {
          label: "Cours",
          description: "Détails des cours, emplois du temps et enseignants.",
        },
        assignments: {
          label: "Devoirs",
          description: "Travaux, échéances, pondérations et statut.",
        },
        planner: {
          label: "Planning",
          description: "Une vue calendrier du travail à venir.",
        },
        readings: {
          label: "Liste de lectures",
          description: "Textes assignés et progression de lecture.",
        },
        exams: {
          label: "Préparation aux examens",
          description: "Dates d’examen, sujets et tâches de révision.",
        },
        notes: {
          label: "Notes",
          description: "Un espace structuré pour vos notes de cours.",
        },
        habits: {
          label: "Habitudes d’étude",
          description: "Routines d’étude quotidiennes et régularité.",
        },
        grades: {
          label: "Suivi des notes",
          description: "Notes, pondérations et objectifs de résultats.",
        },
      },
    },
  },
} satisfies Dictionary;
