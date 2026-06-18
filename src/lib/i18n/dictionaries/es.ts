import type { Dictionary } from "./en";

/** Spanish (es-ES) — translation of the canonical English dictionary. */
export const es = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — Tu espacio de estudio, creado por IA",
    homeDescription:
      "Describe tus asignaturas y fechas de entrega, y StudyOS construye al instante tus paneles, planificadores y seguimientos de tareas. El espacio de estudio con IA para estudiantes.",
    appTitle: "Tus espacios de trabajo · StudyOS",
    generateTitle: "Genera tu espacio de trabajo · StudyOS",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Idioma",
    choose: "Elige idioma",
  },

  // ---- Landing page ------------------------------------------------------
  landing: {
    nav: {
      howItWorks: "Cómo funciona",
      features: "Funciones",
      pricing: "Precios",
      openApp: "Abrir app",
      signIn: "Iniciar sesión",
      getStarted: "Empezar",
    },
    hero: {
      badge: "Hecho para estudiantes e investigadores",
      titleLine1: "Todo tu semestre,",
      titleLine2: "organizado.",
      subtitle:
        "Describe tus clases en una frase y StudyOS prepara los paneles, planificadores y seguimientos que necesitas — ya rellenados. Sin plantillas, sin páginas en blanco.",
      ctaGenerate: "Generar mi espacio de trabajo",
      ctaDemo: "Ver una demo",
      finePrint: "Empieza gratis · Sin tarjeta de crédito · Listo en segundos",
    },
    builtFor: {
      label: "Diseñado para",
      items: [
        "Informática",
        "Premedicina",
        "Derecho",
        "MBA",
        "Bachillerato",
        "Posgrado",
      ],
    },
    how: {
      title: "De una frase a un espacio de trabajo completo.",
      subtitle: "Tres pasos, unos diez segundos.",
      steps: [
        {
          title: "Describe tus clases",
          body: "Una frase — “Estudio premedicina y curso Anatomía, Bioquímica y Fisiología.”",
        },
        {
          title: "Consigue un espacio de trabajo completo",
          body: "Asignaturas, un tablero de tareas, un planificador y una lista de lecturas — ya preparados y rellenados.",
        },
        {
          title: "Estudia y ajusta",
          body: "Edita lo que quieras, marca tareas, pide cambios en lenguaje natural. Todo se guarda solo.",
        },
      ],
    },
    features: {
      title: "Todo lo que un semestre necesita.",
      subtitle: "Generado para ti en un solo paso — y luego tuyo para darle forma.",
      items: {
        generate: {
          k: "Generar",
          title: "Espacios de trabajo, hechos para ti",
          body: "Una instrucción se convierte en un espacio de trabajo completo adaptado a tus asignaturas exactas.",
        },
        databases: {
          k: "Bases de datos",
          title: "Datos reales y estructurados",
          body: "Tareas, notas y lecturas como tablas con campos personalizados — no apuntes sueltos.",
        },
        calendar: {
          k: "Calendario",
          title: "Planificador y calendario",
          body: "Cada fecha de entrega en un solo lugar. Cambia entre tabla, tablero y calendario con un clic.",
        },
        dashboard: {
          k: "Panel",
          title: "Una base clara",
          body: "Una página que reúne toda tu semana para que siempre sepas qué viene a continuación.",
        },
        autosave: {
          k: "Autoguardado",
          title: "Edita, guardado al instante",
          body: "Renombra, marca, añade filas — cada cambio se guarda solo en el momento en que lo haces.",
        },
        assistant: {
          k: "Asistente",
          title: "Pide en lenguaje natural",
          body: "“Añade un parcial a Informática.” Tu espacio de trabajo se actualiza solo, delante de ti.",
        },
      },
    },
    pricing: {
      title: "Precios sencillos y pensados para estudiantes.",
      subtitle: "Empieza gratis. Mejora solo cuando quieras más.",
      perMonth: "/mes",
      free: {
        name: "Gratis",
        price: "$0",
        features: [
          "Genera espacios de trabajo con IA",
          "Edita y autoguarda todo",
          "Paneles, bases de datos, calendario",
          "Pide cambios en lenguaje natural",
        ],
        cta: "Empezar",
      },
      pro: {
        badge: "El más popular",
        name: "Pro",
        price: "$5",
        features: [
          "Todo lo de Gratis",
          "Generaciones ilimitadas",
          "El modelo más inteligente y detallado",
          "Soporte prioritario",
        ],
        cta: "Empieza gratis, mejora cuando quieras",
      },
    },
    closing: {
      titleLine1: "Deja de configurar.",
      titleLine2: "Empieza a estudiar.",
      subtitle: "Tu primer espacio de trabajo está a una frase de distancia.",
      cta: "Generar mi espacio de trabajo",
    },
    footer: {
      tagline: "El espacio de estudio para estudiantes · © 2026",
    },
    // The little workspace mockup in the hero.
    preview: {
      name: "Central de Estudio de Informática",
      thisWeek: "Esta semana",
      columns: { todo: "Por hacer", doing: "En curso", done: "Hecho" },
      cards: ["Test de Demostraciones", "Práctica de Listas Enlazadas", "Informe de Práctica 2"],
      coursesLabel: "Asignaturas",
      courses: ["Estructuras de Datos", "Matemática Discreta", "Física I"],
    },
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "Gestionar",
    upgrade: "Mejorar a Pro",
    generate: "Generar",
    upgradedBanner: "Tienes Pro — tus espacios de trabajo ahora usan el modelo más inteligente.",
    title: "Tus espacios de trabajo",
    subtitle: "Todo lo que StudyOS ha creado para ti.",
    total: "{count} en total",
    emptyTitle: "Aún no hay espacios de trabajo",
    emptySubtitle: "Genera uno o carga la demo para echar un vistazo.",
    emptyGenerate: "Generar un espacio de trabajo",
    loadDemo: "Cargar demo",
    updatedAt: "actualizado {date}",
    fallbackIcon: "📄",
  },

  // ---- Generate flow (/generate) ----------------------------------------
  generate: {
    backToWorkspaces: "Tus espacios de trabajo →",
    examples: [
      { emoji: "💻", text: "Soy estudiante de 1.º de Informática y curso 5 asignaturas" },
      {
        emoji: "⚕️",
        text: "Estudiante de 2.º de premedicina: Anatomía, Bioquímica, Fisiología, Química Orgánica",
      },
      { emoji: "🎓", text: "Estudiante de 1.º de bachillerato preparando 6 asignaturas para los exámenes finales" },
      {
        emoji: "📈",
        text: "Estudiante de MBA que cursa Microeconomía, Contabilidad y Marketing",
      },
    ],
    planSteps: [
      "Leyendo tu descripción",
      "Pensando buenas preguntas",
      "Adaptando tu configuración",
    ],
    buildSteps: [
      "Planificando tus asignaturas",
      "Diseñando tu panel",
      "Organizando tu planificador",
      "Montando el espacio de trabajo",
    ],
    planningTitle: "Conociéndote",
    buildingTitle: "Construyendo tu espacio de trabajo",
    errorGeneric: "Algo salió mal. Inténtalo de nuevo.",
    errorBuild: "Algo salió mal al generar tu espacio de trabajo. Inténtalo de nuevo.",
    describe: {
      step: "Paso 1 de 2",
      title: "¿Qué estás estudiando?",
      subtitle:
        "Describe tus asignaturas y objetivos en lenguaje natural. StudyOS hace un par de preguntas rápidas y luego diseña todo el espacio de trabajo en torno a tus respuestas.",
      placeholder:
        "p. ej. Soy estudiante de 1.º de Informática y este semestre curso Estructuras de Datos, Matemática Discreta, Cálculo II y Escritura Académica.",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "Continuar",
      examplesLabel: "¿No sabes por dónde empezar? Parte de un ejemplo",
      finePrint: "Gratis · sin tarjeta de crédito · listo en segundos",
    },
    questions: {
      back: "← Editar descripción",
      step: "Paso 2 de 2",
      title: "Vamos a adaptarlo",
      designingFor: "Diseñando para:",
      pickAny: "elige las que quieras",
      pickOne: "elige una",
      build: "Construir mi espacio de trabajo",
      answeredNone: "Responde algunas, o simplemente constrúyelo — tú decides",
      answeredCount: "{n} / {total} respondidas",
    },
  },

  // ---- AI activity overlay ----------------------------------------------
  aiActivity: {
    defaultTitle: "Trabajando en ello",
    defaultSteps: [
      "Leyendo tu espacio de trabajo",
      "Planificando los cambios",
      "Diseñando la disposición",
      "Escribiéndolo",
    ],
    updatingTitle: "Actualizando tu espacio de trabajo",
  },

  // ---- Workspace editor --------------------------------------------------
  editor: {
    newPage: "Nueva página",
    untitled: "Sin título",
    allWorkspaces: "← Todos los espacios de trabajo",
    deletePage: "Eliminar página",
    askAi: "Preguntar a la IA",
    aiPlaceholder:
      "Pide a la IA que cambie este espacio de trabajo — “añade un parcial a Informática”, “crea un plan de estudio para los finales”, “añade un seguimiento de hábitos”…",
    aiWorking: "Trabajando…",
    aiApply: "Aplicar",
    aiClose: "Cerrar",
    aiError: "No se pudo aplicar — prueba a reformular o simplificar la petición.",
    saving: "Guardando…",
    saveFailed: "Error al guardar",
    saved: "Guardado",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    addBlock: "+ Añadir bloque",
    cancel: "Cancelar",
    deleteBlock: "Eliminar bloque",
    blockTypes: {
      paragraph: "Texto",
      heading: "Encabezado",
      todo: "Tarea",
      bulleted_list_item: "Lista",
      callout: "Aviso",
      divider: "Separador",
      database: "Tabla",
    },
    placeholders: {
      paragraph: "Escribe algo…",
      todo: "Tarea",
      listItem: "Elemento de lista",
      callout: "Aviso",
    },
    headingDefault: "Encabezado",
    // Defaults for a brand-new table inserted via "+ Add block → Table".
    newTable: {
      name: "Nueva tabla",
      propName: "Nombre",
      propStatus: "Estado",
      propDue: "Fecha de entrega",
      statusTodo: "Por hacer",
      statusInProgress: "En curso",
      statusDone: "Hecho",
      viewTable: "Tabla",
    },
  },

  // ---- Database views (table / board / calendar) ------------------------
  db: {
    nameAria: "Nombre de la base de datos",
    newRow: "+ Nueva fila",
    newCard: "+ Nueva",
    untitled: "Sin título",
    empty: "—",
    link: "Enlazar ↗",
    linked: "{count} enlazadas",
    deleteRow: "Eliminar fila",
    deleteCard: "Eliminar tarjeta",
    dragHint: "Arrastra a otra columna",
    prevMonth: "Mes anterior",
    nextMonth: "Mes siguiente",
    addOnDay: "Añadir en este día",
    clickToRename: "Haz clic para renombrar",
    delete: "Eliminar",
  },

  // ---- Default onboarding questions (no-API-key fallback) ----------------
  onboarding: {
    level: {
      question: "¿Cuál es tu nivel de estudios?",
      options: {
        hs: "Bachillerato",
        ug: "Grado",
        grad: "Posgrado / Máster",
        self: "Autodidacta",
      },
    },
    load: {
      question: "¿Cuántas asignaturas llevas a la vez?",
      // 1–2, 3–4, 5–6, 7+ stay numeric across locales (see onboarding.ts).
    },
    track: {
      question: "¿Qué es lo que más quieres controlar?",
      options: {
        assign: "Tareas",
        exams: "Exámenes",
        read: "Lecturas",
        notes: "Apuntes",
        habits: "Hábitos de estudio",
        grades: "Notas",
      },
    },
    style: {
      question: "¿Cómo te gusta planificar?",
      options: {
        cal: "Por calendario",
        board: "Por tablero",
        list: "Listas sencillas",
      },
    },
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  // The fixed labels the rule-based generator emits so the offline experience
  // is localized too. Course names derive from the user's own prompt.
  mock: {
    workspaceName: "Central de Estudio",
    workspaceNameField: "Central de Estudio de {field}",
    welcome:
      "Generado a partir de tu descripción: “{summary}”. Todo lo que hay aquí es un punto de partida que puedes editar.",
    tbd: "Por definir",
    status: { notStarted: "Sin empezar", inProgress: "En curso", done: "Hecho" },
    type: { homework: "Deberes", quiz: "Test", exam: "Examen", project: "Proyecto" },
    exam: { midterm: "Parcial", final: "Final" },
    courses: {
      name: "Asignaturas",
      description: "Todas las clases que cursas este cuatrimestre.",
      propCourse: "Asignatura",
      propCode: "Código",
      propInstructor: "Profesor",
      propCredits: "Créditos",
      propSchedule: "Horario",
      viewAll: "Todas las asignaturas",
    },
    assignments: {
      name: "Tareas",
      description: "Deberes, tests, proyectos y exámenes.",
      propName: "Tarea",
      propCourse: "Asignatura",
      propType: "Tipo",
      propStatus: "Estado",
      propDue: "Fecha de entrega",
      propWeight: "Peso %",
      viewAll: "Todas",
      viewBoard: "Por estado",
      viewCalendar: "Calendario",
      projectMilestone: "Hito del proyecto {n} — {code}",
    },
    readings: {
      name: "Lista de Lecturas",
      description: "Qué leer, organizado por asignatura.",
      propTitle: "Título",
      propCourse: "Asignatura",
      propRead: "Leído",
      propLink: "Enlace",
      viewAll: "Lista de lecturas",
      coreReading: "{course}: lectura esencial",
    },
    habits: {
      name: "Hábitos de Estudio",
      description: "Un seguimiento semanal ligero de la constancia.",
      propHabit: "Hábito",
      propDate: "Fecha",
      propDone: "Hecho",
      propMinutes: "Minutos",
      viewAll: "Todos los hábitos",
      viewCalendar: "Calendario",
      reviewNotes: "Repasar los apuntes de hoy",
      practiceRecall: "Practicar el recuerdo activo",
    },
    grades: {
      name: "Seguimiento de Notas",
      description: "Calificaciones y pesos editables para cada asignatura.",
      propItem: "Evaluación",
      propCourse: "Asignatura",
      propScore: "Calificación",
      propOutOf: "Sobre",
      propWeight: "Peso %",
      viewAll: "Todas las notas",
      assessmentN: "Evaluación {n}",
    },
    pages: {
      dashboard: "Panel",
      courses: "Asignaturas",
      assignments: "Tareas",
      planner: "Planificador",
      readings: "Lista de Lecturas",
      exams: "Preparación de Exámenes",
      notes: "Apuntes",
      habits: "Hábitos de Estudio",
      grades: "Seguimiento de Notas",
    },
    dashboard: {
      assignmentsHeading: "📌 Tareas por estado",
      coursesHeading: "📚 Mis asignaturas",
    },
    assignmentsPage: { intro: "Todo lo que tienes pendiente, con fechas de entrega y pesos." },
    plannerPage: { intro: "Tus fechas de entrega organizadas en un calendario." },
    examsPage: {
      callout:
        "Confirma las fechas y luego divide cada examen en temas de repaso y sesiones de práctica.",
    },
    notesPage: {
      heading: "Apuntes de la Asignatura",
      callout:
        "Añade un encabezado para cada clase y luego captura debajo las ideas clave y las preguntas.",
      fallbackCourse: "Asignatura",
      startWriting: "Empieza a escribir aquí…",
    },
    gradesPage: {
      callout:
        "Sustituye las evaluaciones de ejemplo por los pesos de tu programa y tus resultados reales.",
    },
    // Workspace component plan (labels + descriptions shown in the loader).
    plan: {
      summaryWith: "Un espacio de trabajo a medida creado en torno a {focus}.",
      summaryGeneric:
        "Un espacio de trabajo a medida para asignaturas, fechas de entrega y planificación del estudio.",
      components: {
        dashboard: {
          label: "Panel",
          description: "Tu semestre, tus prioridades y tus próximas fechas de entrega.",
        },
        courses: {
          label: "Asignaturas",
          description: "Detalles de las asignaturas, horarios y profesores.",
        },
        assignments: {
          label: "Tareas",
          description: "Trabajo del curso, fechas de entrega, pesos y estado.",
        },
        planner: {
          label: "Planificador",
          description: "Una vista de calendario del trabajo que tienes por delante.",
        },
        readings: {
          label: "Lista de Lecturas",
          description: "Textos asignados y progreso de lectura.",
        },
        exams: {
          label: "Preparación de Exámenes",
          description: "Fechas de examen, temas y tareas de repaso.",
        },
        notes: {
          label: "Apuntes",
          description: "Un hogar estructurado para los apuntes de las asignaturas.",
        },
        habits: {
          label: "Hábitos de Estudio",
          description: "Rutinas de estudio diarias y constancia.",
        },
        grades: {
          label: "Seguimiento de Notas",
          description: "Calificaciones, pesos y objetivos de nota.",
        },
        projects: {
          label: "Proyectos",
          description: "Hitos y próximas acciones para los trabajos más grandes.",
        },
      },
    },
  },
} satisfies Dictionary;
