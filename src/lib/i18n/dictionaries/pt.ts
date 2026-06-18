import type { Dictionary } from "./en";

/** Portuguese (pt-BR) — translation of the canonical English dictionary. */
export const pt = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — Seu espaço de estudos, criado por IA",
    homeDescription:
      "Descreva seus cursos e prazos, e o StudyOS monta na hora seus painéis, planejadores e controles de tarefas. O espaço de estudos com IA para estudantes.",
    appTitle: "Seus espaços de trabalho · StudyOS",
    generateTitle: "Crie seu espaço de trabalho · StudyOS",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Idioma",
    choose: "Escolher idioma",
  },

  // ---- Landing page ------------------------------------------------------
  landing: {
    nav: {
      howItWorks: "Como funciona",
      features: "Recursos",
      pricing: "Preços",
      openApp: "Abrir app",
      signIn: "Entrar",
      getStarted: "Começar",
    },
    hero: {
      badge: "Feito para estudantes e pesquisadores",
      titleLine1: "Seu semestre inteiro,",
      titleLine2: "organizado.",
      subtitle:
        "Descreva suas aulas em uma frase e o StudyOS monta os painéis, planejadores e controles de que você precisa — já preenchidos. Sem modelos, sem páginas em branco.",
      ctaGenerate: "Criar meu espaço de trabalho",
      ctaDemo: "Ver uma demonstração",
      finePrint: "Comece grátis · Sem cartão de crédito · Pronto em segundos",
    },
    builtFor: {
      label: "Feito para",
      items: [
        "Ciência da Computação",
        "Pré-medicina",
        "Direito",
        "MBA",
        "Ensino médio",
        "Pós-graduação",
      ],
    },
    how: {
      title: "De uma frase a um espaço de trabalho completo.",
      subtitle: "Três passos, cerca de dez segundos.",
      steps: [
        {
          title: "Descreva suas aulas",
          body: "Uma frase — “Sou de pré-medicina, cursando Anatomia, Bioquímica e Fisiologia.”",
        },
        {
          title: "Receba um espaço completo",
          body: "Cursos, um quadro de tarefas, um planejador e uma lista de leituras — já configurados e preenchidos.",
        },
        {
          title: "Estude e ajuste",
          body: "Edite qualquer coisa, marque tarefas, peça mudanças em linguagem simples. Tudo salva automaticamente.",
        },
      ],
    },
    features: {
      title: "Tudo o que um semestre precisa.",
      subtitle: "Gerado para você em um passo — e depois é seu para moldar.",
      items: {
        generate: {
          k: "Gerar",
          title: "Espaços de trabalho feitos para você",
          body: "Um comando vira um espaço de trabalho completo, sob medida para os seus cursos.",
        },
        databases: {
          k: "Bancos de dados",
          title: "Dados reais e estruturados",
          body: "Tarefas, notas e leituras como tabelas com campos personalizados — não anotações soltas.",
        },
        calendar: {
          k: "Calendário",
          title: "Planejador e calendário",
          body: "Todos os prazos em um só lugar. Alterne entre tabela, quadro e calendário com um clique.",
        },
        dashboard: {
          k: "Painel",
          title: "Uma base clara",
          body: "Uma página que reúne toda a sua semana para você sempre saber o que vem a seguir.",
        },
        autosave: {
          k: "Salvamento automático",
          title: "Edite, salvo na hora",
          body: "Renomeie, marque, adicione linhas — cada mudança se salva no momento em que você a faz.",
        },
        assistant: {
          k: "Assistente",
          title: "Peça em linguagem simples",
          body: "“Adicione uma prova intermediária em CC.” Seu espaço de trabalho se atualiza diante dos seus olhos.",
        },
      },
    },
    pricing: {
      title: "Preços simples e acessíveis para estudantes.",
      subtitle: "Comece grátis. Faça upgrade só quando quiser mais.",
      perMonth: "/mês",
      free: {
        name: "Grátis",
        price: "$0",
        features: [
          "Gerar espaços de trabalho com IA",
          "Editar e salvar tudo automaticamente",
          "Painéis, bancos de dados, calendário",
          "Pedir edições em linguagem simples",
        ],
        cta: "Começar",
      },
      pro: {
        badge: "Mais popular",
        name: "Pro",
        price: "$5",
        features: [
          "Tudo do plano Grátis",
          "Gerações ilimitadas",
          "O modelo mais inteligente e detalhado",
          "Suporte prioritário",
        ],
        cta: "Comece grátis, faça upgrade quando quiser",
      },
    },
    closing: {
      titleLine1: "Pare de configurar.",
      titleLine2: "Comece a estudar.",
      subtitle: "Seu primeiro espaço de trabalho está a uma frase de distância.",
      cta: "Criar meu espaço de trabalho",
    },
    footer: {
      tagline: "O espaço de estudos para estudantes · © 2026",
    },
    // The little workspace mockup in the hero.
    preview: {
      name: "Central de Estudos de CC",
      thisWeek: "Esta semana",
      columns: { todo: "A fazer", doing: "Fazendo", done: "Concluído" },
      cards: ["Quiz de Provas", "Lab de Lista Encadeada", "Relatório de Lab 2"],
      coursesLabel: "Cursos",
      courses: ["Estruturas de Dados", "Matemática Discreta", "Física I"],
    },
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "Gerenciar",
    upgrade: "Fazer upgrade para o Pro",
    generate: "Gerar",
    upgradedBanner: "Você está no Pro — seus espaços de trabalho agora usam o modelo mais inteligente.",
    title: "Seus espaços de trabalho",
    subtitle: "Tudo o que o StudyOS criou para você.",
    total: "{count} no total",
    emptyTitle: "Nenhum espaço de trabalho ainda",
    emptySubtitle: "Crie um ou carregue a demonstração para dar uma olhada.",
    emptyGenerate: "Criar um espaço de trabalho",
    loadDemo: "Carregar demonstração",
    updatedAt: "atualizado em {date}",
    fallbackIcon: "📄",
  },

  // ---- Generate flow (/generate) ----------------------------------------
  generate: {
    backToWorkspaces: "Seus espaços de trabalho →",
    examples: [
      { emoji: "💻", text: "Sou estudante de CC do 1º ano, cursando 5 disciplinas" },
      {
        emoji: "⚕️",
        text: "Pré-medicina, 2º ano: Anatomia, Bioquímica, Fisiologia, Química Orgânica",
      },
      { emoji: "🎓", text: "Estou no 2º ano do ensino médio, estudando 6 matérias para as provas finais" },
      {
        emoji: "📈",
        text: "Estudante de MBA cursando Microeconomia, Contabilidade e Marketing",
      },
    ],
    planSteps: [
      "Lendo sua descrição",
      "Pensando em boas perguntas",
      "Personalizando sua configuração",
    ],
    buildSteps: [
      "Planejando seus cursos",
      "Desenhando seu painel",
      "Organizando seu planejador",
      "Montando o espaço de trabalho",
    ],
    planningTitle: "Conhecendo você",
    buildingTitle: "Construindo seu espaço de trabalho",
    errorGeneric: "Algo deu errado. Tente novamente.",
    errorBuild: "Algo deu errado ao gerar seu espaço de trabalho. Tente novamente.",
    describe: {
      step: "Passo 1 de 2",
      title: "O que você está estudando?",
      subtitle:
        "Descreva seus cursos e objetivos em linguagem simples. O StudyOS faz algumas perguntas rápidas e depois projeta todo o espaço de trabalho com base nas suas respostas.",
      placeholder:
        "ex.: Sou estudante de CC do 1º ano, cursando Estruturas de Dados, Matemática Discreta, Cálculo II e Redação Acadêmica neste semestre.",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "Continuar",
      examplesLabel: "Não tem certeza? Comece a partir de um exemplo",
      finePrint: "Grátis · sem cartão de crédito · pronto em segundos",
    },
    questions: {
      back: "← Editar descrição",
      step: "Passo 2 de 2",
      title: "Vamos personalizar",
      designingFor: "Projetando para:",
      pickAny: "escolha quantas quiser",
      pickOne: "escolha uma",
      build: "Construir meu espaço de trabalho",
      answeredNone: "Responda algumas, ou apenas construa — você decide",
      answeredCount: "{n} / {total} respondidas",
    },
  },

  // ---- AI activity overlay ----------------------------------------------
  aiActivity: {
    defaultTitle: "Trabalhando nisso",
    defaultSteps: [
      "Lendo seu espaço de trabalho",
      "Planejando as mudanças",
      "Desenhando o layout",
      "Aplicando as alterações",
    ],
    updatingTitle: "Atualizando seu espaço de trabalho",
  },

  // ---- Workspace editor --------------------------------------------------
  editor: {
    newPage: "Nova página",
    untitled: "Sem título",
    allWorkspaces: "← Todos os espaços de trabalho",
    deletePage: "Excluir página",
    askAi: "Perguntar à IA",
    aiPlaceholder:
      "Peça à IA para mudar este espaço de trabalho — “adicione uma prova intermediária em CC”, “monte um plano de estudos para as provas finais”, “adicione um controle de hábitos”…",
    aiWorking: "Trabalhando…",
    aiApply: "Aplicar",
    aiClose: "Fechar",
    aiError: "Não foi possível aplicar — tente reformular ou simplificar o pedido.",
    saving: "Salvando…",
    saveFailed: "Falha ao salvar",
    saved: "Salvo",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    addBlock: "+ Adicionar bloco",
    cancel: "Cancelar",
    deleteBlock: "Excluir bloco",
    blockTypes: {
      paragraph: "Texto",
      heading: "Título",
      todo: "Tarefa",
      bulleted_list_item: "Lista",
      callout: "Destaque",
      divider: "Divisor",
      database: "Tabela",
    },
    placeholders: {
      paragraph: "Digite algo…",
      todo: "Tarefa",
      listItem: "Item da lista",
      callout: "Destaque",
    },
    headingDefault: "Título",
    // Defaults for a brand-new table inserted via "+ Add block → Table".
    newTable: {
      name: "Nova tabela",
      propName: "Nome",
      propStatus: "Status",
      propDue: "Prazo",
      statusTodo: "A fazer",
      statusInProgress: "Em andamento",
      statusDone: "Concluído",
      viewTable: "Tabela",
    },
  },

  // ---- Database views (table / board / calendar) ------------------------
  db: {
    nameAria: "Nome do banco de dados",
    newRow: "+ Nova linha",
    newCard: "+ Novo",
    untitled: "Sem título",
    empty: "—",
    link: "Link ↗",
    linked: "{count} vinculado(s)",
    deleteRow: "Excluir linha",
    deleteCard: "Excluir cartão",
    dragHint: "Arraste para outra coluna",
    prevMonth: "Mês anterior",
    nextMonth: "Próximo mês",
    addOnDay: "Adicionar neste dia",
    clickToRename: "Clique para renomear",
    delete: "Excluir",
  },

  // ---- Default onboarding questions (no-API-key fallback) ----------------
  onboarding: {
    level: {
      question: "Qual é o seu nível de estudo?",
      options: {
        hs: "Ensino médio",
        ug: "Graduação",
        grad: "Pós / Mestrado",
        self: "Autodidata",
      },
    },
    load: {
      question: "Com quantos cursos você está malabarismando?",
      // 1–2, 3–4, 5–6, 7+ stay numeric across locales (see onboarding.ts).
    },
    track: {
      question: "O que você mais quer acompanhar?",
      options: {
        assign: "Tarefas",
        exams: "Provas",
        read: "Leituras",
        notes: "Anotações",
        habits: "Hábitos de estudo",
        grades: "Notas",
      },
    },
    style: {
      question: "Como você gosta de planejar?",
      options: {
        cal: "Por calendário",
        board: "Por quadro",
        list: "Listas simples",
      },
    },
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  // The fixed labels the rule-based generator emits so the offline experience
  // is localized too. Course names derive from the user's own prompt.
  mock: {
    workspaceName: "Central de Estudos",
    workspaceNameField: "Central de Estudos de {field}",
    welcome:
      "Gerado a partir da sua descrição: “{summary}”. Tudo aqui é um ponto de partida que você pode editar.",
    tbd: "A definir",
    status: { notStarted: "Não iniciado", inProgress: "Em andamento", done: "Concluído" },
    type: { homework: "Lição de casa", quiz: "Quiz", exam: "Prova", project: "Projeto" },
    exam: { midterm: "Prova intermediária", final: "Prova final" },
    courses: {
      name: "Cursos",
      description: "Todas as aulas que você está cursando neste período.",
      propCourse: "Curso",
      propCode: "Código",
      propInstructor: "Professor",
      propCredits: "Créditos",
      propSchedule: "Horário",
      viewAll: "Todos os cursos",
    },
    assignments: {
      name: "Tarefas",
      description: "Lições de casa, quizzes, projetos e provas.",
      propName: "Tarefa",
      propCourse: "Curso",
      propType: "Tipo",
      propStatus: "Status",
      propDue: "Prazo",
      propWeight: "Peso %",
      viewAll: "Todas",
      viewBoard: "Por status",
      viewCalendar: "Calendário",
      projectMilestone: "Marco do projeto {n} — {code}",
    },
    readings: {
      name: "Lista de Leituras",
      description: "O que ler, organizado por curso.",
      propTitle: "Título",
      propCourse: "Curso",
      propRead: "Lido",
      propLink: "Link",
      viewAll: "Lista de leituras",
      coreReading: "{course}: leitura essencial",
    },
    habits: {
      name: "Hábitos de Estudo",
      description: "Um controle leve de consistência semanal.",
      propHabit: "Hábito",
      propDate: "Data",
      propDone: "Concluído",
      propMinutes: "Minutos",
      viewAll: "Todos os hábitos",
      viewCalendar: "Calendário",
      reviewNotes: "Revisar as anotações de hoje",
      practiceRecall: "Praticar recordação",
    },
    grades: {
      name: "Controle de Notas",
      description: "Notas e pesos editáveis para cada curso.",
      propItem: "Avaliação",
      propCourse: "Curso",
      propScore: "Nota",
      propOutOf: "De um total de",
      propWeight: "Peso %",
      viewAll: "Todas as notas",
      assessmentN: "Avaliação {n}",
    },
    pages: {
      dashboard: "Painel",
      courses: "Cursos",
      assignments: "Tarefas",
      planner: "Planejador",
      readings: "Lista de Leituras",
      exams: "Preparação para Provas",
      notes: "Anotações",
      habits: "Hábitos de Estudo",
      grades: "Controle de Notas",
    },
    dashboard: {
      assignmentsHeading: "📌 Tarefas por status",
      coursesHeading: "📚 Meus cursos",
    },
    assignmentsPage: { intro: "Tudo o que você precisa entregar, com prazos e pesos." },
    plannerPage: { intro: "Seus prazos dispostos em um calendário." },
    examsPage: {
      callout:
        "Confirme as datas e depois divida cada prova em tópicos de revisão e sessões de prática.",
    },
    notesPage: {
      heading: "Anotações do Curso",
      callout:
        "Adicione um título para cada aula e depois registre as ideias principais e dúvidas abaixo.",
      fallbackCourse: "Curso",
      startWriting: "Comece a escrever aqui…",
    },
    gradesPage: {
      callout:
        "Substitua as avaliações iniciais pelos pesos do seu programa e pelos resultados reais.",
    },
    // Workspace component plan (labels + descriptions shown in the loader).
    plan: {
      summaryWith: "Um espaço de trabalho sob medida construído em torno de {focus}.",
      summaryGeneric:
        "Um espaço de trabalho sob medida para cursos, prazos e planejamento de estudos.",
      components: {
        dashboard: {
          label: "Painel",
          description: "Seu semestre, prioridades e próximos prazos.",
        },
        courses: {
          label: "Cursos",
          description: "Detalhes dos cursos, horários e professores.",
        },
        assignments: {
          label: "Tarefas",
          description: "Trabalhos, prazos, pesos e status.",
        },
        planner: {
          label: "Planejador",
          description: "Uma visão de calendário do trabalho que vem pela frente.",
        },
        readings: {
          label: "Lista de Leituras",
          description: "Textos atribuídos e progresso de leitura.",
        },
        exams: {
          label: "Preparação para Provas",
          description: "Datas das provas, tópicos e tarefas de revisão.",
        },
        notes: {
          label: "Anotações",
          description: "Um lar estruturado para as anotações do curso.",
        },
        habits: {
          label: "Hábitos de Estudo",
          description: "Rotinas diárias de estudo e consistência.",
        },
        grades: {
          label: "Controle de Notas",
          description: "Notas, pesos e metas de desempenho.",
        },
        projects: {
          label: "Projetos",
          description: "Marcos e próximas ações para trabalhos maiores.",
        },
      },
    },
  },
} satisfies Dictionary;
