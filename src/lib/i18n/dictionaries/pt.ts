import type { Dictionary } from "./en";

// Português (pt-BR) — tradução do dicionário canônico em inglês.
export const pt = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — Seu espaço de estudos, criado por IA",
    homeDescription:
      "Descreva seus cursos e prazos, e o StudyOS monta na hora seus painéis, planejadores e controles de tarefas. O espaço de estudos com IA para estudantes.",
    appTitle: "Seus espaços de trabalho · StudyOS",
    generateTitle: "Crie seu espaço de trabalho · StudyOS",
    pricingTitle: "Preços · StudyOS",
    pricingDescription:
      "Compare o StudyOS Grátis e Pro. Comece de graça e faça upgrade quando quiser o modelo mais avançado, gerações ilimitadas e suporte prioritário.",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "Idioma",
    choose: "Escolher idioma",
  },

  // ---- Shared bits used on more than one surface ------------------------
  common: {
    openApp: "Abrir app",
    signIn: "Entrar",
    getStarted: "Começar",
    cancel: "Cancelar",
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
        "Descreva suas aulas em uma frase e o StudyOS prepara os painéis, planejadores e controles que você precisa — já preenchidos. Sem modelos prontos, sem páginas em branco.",
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
          body: "Uma frase — “Sou de pré-medicina e faço Anatomia, Bioquímica e Fisiologia.”",
        },
        {
          title: "Receba um espaço completo",
          body: "Cursos, um quadro de tarefas, um planejador e uma lista de leituras — já prontos e preenchidos.",
        },
        {
          title: "Estude e ajuste",
          body: "Edite o que quiser, marque tarefas, peça mudanças em linguagem simples. Tudo salva automaticamente.",
        },
      ],
    },
    features: {
      title: "Tudo o que um semestre precisa.",
      subtitle: "Gerado para você em um passo — depois, é seu para moldar.",
      items: {
        generate: {
          k: "Gerar",
          title: "Espaços de trabalho, feitos para você",
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
          body: "Todos os prazos em um só lugar. Alterne entre tabela, quadro e calendário em um clique.",
        },
        dashboard: {
          k: "Painel",
          title: "Uma base clara",
          body: "Uma página que reúne toda a sua semana para você sempre saber o que vem a seguir.",
        },
        autosave: {
          k: "Salvamento automático",
          title: "Edite, salvo na hora",
          body: "Renomeie, marque, adicione linhas — cada mudança se salva no momento em que você faz.",
        },
        assistant: {
          k: "Assistente",
          title: "Peça em linguagem simples",
          body: "“Adicione uma prova intermediária em Computação.” Seu espaço de trabalho se atualiza, bem na sua frente.",
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
          "Gere espaços de trabalho com IA",
          "Edite e salve tudo automaticamente",
          "Painéis, bancos de dados, calendário",
          "Peça edições em linguagem simples",
        ],
        cta: "Começar",
      },
      pro: {
        badge: "Mais popular",
        name: "Pro",
        price: "$5",
        features: [
          "Tudo do Grátis",
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
    preview: {
      name: "Central de Estudos de Computação",
      thisWeek: "Esta semana",
      columns: { todo: "A fazer", doing: "Fazendo", done: "Concluído" },
      cards: ["Quiz de Provas", "Lab de Lista Encadeada", "Relatório de Lab 2"],
      coursesLabel: "Cursos",
      courses: ["Estruturas de Dados", "Matemática Discreta", "Física I"],
    },
  },

  // ---- Pricing page (/pricing) ------------------------------------------
  pricing: {
    nav: { openApp: "Abrir app", signIn: "Entrar", getStarted: "Começar" },
    badge: "Preços simples e acessíveis para estudantes",
    title: "Comece grátis. Faça upgrade quando estiver pronto.",
    subtitle:
      "Tudo o que você precisa para organizar seu semestre é grátis. O Pro adiciona o modelo mais avançado, gerações ilimitadas e suporte prioritário.",
    free: {
      name: "Grátis",
      price: "$0",
      tagline: "Tudo para se organizar.",
      bullets: [
        "Espaços de trabalho de estudos gerados por IA",
        "Edição inline completa e salvamento automático",
        "Bancos de dados — tabela, quadro e calendário",
        "Chat com agente de IA no seu espaço de trabalho",
      ],
      ctaSignedOut: "Comece grátis",
      ctaSignedIn: "Abrir seus espaços de trabalho",
      bulletCredits: "{count} créditos de IA iniciais",
    },
    pro: {
      badge: "Mais popular",
      name: "Pro",
      price: "$5",
      perMonth: "/mês",
      billed: "Cobrado mensalmente · cancele quando quiser.",
      bullets: [
        "Tudo do Grátis",
        "Gerações ilimitadas de espaços de trabalho",
        "O modelo mais avançado e detalhado",
        "Suporte prioritário e acesso antecipado",
      ],
      currentPlan: "✦ Seu plano atual",
      manageBilling: "Gerenciar cobrança",
      upgrade: "Fazer upgrade para o Pro",
      ctaSignedOut: "Começar com o Pro",
      bulletCredits: "{count} créditos de IA inclusos",
    },
    comparison: {
      title: "Comparar planos",
      featuresHeader: "Recursos",
      freeHeader: "Grátis",
      proHeader: "Pro",
      included: "Incluído",
      notIncluded: "Não incluído",
      features: {
        aiWorkspaces: "Espaços de trabalho gerados por IA",
        onboarding: "Perguntas de configuração guiada",
        editing: "Edição inline completa e salvamento automático",
        databases: "Bancos de dados — tabela, quadro e calendário",
        dragDrop: "Edição com arrastar e soltar",
        agentChat: "Chat com agente de IA que edita seu espaço de trabalho",
        model: "Modelo de geração",
        generations: "Gerações de espaços de trabalho",
        support: "Suporte",
        earlyAccess: "Acesso antecipado a novos recursos",
        credits: "Créditos de IA inclusos",
        buyMore: "Compre mais créditos quando quiser",
      },
      values: {
        standard: "Padrão",
        mostCapable: "Mais avançado",
        generous: "Generoso",
        unlimited: "Ilimitado",
        community: "Comunidade",
        priority: "Prioritário",
      },
    },
    credits: {
      heading: "A IA funciona com créditos",
      intro:
        "Cada solicitação de IA gasta créditos conforme o quanto ela faz — um ajuste rápido custa pouco, criar um espaço de trabalho inteiro custa mais. O Pro vem carregado de créditos, e você pode recarregar quando quiser.",
      freeIncludes: "O Grátis inclui {count} créditos iniciais",
      proIncludes: "O Pro inclui {count} créditos",
      neverExpire: "Recarregue quando quiser — os créditos nunca expiram",
      balance: "Seu saldo: {count} créditos",
      pack: "Pacote de créditos",
      unit: "créditos",
      buy: "Comprar {count} créditos",
      signUpToBuy: "Cadastre-se para comprar créditos",
      oneTime: "Compra única · checkout seguro",
    },
    faqTitle: "Perguntas",
    faq: [
      {
        q: "O StudyOS é realmente grátis para começar?",
        a: "Sim. Crie uma conta e gere, edite e use seus espaços de trabalho no plano Grátis — sem precisar de cartão de crédito.",
      },
      {
        q: "O que ganho com o Pro?",
        a: "Gerações ilimitadas, o modelo mais avançado para espaços de trabalho mais ricos e precisos, suporte prioritário e acesso antecipado a novos recursos.",
      },
      {
        q: "Posso cancelar quando quiser?",
        a: "Quando quiser. Gerencie ou cancele sua assinatura pelo portal de cobrança — você mantém o Pro até o fim do período.",
      },
      {
        q: "O que acontece com meus espaços de trabalho se eu fizer downgrade?",
        a: "Nada é excluído. Seus espaços de trabalho permanecem exatamente como estão e continuam totalmente editáveis no Grátis.",
      },
    ],
    ctaTitle: "Seu primeiro espaço de trabalho está a uma frase de distância.",
    ctaSubtitle: "Experimente o StudyOS grátis — faça upgrade só se quiser mais.",
    ctaSignedIn: "Gerar um espaço de trabalho",
    ctaSignedOut: "Comece grátis",
    footerTagline: "O espaço de estudos para estudantes · © 2026",
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
    emptySubtitle: "Gere um, ou carregue a demonstração para dar uma olhada.",
    emptyGenerate: "Gerar um espaço de trabalho",
    loadDemo: "Carregar demonstração",
    updatedAt: "atualizado em {date}",
    fallbackIcon: "📄",
  },

  // ---- Generate flow (/generate) ----------------------------------------
  generate: {
    backToWorkspaces: "Seus espaços de trabalho →",
    examples: [
      { emoji: "💻", text: "Sou estudante de Computação do 1º ano fazendo 5 cursos" },
      {
        emoji: "⚕️",
        text: "2º ano de pré-medicina: Anatomia, Bioquímica, Fisiologia, Química Orgânica",
      },
      { emoji: "🎓", text: "2º ano do ensino médio estudando 6 matérias para as provas finais" },
      {
        emoji: "📈",
        text: "Estudante de MBA fazendo Microeconomia, Contabilidade e Marketing",
      },
    ],
    planSteps: [
      "Lendo sua descrição",
      "Pensando em boas perguntas",
      "Personalizando sua configuração",
    ],
    planningTitle: "Conhecendo você",
    errorGeneric: "Algo deu errado. Tente novamente.",
    errorBuild: "Algo deu errado ao gerar seu espaço de trabalho. Tente novamente.",
    describe: {
      step: "Passo 1 de 2",
      title: "O que você está estudando?",
      subtitle:
        "Descreva seus cursos e objetivos em linguagem simples. O StudyOS faz algumas perguntas rápidas e então projeta todo o espaço de trabalho em torno das suas respostas.",
      placeholder:
        "ex.: Sou estudante de Computação do 1º ano fazendo Estruturas de Dados, Matemática Discreta, Cálculo II e Escrita Acadêmica neste semestre.",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "Continuar",
      examplesLabel: "Em dúvida? Comece a partir de um exemplo",
      finePrint: "Grátis · sem cartão de crédito · pronto em segundos",
    },
    questions: {
      back: "← Editar descrição",
      step: "Passo 2 de 2",
      title: "Vamos personalizar",
      designingFor: "Projetando para:",
      pickAny: "escolha quantas quiser",
      pickOne: "escolha uma",
      build: "Criar meu espaço de trabalho",
      answeredNone: "Responda algumas, ou apenas crie — você decide",
      answeredCount: "{n} / {total} respondidas",
    },
  },

  // ---- Generation activity (full-screen build progress) -----------------
  genActivity: {
    building: "Criando seu espaço de trabalho",
    designing: "Projetando seu espaço de trabalho",
    componentsChosen: "Componentes escolhidos para você",
    planningComponents: "Planejando componentes",
    onlyRelevant: "Apenas as páginas e controles relevantes para suas respostas.",
    componentsCount: "{count} componentes",
    everythingEditable:
      "Tudo o que é gerado continua editável — páginas, campos, visualizações, linhas e conteúdo.",
    statusReady: "Pronto",
    statusGenerating: "Gerando…",
    statusQueued: "Na fila",
    finishingUp: "Finalizando",
    yourWorkspace: "Seu espaço de trabalho",
    pagesLabel: "Páginas",
    sectionsBuilt: "{built} de {total} seções criadas",
    choosingPieces: "Escolhendo as peças certas para você…",
    stillEditable: "Tudo continua editável quando estiver pronto",
    writingItIn: "Escrevendo…",
    board: { todo: "A fazer", doing: "Fazendo", done: "Concluído" },
    phase: {
      analyzing: "Analisando suas respostas",
      planning: "Selecionando componentes",
      generating: "Gerando espaço de trabalho",
      validating: "Validando dados",
      saving: "Salvando",
    },
  },

  // ---- AiActivity overlay (calm spinner used during planning) -----------
  aiActivity: {
    defaultTitle: "Trabalhando nisso",
    defaultSteps: [
      "Lendo seu espaço de trabalho",
      "Planejando as mudanças",
      "Projetando o layout",
      "Escrevendo tudo",
    ],
  },

  // ---- Workspace editor chrome ------------------------------------------
  editor: {
    workspaceIcon: "Ícone do espaço de trabalho",
    newPage: "Nova página",
    untitled: "Sem título",
    allWorkspaces: "← Todos os espaços de trabalho",
    deletePage: "Excluir página",
    askAi: "Perguntar à IA",
    closeAgent: "Fechar agente",
    saving: "Salvando…",
    saveFailed: "Falha ao salvar",
    saved: "Salvo",
  },

  // ---- In-workspace AI agent chat ---------------------------------------
  agentChat: {
    title: "Agente de IA",
    subtitleIdle: "Entende todo o seu espaço de trabalho",
    closeChat: "Fechar chat",
    suggestions: [
      "Adicionar um controle de hábitos",
      "Fazer um plano de estudos de 2 semanas para as provas finais",
      "Adicionar uma prova intermediária a cada curso",
      "No que devo focar esta semana?",
    ],
    intro:
      "Peça para eu mudar um item ou coordenar atualizações em todo o seu espaço de trabalho. Se algo não estiver claro, eu pergunto antes de editar.",
    workspaceUpdated: "Espaço de trabalho atualizado",
    buildingUpdate: "Criando sua atualização",
    steps: {
      inspect: "Inspecionar espaço de trabalho",
      decide: "Decidir a ação mais segura",
      prepare: "Preparar atualização coordenada",
    },
    phase: {
      inspecting: "Revisando seu espaço de trabalho",
      planning: "Planejando a mudança mais segura",
      updating: "Coordenando atualizações do espaço de trabalho",
      validating: "Verificando cada conexão",
      saving: "Salvando suas mudanças",
    },
    areaStatus: { queued: "Na fila", working: "Atualizando", complete: "Pronto" },
    initialMessage: "Abrindo seu espaço de trabalho",
    placeholderBusy: "O agente está trabalhando…",
    placeholderIdle: "Peça ao agente para criar ou mudar algo…",
    send: "Enviar",
    inputHint: "Enter para enviar · Shift+Enter para nova linha",
    errorRequestFailed: "Falha na solicitação ao agente",
    errorEndedUnexpectedly: "A resposta do agente terminou inesperadamente",
    errorSnag: "O agente encontrou um problema. Tente novamente.",
    errorCouldntComplete:
      "Não consegui concluir isso com segurança. Tente novamente ou torne a solicitação mais específica.",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    pageIcon: "Ícone da página",
    headingLevel: "Nível do título",
    calloutIcon: "Ícone do destaque",
    addBlock: "+ Adicionar bloco",
    deleteBlock: "Excluir bloco",
    blockTypes: {
      paragraph: "Texto",
      heading: "Título",
      todo: "Tarefa",
      bulleted_list_item: "Lista",
      numbered_list_item: "Numerada",
      quote: "Citação",
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
    databaseIcon: "Ícone do banco de dados",
    nameAria: "Nome do banco de dados",
    newRow: "+ Nova linha",
    newCard: "+ Novo",
    untitled: "Sem título",
    empty: "—",
    deleteRow: "Excluir linha",
    deleteCard: "Excluir cartão",
    dragHint: "Arraste para outra coluna",
    prevMonth: "Mês anterior",
    nextMonth: "Próximo mês",
    addOnDay: "Adicionar neste dia",
    clickToRename: "Clique para renomear",
    delete: "Excluir",
  },

  // ---- Database settings panel ------------------------------------------
  dbSettings: {
    customize: "Personalizar campos e visualizações",
    description: "Descrição",
    descriptionPlaceholder: "Para que serve este controle",
    fields: "Campos",
    addField: "+ Adicionar campo",
    fieldName: "Nome do campo",
    fieldType: "Tipo do campo",
    deleteField: "Excluir campo",
    newField: "Novo campo",
    chooseRelatedDatabase: "Escolher banco de dados relacionado",
    optionLabel: "Rótulo da opção",
    addOption: "+ opção",
    newOption: "Nova opção",
    views: "Visualizações",
    addView: "+ Adicionar visualização",
    viewName: "Nome da visualização",
    newView: "Nova visualização",
    deleteView: "Excluir visualização",
    groupBy: "Agrupar por…",
    dateField: "Campo de data…",
    deleteDatabase: "Excluir este banco de dados",
    deleteConfirm: "Excluir “{name}” e removê-lo de todas as páginas?",
    propertyTypes: {
      text: "Texto",
      number: "Número",
      checkbox: "Caixa de seleção",
      date: "Data",
      select: "Seleção",
      multi_select: "Seleção múltipla",
      status: "Status",
      url: "URL",
      relation: "Relação",
    },
    viewTypes: {
      table: "Tabela",
      board: "Quadro",
      calendar: "Calendário",
      list: "Lista",
      gallery: "Galeria",
    },
    defaults: {
      statusTodo: "A fazer",
      statusInProgress: "Em andamento",
      statusDone: "Concluído",
      option1: "Opção 1",
      option2: "Opção 2",
    },
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
    load: { question: "Com quantos cursos você está lidando?" },
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
      options: { cal: "Por calendário", board: "Por quadro", list: "Listas simples" },
    },
  },

  // ---- Server-emitted AI progress + errors ------------------------------
  ai: {
    generate: {
      phase: {
        analyzing: "Lendo seus cursos, objetivos e preferências",
        planning: "Escolhendo os componentes certos do espaço de trabalho",
        generating: "Gerando seu espaço de trabalho completo de uma só vez",
        validating: "Verificando links, visualizações, campos e dados iniciais",
        saving: "Salvando seu espaço de trabalho editável",
      },
      error:
        "Não foi possível gerar o espaço de trabalho. Tente novamente com uma descrição mais curta.",
      detail: {
        dashboard: "{count} páginas editáveis conectadas",
        courses: "{count} cursos adicionados",
        trackedItems: "{count} itens acompanhados adicionados",
        scheduled: "{count} itens agendados",
        readings: "{count} leituras adicionadas",
        habits: "{count} rotinas adicionadas",
        grades: "{count} linhas de notas adicionadas",
        notes: "Estrutura de anotações editável criada",
        generic: "Componente criado e conectado",
      },
    },
    agent: {
      inspecting: "Revisando {pages} páginas e {databases} bancos de dados",
      inspectingArea: "Revisando {area}",
      planning: "Entendendo a solicitação e verificando ambiguidades",
      updating: "Aplicando mudanças coordenadas em todo o seu espaço de trabalho",
      validating: "Verificando referências, visualizações, campos e dados vinculados",
      saving: "Salvando o espaço de trabalho atualizado",
      workspaceNotFound: "Espaço de trabalho não encontrado.",
      error:
        "O agente não conseguiu concluir essa solicitação com segurança. Tente novamente ou torne a solicitação mais específica.",
      fallbackReply: "Espaço de trabalho atualizado.",
    },
    errors: {
      notAuthenticated: "Não autenticado",
      invalidAgentRequest: "Solicitação ao agente inválida",
      describeBeforeGenerating:
        "Descreva seus estudos antes de gerar um espaço de trabalho.",
    },
  },

  // ---- Credits ----------------------------------------------------------
  credits: {
    label: "Créditos de IA",
    amount: "{count} créditos",
    buy: "Comprar créditos",
    spentOn: "Gastos em gerações de IA e edições do agente.",
    addedBanner: "Adicionados {added} créditos — agora você tem {total}.",
    outGenerate:
      "Seus créditos de IA acabaram. Adicione mais na página de Preços para continuar gerando.",
    outAgent:
      "Seus créditos de IA acabaram. Adicione mais na página de Preços para continuar usando o agente.",
  },

  // ---- Account menu -----------------------------------------------------
  account: {
    pro: "Pro",
    free: "Grátis",
    fallbackName: "Conta",
    viewProfile: "Ver perfil",
    manageProfile: "Gerenciar perfil",
    subscriptionPayments: "Assinatura e pagamentos",
    buyCredits: "Comprar créditos",
    settings: "Configurações",
    signOut: "Sair",
    manageAccount: "Gerenciar conta",
    creditsAndPlan: "{credits} créditos · {plan}",
  },

  // ---- Account settings page --------------------------------------------
  settings: {
    metaTitle: "Configurações da conta · StudyOS",
    back: "← Espaços de trabalho",
    title: "Configurações da conta",
    subtitle: "Gerencie seu perfil, plano, pagamentos e créditos.",
    profile: "Perfil",
    yourAccount: "Sua conta",
    subscription: "Assinatura",
    proDesc:
      "Você está no Pro — o modelo mais avançado e suporte prioritário. Gerencie sua assinatura, formas de pagamento e faturas abaixo.",
    freeDesc:
      "Você está no plano Grátis. Faça upgrade para o Pro e tenha o modelo mais avançado, créditos inclusos e suporte prioritário.",
    manageSubscription: "Gerenciar assinatura e pagamentos",
    upgrade: "Fazer upgrade para o Pro",
    comparePlans: "Comparar planos",
    creditsDesc:
      "Os créditos alimentam cada solicitação de IA. Recarregue quando quiser — os créditos nunca expiram.",
    buyPack: "Comprar {count} créditos · ${price}",
    viewPricing: "Ver preços",
    signOut: "Sair",
  },

  // ---- Workspace card (delete control) ----------------------------------
  workspaceCard: {
    delete: "Excluir espaço de trabalho",
    deleteAria: "Excluir {name}",
    deleteConfirm:
      "Excluir “{name}”?\n\nIsso remove permanentemente o espaço de trabalho e tudo o que há nele. Isso não pode ser desfeito.",
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
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
      description: "Todas as aulas que você faz neste período.",
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
      practiceRecall: "Praticar recordação ativa",
    },
    grades: {
      name: "Controle de Notas",
      description: "Pontuações e pesos editáveis para cada curso.",
      propItem: "Avaliação",
      propCourse: "Curso",
      propScore: "Pontuação",
      propOutOf: "De",
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
    plannerPage: { intro: "Seus prazos organizados em um calendário." },
    examsPage: {
      callout:
        "Confirme as datas, depois divida cada prova em tópicos de revisão e sessões de prática.",
    },
    notesPage: {
      heading: "Anotações dos Cursos",
      callout:
        "Adicione um título para cada aula e capture as ideias e dúvidas principais abaixo.",
      fallbackCourse: "Curso",
      startWriting: "Comece a escrever aqui…",
    },
    gradesPage: {
      callout:
        "Substitua as avaliações iniciais pelos pesos do seu plano de ensino e pelos resultados reais.",
    },
    plan: {
      summaryWith: "Um espaço de trabalho sob medida, criado em torno de {focus}.",
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
          description: "Uma visualização em calendário do trabalho pela frente.",
        },
        readings: {
          label: "Lista de Leituras",
          description: "Textos atribuídos e progresso de leitura.",
        },
        exams: {
          label: "Preparação para Provas",
          description: "Datas de provas, tópicos e tarefas de revisão.",
        },
        notes: {
          label: "Anotações",
          description: "Um lar estruturado para as anotações dos cursos.",
        },
        habits: {
          label: "Hábitos de Estudo",
          description: "Rotinas diárias de estudo e consistência.",
        },
        grades: {
          label: "Controle de Notas",
          description: "Pontuações, pesos e metas de notas.",
        },
      },
    },
  },
} satisfies Dictionary;
