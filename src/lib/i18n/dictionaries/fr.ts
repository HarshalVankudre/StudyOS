import type { Dictionary } from "./en";

/** French (fr-FR) — translation of the canonical English dictionary. */
export const fr = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — Votre espace d’étude, conçu par l’IA",
    homeDescription:
      "Décrivez vos cours et vos échéances, et StudyOS génère instantanément vos tableaux de bord, vos plannings et vos suivis de devoirs. L’espace d’étude propulsé par l’IA pour les étudiants.",
    appTitle: "Vos espaces de travail · StudyOS",
    generateTitle: "Générez votre espace de travail · StudyOS",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Langue",
    choose: "Choisir la langue",
  },

  // ---- Landing page ------------------------------------------------------
  landing: {
    nav: {
      howItWorks: "Comment ça marche",
      features: "Fonctionnalités",
      pricing: "Tarifs",
      openApp: "Ouvrir l’application",
      signIn: "Se connecter",
      getStarted: "Commencer",
    },
    hero: {
      badge: "Conçu pour les étudiants et les chercheurs",
      titleLine1: "Tout votre semestre,",
      titleLine2: "organisé.",
      subtitle:
        "Décrivez vos cours en une phrase et StudyOS met en place les tableaux de bord, les plannings et les suivis dont vous avez besoin — déjà remplis. Aucun modèle, aucune page blanche.",
      ctaGenerate: "Générer mon espace de travail",
      ctaDemo: "Voir une démo",
      finePrint: "Gratuit pour commencer · Sans carte bancaire · Prêt en quelques secondes",
    },
    builtFor: {
      label: "Conçu pour",
      items: [
        "Informatique",
        "Médecine (PASS/LAS)",
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
          title: "Obtenez un espace complet",
          body: "Cours, tableau de devoirs, planning et liste de lectures — déjà configurés et remplis.",
        },
        {
          title: "Étudiez et ajustez",
          body: "Modifiez tout, cochez vos tâches, demandez des changements en langage naturel. Tout est enregistré automatiquement.",
        },
      ],
    },
    features: {
      title: "Tout ce qu’un semestre exige.",
      subtitle: "Généré pour vous en une étape — puis modelable à votre guise.",
      items: {
        generate: {
          k: "Générer",
          title: "Des espaces de travail faits pour vous",
          body: "Une simple consigne devient un espace de travail complet, adapté précisément à vos cours.",
        },
        databases: {
          k: "Bases de données",
          title: "Des données réelles et structurées",
          body: "Devoirs, notes et lectures sous forme de tableaux avec des champs personnalisés — pas de simples notes éparses.",
        },
        calendar: {
          k: "Calendrier",
          title: "Planning et calendrier",
          body: "Toutes vos échéances au même endroit. Basculez entre tableau, vue Kanban et calendrier en un clic.",
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
          title: "Demandez en langage naturel",
          body: "« Ajoute un partiel en informatique. » Votre espace se met à jour, sous vos yeux.",
        },
      },
    },
    pricing: {
      title: "Des tarifs simples, pensés pour les étudiants.",
      subtitle: "Commencez gratuitement. Passez à l’offre supérieure uniquement quand vous en voulez plus.",
      perMonth: "/mois",
      free: {
        name: "Gratuit",
        price: "$0",
        features: [
          "Générer des espaces de travail par IA",
          "Tout modifier et enregistrer automatiquement",
          "Tableaux de bord, bases de données, calendrier",
          "Demander des modifications en langage naturel",
        ],
        cta: "Commencer",
      },
      pro: {
        badge: "Le plus populaire",
        name: "Pro",
        price: "$5",
        features: [
          "Tout ce que propose l’offre Gratuit",
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
      subtitle: "Votre premier espace de travail n’est qu’à une phrase de vous.",
      cta: "Générer mon espace de travail",
    },
    footer: {
      tagline: "L’espace d’étude pour les étudiants · © 2026",
    },
    // The little workspace mockup in the hero.
    preview: {
      name: "QG d’étude Informatique",
      thisWeek: "Cette semaine",
      columns: { todo: "À faire", doing: "En cours", done: "Terminé" },
      cards: ["Quiz sur les preuves", "TP listes chaînées", "Compte rendu de TP 2"],
      coursesLabel: "Cours",
      courses: ["Structures de données", "Mathématiques discrètes", "Physique I"],
    },
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "Gérer",
    upgrade: "Passer à Pro",
    generate: "Générer",
    upgradedBanner: "Vous êtes en Pro — vos espaces de travail utilisent désormais le modèle le plus performant.",
    title: "Vos espaces de travail",
    subtitle: "Tout ce que StudyOS a construit pour vous.",
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
      "Personnalisation de votre configuration",
    ],
    buildSteps: [
      "Planification de vos cours",
      "Conception de votre tableau de bord",
      "Mise en page de votre planning",
      "Assemblage de l’espace de travail",
    ],
    planningTitle: "Faisons connaissance",
    buildingTitle: "Création de votre espace de travail",
    errorGeneric: "Une erreur est survenue. Veuillez réessayer.",
    errorBuild: "Une erreur est survenue lors de la génération de votre espace de travail. Réessayez.",
    describe: {
      step: "Étape 1 sur 2",
      title: "Qu’étudiez-vous ?",
      subtitle:
        "Décrivez vos cours et vos objectifs en langage naturel. StudyOS vous pose quelques questions rapides, puis conçoit tout l’espace de travail autour de vos réponses.",
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
    },
  },

  // ---- AI activity overlay ----------------------------------------------
  aiActivity: {
    defaultTitle: "En cours de traitement",
    defaultSteps: [
      "Lecture de votre espace de travail",
      "Planification des changements",
      "Conception de la mise en page",
      "Rédaction des modifications",
    ],
    updatingTitle: "Mise à jour de votre espace de travail",
  },

  // ---- Workspace editor --------------------------------------------------
  editor: {
    newPage: "Nouvelle page",
    untitled: "Sans titre",
    allWorkspaces: "← Tous les espaces de travail",
    deletePage: "Supprimer la page",
    askAi: "Demander à l’IA",
    aiPlaceholder:
      "Demandez à l’IA de modifier cet espace de travail — « ajoute un partiel en informatique », « crée un plan de révision pour les examens », « ajoute un suivi d’habitudes »…",
    aiWorking: "En cours…",
    aiApply: "Appliquer",
    aiClose: "Fermer",
    aiError: "Impossible d’appliquer cela — essayez de reformuler ou de simplifier la demande.",
    saving: "Enregistrement…",
    saveFailed: "Échec de l’enregistrement",
    saved: "Enregistré",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    addBlock: "+ Ajouter un bloc",
    cancel: "Annuler",
    deleteBlock: "Supprimer le bloc",
    blockTypes: {
      paragraph: "Texte",
      heading: "Titre",
      todo: "Tâche",
      bulleted_list_item: "Liste",
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
    // Defaults for a brand-new table inserted via "+ Add block → Table".
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
    nameAria: "Nom de la base de données",
    newRow: "+ Nouvelle ligne",
    newCard: "+ Nouveau",
    untitled: "Sans titre",
    empty: "—",
    link: "Lien ↗",
    linked: "{count} liés",
    deleteRow: "Supprimer la ligne",
    deleteCard: "Supprimer la carte",
    dragHint: "Faites glisser vers une autre colonne",
    prevMonth: "Mois précédent",
    nextMonth: "Mois suivant",
    addOnDay: "Ajouter ce jour-là",
    clickToRename: "Cliquez pour renommer",
    delete: "Supprimer",
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
    load: {
      question: "Combien de cours jonglez-vous en ce moment ?",
      // 1–2, 3–4, 5–6, 7+ stay numeric across locales (see onboarding.ts).
    },
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
      options: {
        cal: "Par calendrier",
        board: "Par tableau",
        list: "Listes simples",
      },
    },
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  // The fixed labels the rule-based generator emits so the offline experience
  // is localized too. Course names derive from the user's own prompt.
  mock: {
    workspaceName: "QG d’étude",
    workspaceNameField: "QG d’étude {field}",
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
    // Workspace component plan (labels + descriptions shown in the loader).
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
        projects: {
          label: "Projets",
          description: "Jalons et prochaines actions pour les travaux d’envergure.",
        },
      },
    },
  },
} satisfies Dictionary;
