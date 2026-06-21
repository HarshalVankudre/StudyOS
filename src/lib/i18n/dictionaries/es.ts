import type { Dictionary } from "./en";
// Español (es-ES) — traducción del diccionario canónico en inglés.
export const es = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — Tu espacio de estudio, creado por IA",
    homeDescription:
      "Describe tus asignaturas y fechas de entrega, y StudyOS construye al instante tus paneles, planificadores y seguimientos de tareas. El espacio de estudio con IA para estudiantes.",
    appTitle: "Tus espacios de trabajo · StudyOS",
    generateTitle: "Genera tu espacio de trabajo · StudyOS",
    pricingTitle: "Precios · StudyOS",
    pricingDescription:
      "Compara StudyOS Gratis y Pro. Empieza gratis y mejora cuando quieras el modelo más potente, generaciones ilimitadas y soporte prioritario.",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Idioma",
    choose: "Elige idioma",
  },

  // ---- Shared bits used on more than one surface ------------------------
  common: {
    openApp: "Abrir app",
    signIn: "Iniciar sesión",
    getStarted: "Empezar",
    cancel: "Cancelar",
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
    preview: {
      name: "Central de Estudio de Informática",
      thisWeek: "Esta semana",
      columns: { todo: "Por hacer", doing: "En curso", done: "Hecho" },
      cards: ["Test de Demostraciones", "Práctica de Listas Enlazadas", "Informe de Práctica 2"],
      coursesLabel: "Asignaturas",
      courses: ["Estructuras de Datos", "Matemática Discreta", "Física I"],
    },
  },

  // ---- Pricing page (/pricing) ------------------------------------------
  pricing: {
    nav: { openApp: "Abrir app", signIn: "Iniciar sesión", getStarted: "Empezar" },
    badge: "Precios sencillos y pensados para estudiantes",
    title: "Empieza gratis. Mejora cuando estés listo.",
    subtitle:
      "Todo lo que necesitas para organizar tu semestre es gratis. Pro añade el modelo más potente, generaciones ilimitadas y soporte prioritario.",
    free: {
      name: "Gratis",
      price: "$0",
      tagline: "Todo para organizarte.",
      bullets: [
        "Espacios de trabajo de estudio generados por IA",
        "Edición en línea completa y autoguardado",
        "Bases de datos — tabla, tablero y calendario",
        "Chat con agente de IA en tu espacio de trabajo",
      ],
      ctaSignedOut: "Empieza gratis",
      ctaSignedIn: "Abre tus espacios de trabajo",
      bulletCredits: "{count} créditos de IA de inicio",
    },
    pro: {
      badge: "El más popular",
      name: "Pro",
      price: "$5",
      perMonth: "/mes",
      billed: "Facturación mensual · cancela cuando quieras.",
      bullets: [
        "Todo lo de Gratis",
        "Generaciones de espacios de trabajo ilimitadas",
        "El modelo más potente y detallado",
        "Soporte prioritario y acceso anticipado",
      ],
      currentPlan: "✦ Tu plan actual",
      manageBilling: "Gestionar facturación",
      upgrade: "Mejorar a Pro",
      ctaSignedOut: "Empieza con Pro",
      bulletCredits: "{count} créditos de IA incluidos",
    },
    comparison: {
      title: "Compara planes",
      featuresHeader: "Funciones",
      freeHeader: "Gratis",
      proHeader: "Pro",
      included: "Incluido",
      notIncluded: "No incluido",
      features: {
        aiWorkspaces: "Espacios de trabajo generados por IA",
        onboarding: "Preguntas guiadas de incorporación",
        editing: "Edición en línea completa y autoguardado",
        databases: "Bases de datos — tabla, tablero y calendario",
        dragDrop: "Edición con arrastrar y soltar",
        agentChat: "Chat con agente de IA que edita tu espacio de trabajo",
        model: "Modelo de generación",
        generations: "Generaciones de espacios de trabajo",
        support: "Soporte",
        earlyAccess: "Acceso anticipado a nuevas funciones",
        credits: "Créditos de IA incluidos",
        buyMore: "Compra más créditos cuando quieras",
      },
      values: {
        standard: "Estándar",
        mostCapable: "El más potente",
        generous: "Generoso",
        unlimited: "Ilimitadas",
        community: "Comunidad",
        priority: "Prioritario",
      },
    },
    credits: {
      heading: "La IA funciona con créditos",
      intro:
        "Cada solicitud de IA gasta créditos según lo que hace — un ajuste rápido cuesta poco, construir un espacio de trabajo completo cuesta más. Pro viene cargado de créditos y puedes recargar cuando quieras.",
      freeIncludes: "Gratis incluye {count} créditos de inicio",
      proIncludes: "Pro incluye {count} créditos",
      neverExpire: "Recarga cuando quieras — los créditos nunca caducan",
      balance: "Tu saldo: {count} créditos",
      pack: "Paquete de créditos",
      unit: "créditos",
      buy: "Comprar {count} créditos",
      signUpToBuy: "Regístrate para comprar créditos",
      oneTime: "Compra única · pago seguro",
    },
    faqTitle: "Preguntas",
    faq: [
      {
        q: "¿StudyOS es realmente gratis para empezar?",
        a: "Sí. Crea una cuenta y genera, edita y usa tus espacios de trabajo con el plan Gratis — sin tarjeta de crédito.",
      },
      {
        q: "¿Qué consigo con Pro?",
        a: "Generaciones ilimitadas, el modelo más potente para espacios de trabajo más ricos y precisos, soporte prioritario y acceso anticipado a nuevas funciones.",
      },
      {
        q: "¿Puedo cancelar cuando quiera?",
        a: "Cuando quieras. Gestiona o cancela tu suscripción desde el portal de facturación — conservas Pro hasta el final del periodo.",
      },
      {
        q: "¿Qué pasa con mis espacios de trabajo si bajo de plan?",
        a: "No se borra nada. Tus espacios de trabajo se mantienen tal cual y siguen siendo totalmente editables en Gratis.",
      },
    ],
    ctaTitle: "Tu primer espacio de trabajo está a una frase de distancia.",
    ctaSubtitle: "Prueba StudyOS gratis — mejora solo si quieres más.",
    ctaSignedIn: "Generar un espacio de trabajo",
    ctaSignedOut: "Empieza gratis",
    footerTagline: "El espacio de estudio para estudiantes · © 2026",
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
    planningTitle: "Conociéndote",
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
      other: "Otro",
      otherPlaceholder: "Escribe tu propia preferencia…",
      otherAria: "Otra respuesta para {question}",
    },
  },

  // ---- Generation activity (full-screen build progress) -----------------
  genActivity: {
    building: "Construyendo tu espacio de trabajo",
    designing: "Diseñando tu espacio de trabajo",
    componentsChosen: "Componentes elegidos para ti",
    planningComponents: "Planificando componentes",
    onlyRelevant: "Solo las páginas y seguimientos relevantes para tus respuestas.",
    componentsCount: "{count} componentes",
    everythingEditable:
      "Todo lo generado sigue siendo editable — páginas, campos, vistas, filas y contenido.",
    statusReady: "Listo",
    statusGenerating: "Generando…",
    statusQueued: "En cola",
    finishingUp: "Ultimando detalles",
    yourWorkspace: "Tu espacio de trabajo",
    pagesLabel: "Páginas",
    sectionsBuilt: "{built} de {total} secciones creadas",
    choosingPieces: "Eligiendo las piezas adecuadas para ti…",
    stillEditable: "Todo sigue siendo editable cuando esté listo",
    writingItIn: "Escribiéndolo…",
    board: { todo: "Por hacer", doing: "En curso", done: "Hecho" },
    phase: {
      analyzing: "Analizando tus respuestas",
      planning: "Seleccionando componentes",
      generating: "Generando espacio de trabajo",
      validating: "Validando datos",
      saving: "Guardando",
    },
  },

  // ---- AiActivity overlay (calm spinner used during planning) -----------
  aiActivity: {
    defaultTitle: "Trabajando en ello",
    defaultSteps: [
      "Leyendo tu espacio de trabajo",
      "Planificando los cambios",
      "Diseñando la disposición",
      "Escribiéndolo",
    ],
  },

  // ---- Workspace editor chrome ------------------------------------------
  editor: {
    workspaceIcon: "Icono del espacio de trabajo",
    newPage: "Nueva página",
    untitled: "Sin título",
    allWorkspaces: "← Todos los espacios de trabajo",
    deletePage: "Eliminar página",
    askAi: "Preguntar a la IA",
    closeAgent: "Cerrar agente",
    saving: "Guardando…",
    saveFailed: "Error al guardar",
    saved: "Guardado",
  },

  // ---- In-workspace AI agent chat ---------------------------------------
  agentChat: {
    title: "Agente de IA",
    subtitleIdle: "Entiende todo tu espacio de trabajo",
    closeChat: "Cerrar chat",
    suggestions: [
      "Añade un seguimiento de hábitos",
      "Crea un plan de estudio de 2 semanas para los finales",
      "Añade un parcial a cada asignatura",
      "¿En qué debería centrarme esta semana?",
    ],
    intro:
      "Pídeme que cambie un elemento o que coordine actualizaciones en todo tu espacio de trabajo. Si algo no está claro, preguntaré antes de editar.",
    workspaceUpdated: "Espacio de trabajo actualizado",
    undo: "Deshacer",
    undoing: "Deshaciendo…",
    undone: "Cambio deshecho",
    undoFailed: "Este cambio no se puede deshacer porque el espacio de trabajo cambió.",
    buildingUpdate: "Preparando tu actualización",
    thinking: "Pensando…",
    stopTask: "Detener tarea",
    stopping: "Deteniendo…",
    taskStopped: "Tarea detenida.",
    stopFailed: "No se pudo detener la tarea. Es posible que siga ejecutándose.",
    steps: {
      inspect: "Inspeccionar espacio de trabajo",
      decide: "Decidir la acción más segura",
      prepare: "Preparar actualización coordinada",
    },
    phase: {
      inspecting: "Revisando tu espacio de trabajo",
      planning: "Planificando el cambio más seguro",
      updating: "Coordinando actualizaciones del espacio de trabajo",
      validating: "Comprobando cada conexión",
      saving: "Guardando tus cambios",
    },
    areaStatus: { queued: "En cola", working: "Actualizando", complete: "Listo" },
    initialMessage: "Abriendo tu espacio de trabajo",
    placeholderBusy: "El agente está trabajando…",
    placeholderIdle: "Pide al agente que construya o cambie algo…",
    send: "Enviar",
    inputHint: "Enter para enviar · Mayús+Enter para una nueva línea",
    errorRequestFailed: "La solicitud al agente falló",
    errorEndedUnexpectedly: "La respuesta del agente terminó inesperadamente",
    errorSnag: "El agente tuvo un problema. Inténtalo de nuevo.",
    errorCouldntComplete:
      "No pude completar eso de forma segura. Inténtalo de nuevo o haz la petición más específica.",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    pageIcon: "Icono de página",
    headingLevel: "Nivel de encabezado",
    calloutIcon: "Icono de aviso",
    addBlock: "+ Añadir bloque",
    deleteBlock: "Eliminar bloque",
    blockTypes: {
      paragraph: "Texto",
      heading: "Encabezado",
      todo: "Tarea",
      bulleted_list_item: "Lista",
      numbered_list_item: "Numerada",
      quote: "Cita",
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
    databaseIcon: "Icono de base de datos",
    nameAria: "Nombre de la base de datos",
    newRow: "+ Nueva fila",
    newCard: "+ Nueva",
    untitled: "Sin título",
    empty: "—",
    deleteRow: "Eliminar fila",
    deleteCard: "Eliminar tarjeta",
    dragHint: "Arrastra a otra columna",
    prevMonth: "Mes anterior",
    nextMonth: "Mes siguiente",
    addOnDay: "Añadir en este día",
    clickToRename: "Haz clic para renombrar",
    delete: "Eliminar",
  },

  // ---- Database settings panel ------------------------------------------
  dbSettings: {
    customize: "Personalizar campos y vistas",
    description: "Descripción",
    descriptionPlaceholder: "Para qué sirve este seguimiento",
    fields: "Campos",
    addField: "+ Añadir campo",
    fieldName: "Nombre del campo",
    fieldType: "Tipo de campo",
    deleteField: "Eliminar campo",
    newField: "Nuevo campo",
    chooseRelatedDatabase: "Elige la base de datos relacionada",
    optionLabel: "Etiqueta de opción",
    addOption: "+ opción",
    newOption: "Nueva opción",
    views: "Vistas",
    addView: "+ Añadir vista",
    viewName: "Nombre de la vista",
    newView: "Nueva vista",
    deleteView: "Eliminar vista",
    groupBy: "Agrupar por…",
    dateField: "Campo de fecha…",
    deleteDatabase: "Eliminar esta base de datos",
    deleteConfirm: "¿Eliminar “{name}” y quitarla de todas las páginas?",
    propertyTypes: {
      text: "Texto",
      number: "Número",
      checkbox: "Casilla",
      date: "Fecha",
      select: "Selección",
      multi_select: "Selección múltiple",
      status: "Estado",
      url: "URL",
      relation: "Relación",
    },
    viewTypes: {
      table: "Tabla",
      board: "Tablero",
      calendar: "Calendario",
      list: "Lista",
      gallery: "Galería",
    },
    defaults: {
      statusTodo: "Por hacer",
      statusInProgress: "En curso",
      statusDone: "Hecho",
      option1: "Opción 1",
      option2: "Opción 2",
    },
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
    load: { question: "¿Cuántas asignaturas llevas a la vez?" },
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
      options: { cal: "Por calendario", board: "Por tablero", list: "Listas sencillas" },
    },
  },

  // ---- Server-emitted AI progress + errors ------------------------------
  ai: {
    generate: {
      phase: {
        analyzing: "Leyendo tus asignaturas, objetivos y preferencias",
        planning: "Eligiendo los componentes adecuados del espacio de trabajo",
        generating: "Generando tu espacio de trabajo completo de una sola vez",
        validating: "Comprobando enlaces, vistas, campos y datos iniciales",
        saving: "Guardando tu espacio de trabajo editable",
      },
      error:
        "No se pudo generar el espacio de trabajo. Inténtalo de nuevo con una descripción más corta.",
      detail: {
        dashboard: "{count} páginas editables conectadas",
        courses: "{count} asignaturas añadidas",
        trackedItems: "{count} elementos de seguimiento añadidos",
        scheduled: "{count} elementos programados",
        readings: "{count} lecturas añadidas",
        habits: "{count} rutinas añadidas",
        grades: "{count} filas de notas añadidas",
        notes: "Estructura de apuntes editable creada",
        generic: "Componente creado y conectado",
      },
    },
    agent: {
      inspecting: "Revisando {pages} páginas y {databases} bases de datos",
      inspectingArea: "Revisando {area}",
      planning: "Entendiendo la petición y comprobando ambigüedades",
      updating: "Aplicando cambios coordinados en tu espacio de trabajo",
      validating: "Comprobando referencias, vistas, campos y datos enlazados",
      saving: "Guardando el espacio de trabajo actualizado",
      workspaceNotFound: "Espacio de trabajo no encontrado.",
      workspaceChanged: "Tu espacio de trabajo cambió mientras trabajaba. Inténtalo de nuevo.",
      undoUnavailable: "Este cambio no se puede deshacer porque el espacio de trabajo tiene ediciones más recientes.",
      error:
        "El agente no pudo terminar esa petición de forma segura. Inténtalo de nuevo o haz la petición más específica.",
      fallbackReply: "Actualicé tu espacio de trabajo.",
    },
    errors: {
      notAuthenticated: "Sin autenticar",
      invalidAgentRequest: "Solicitud al agente no válida",
      describeBeforeGenerating:
        "Describe tus estudios antes de generar un espacio de trabajo.",
    },
  },

  // ---- Credits ----------------------------------------------------------
  credits: {
    label: "Créditos de IA",
    amount: "{count} créditos",
    buy: "Comprar créditos",
    metaTitle: "Comprar créditos · StudyOS",
    pageIntro:
      "Los créditos impulsan cada solicitud de IA — generar espacios de trabajo y chatear con el agente. Recarga cuando quieras; los créditos nunca caducan.",
    oneTimeExpire: "Compra única · pago seguro · los créditos nunca caducan",
    wantMore: "¿Quieres el modelo más potente y créditos incluidos?",
    spentOn: "Se gastan en generaciones de IA y ediciones del agente.",
    addedBanner: "Se añadieron {added} créditos — ahora tienes {total}.",
    outGenerate:
      "Te has quedado sin créditos de IA. Añade más desde la página de Precios para seguir generando.",
    outAgent:
      "Te has quedado sin créditos de IA. Añade más desde la página de Precios para seguir usando el agente.",
  },

  // ---- Account menu -----------------------------------------------------
  account: {
    pro: "Pro",
    free: "Gratis",
    fallbackName: "Cuenta",
    viewProfile: "Ver perfil",
    manageProfile: "Gestionar perfil",
    subscriptionPayments: "Suscripción y pagos",
    buyCredits: "Comprar créditos",
    settings: "Ajustes",
    signOut: "Cerrar sesión",
    manageAccount: "Gestionar cuenta",
    creditsAndPlan: "{credits} créditos · {plan}",
  },

  // ---- Account settings page --------------------------------------------
  settings: {
    metaTitle: "Ajustes de la cuenta · StudyOS",
    back: "← Espacios de trabajo",
    title: "Ajustes de la cuenta",
    subtitle: "Gestiona tu perfil, tu plan, tus pagos y tus créditos.",
    profile: "Perfil",
    yourAccount: "Tu cuenta",
    subscription: "Suscripción",
    proDesc:
      "Tienes Pro — el modelo más potente y soporte prioritario. Gestiona tu suscripción, tus métodos de pago y tus facturas a continuación.",
    freeDesc:
      "Estás en el plan Gratis. Mejora a Pro para conseguir el modelo más potente, créditos incluidos y soporte prioritario.",
    manageSubscription: "Gestionar suscripción y pagos",
    upgrade: "Mejorar a Pro",
    comparePlans: "Comparar planes",
    creditsDesc:
      "Los créditos impulsan cada solicitud de IA. Recarga cuando quieras — los créditos nunca caducan.",
    buyPack: "Comprar {count} créditos · ${price}",
    viewPricing: "Ver precios",
    signOut: "Cerrar sesión",
  },

  // ---- Workspace card (delete control) ----------------------------------
  workspaceCard: {
    delete: "Eliminar espacio de trabajo",
    deleteAria: "Eliminar {name}",
    deleteConfirm:
      "¿Eliminar “{name}”?\n\nEsto elimina permanentemente el espacio de trabajo y todo lo que contiene. No se puede deshacer.",
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
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
      },
    },
  },
} satisfies Dictionary;
